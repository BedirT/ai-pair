// OMP over its RPC mode: one JSON object per line on the child's stdin and stdout.
// See "RPC Protocol Reference" in OMP's docs (omp://rpc.md). No VS Code here, so it can be
// tested against a script that speaks the same lines.

import { spawn, type ChildProcess } from "node:child_process"
import * as readline from "node:readline"

/** Any frame off OMP's stdout, other than a command response. `type` says which. */
export type OmpFrame = { type: string; [key: string]: unknown }

/** What the host answers a dialog request with; see the extension UI sub-protocol. */
export type OmpUiAnswer =
  | { value: string }
  | { confirmed: boolean }
  | { answers: Array<{ id: string; selectedOptions: string[]; customInput?: string }> }
  | { cancelled: true }

export type OmpHandlers = {
  /** Session events, prompt results, notices, presentation updates: everything that isn't a response or a dialog. */
  onFrame(frame: OmpFrame): void
  /** A dialog OMP wants shown (`select`, `confirm`, `input`, `editor`, `ask`). Undefined means cancelled. */
  onDialog?(frame: OmpFrame): Promise<OmpUiAnswer | undefined>
  onStderr?(text: string): void
  onExit?(code: number | null): void
}

const DIALOGS: Record<string, true> = { select: true, confirm: true, input: true, editor: true, ask: true }

type Pending = { resolve: (data: unknown) => void; reject: (error: Error) => void }
export class OmpRpc {
  private child?: ChildProcess
  private seq = 0
  private readonly pending = new Map<string, Pending>()
  /** Protocol v2 splits an oversized frame into base64 chunks; they arrive unbroken, in order. */
  private chunks: { id: string; count: number; byteLength: number; parts: Buffer[] } | null = null
  /** True between `agent_start` and its `agent_end`. */
  streaming = false
  private readyResolve?: () => void
  private readyReject?: (error: Error) => void

  constructor(private readonly handlers: OmpHandlers) {}

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null && !this.child.killed
  }

  /** Starts `omp` and resolves once it says it is ready. */
  start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    if (this.running) return Promise.resolve()
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    // No Promise.withResolvers: the extension still runs on VS Code builds with Node 20.
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    child.on("error", (error) => {
      this.readyReject?.(error)
      this.failAll(error)
    })
    child.on("exit", (code) => {
      const error = new Error(`OMP exited${code === null ? "" : ` with code ${code}`}.`)
      this.readyReject?.(error)
      this.failAll(error)
      this.handlers.onExit?.(code)
      if (this.child === child) this.child = undefined
    })
    child.stderr?.on("data", (data: Buffer) => this.handlers.onStderr?.(data.toString()))
    const lines = readline.createInterface({ input: child.stdout! })
    lines.on("line", (line) => {
      if (line.trim()) this.receive(line)
    })
    return ready
  }

  /** Sends a command and waits for its response. `prompt` answers once the message is taken in, not when the turn ends. */
  request(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.running || !this.child?.stdin?.writable) return Promise.reject(new Error("OMP isn't running."))
    const id = `pair-${++this.seq}`
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ id, type, ...fields })
    })
  }

  /** Ends the conversation: closing stdin is OMP's normal shutdown; a child that lingers is killed. */
  dispose(): void {
    const child = this.child
    if (!child) return
    this.child = undefined
    this.failAll(new Error("OMP was stopped."))
    child.stdin?.end()
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGTERM")
    }, 2000).unref()
  }

  private send(frame: Record<string, unknown>): void {
    this.child?.stdin?.write(`${JSON.stringify(frame)}\n`)
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private receive(line: string): void {
    let frame: OmpFrame
    try {
      frame = JSON.parse(line) as OmpFrame
    } catch {
      return
    }
    if (frame.type === "rpc_chunk") {
      const whole = this.reassemble(frame)
      if (whole) this.dispatch(whole)
      return
    }
    this.dispatch(frame)
  }

  private reassemble(frame: OmpFrame): OmpFrame | undefined {
    const { chunkId, index, count, byteLength, data } = frame
    if (typeof chunkId !== "string" || typeof data !== "string" || typeof index !== "number" || typeof count !== "number") {
      this.chunks = null
      return undefined
    }
    if (index === 0) this.chunks = { id: chunkId, count, byteLength: Number(byteLength) || 0, parts: [] }
    const chunks = this.chunks
    if (!chunks || chunks.id !== chunkId || chunks.parts.length !== index) {
      this.chunks = null
      return undefined
    }
    chunks.parts.push(Buffer.from(data, "base64"))
    if (chunks.parts.length < chunks.count) return undefined
    this.chunks = null
    const bytes = Buffer.concat(chunks.parts)
    if (chunks.byteLength && bytes.length !== chunks.byteLength) return undefined
    try {
      return JSON.parse(bytes.toString("utf8")) as OmpFrame
    } catch {
      return undefined
    }
  }

  private dispatch(frame: OmpFrame): void {
    switch (frame.type) {
      case "ready": {
        // Ask for the lossless framing when it is on offer; the client reads v1 either way.
        const supported = frame.supportedProtocolVersions
        if (Array.isArray(supported) && supported.includes(2)) {
          void this.request("negotiate_protocol", { protocolVersion: 2 }).catch(() => {})
        }
        this.readyResolve?.()
        return
      }
      case "response": {
        const id = frame.id
        const pending = typeof id === "string" ? this.pending.get(id) : undefined
        if (!pending || typeof id !== "string") return
        this.pending.delete(id)
        if (frame.success === false) pending.reject(new Error(typeof frame.error === "string" ? frame.error : `OMP refused ${String(frame.command)}.`))
        else pending.resolve(frame.data)
        return
      }
      case "extension_ui_request": {
        if (typeof frame.method === "string" && DIALOGS[frame.method]) {
          const id = frame.id
          void (this.handlers.onDialog?.(frame) ?? Promise.resolve(undefined))
            .then((answer) => this.send({ type: "extension_ui_response", id, ...(answer ?? { cancelled: true }) }))
            .catch(() => this.send({ type: "extension_ui_response", id, cancelled: true }))
          return
        }
        this.handlers.onFrame(frame)
        return
      }
      case "agent_start":
        this.streaming = true
        this.handlers.onFrame(frame)
        return
      case "agent_end":
        if (frame.yielded !== false) this.streaming = false
        this.handlers.onFrame(frame)
        return
      default:
        this.handlers.onFrame(frame)
    }
  }
}

/** One field of an unknown value from OMP, or undefined when it isn't an object holding it. */
export function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined
}

/** The readable text of an assistant (or user) message: its text blocks, joined. */
export function messageText(message: unknown): string {
  const content = field(message, "content")
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  let text = ""
  for (const block of content) {
    const part = field(block, "text")
    if (field(block, "type") === "text" && typeof part === "string") text += part
  }
  return text
}

/** A short label for a model out of `get_state` or `get_available_models`: `provider/id`. */
export function modelLabel(model: unknown): string | undefined {
  const provider = field(model, "provider")
  const id = field(model, "id")
  return typeof provider === "string" && typeof id === "string" ? `${provider}/${id}` : undefined
}
