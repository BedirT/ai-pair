// The agent's voice: Kokoro, the local speech model OMP ships, kept warm in its own small process
// (VS Code's runtime refuses its native code, so bun or node runs it). Sentences are made and
// played one after another, the next while the last is still sounding. With no warm process to
// be had, `omp say` speaks each line itself: slower to start, but the same voice, still local.

import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import * as vscode from "vscode"
import type { VoicePort } from "@ai-pair/core"
import { execProgram, findOmp, ompFile, which, type Host } from "./agents"
import type { NarrationPanel, VoicePanelPort, VoiceStatus } from "./panel"
import { SpeechQueue } from "./voiceQueue"

const HOST: Host = { home: os.homedir(), env: process.env, platform: process.platform, exec: execProgram }

/** The Kokoro voices OMP offers, with the names a person picks from. */
export const VOICES: Array<{ id: string; label: string }> = [
  { id: "af_heart", label: "Heart · US, female" },
  { id: "af_bella", label: "Bella · US, female" },
  { id: "af_nicole", label: "Nicole · US, female" },
  { id: "af_aoede", label: "Aoede · US, female" },
  { id: "af_kore", label: "Kore · US, female" },
  { id: "af_sarah", label: "Sarah · US, female" },
  { id: "am_michael", label: "Michael · US, male" },
  { id: "am_fenrir", label: "Fenrir · US, male" },
  { id: "am_puck", label: "Puck · US, male" },
  { id: "bf_emma", label: "Emma · UK, female" },
  { id: "bm_george", label: "George · UK, male" },
  { id: "bm_fable", label: "Fable · UK, male" },
]

export type VoiceOptions = {
  extensionPath: string
  config(): { enabled: boolean; voice: string; rate: number; runtimePath: string; ompPath: string }
  /** Writes the `aiPair.voice.enabled` setting. */
  setEnabled(on: boolean): void
  /** Writes the `aiPair.voice.voice` setting. */
  setVoice(id: string): void
}

type Synth = { resolve: (file: string) => void; reject: (error: Error) => void }

export class VoiceEngine implements VoicePort, VoicePanelPort {
  private queue?: SpeechQueue<string>
  private worker?: ChildProcess
  private killingWorker = false
  private player?: ChildProcess
  private seq = 0
  private readonly synths = new Map<number, Synth>()
  private state: VoiceStatus["state"] = "off"
  private detail: string | undefined
  private on = false
  private starting: Promise<void> | undefined
  private readonly output = vscode.window.createOutputChannel("AI Pair Voice")

  constructor(
    private readonly panel: NarrationPanel,
    private readonly options: VoiceOptions,
  ) {}

  get ready(): boolean {
    return this.state === "ready"
  }

  status(): VoiceStatus {
    return { enabled: this.on, state: this.state, voice: this.options.config().voice, detail: this.detail }
  }

  toggle(): void {
    const on = !this.options.config().enabled
    this.options.setEnabled(on)
    this.setEnabled(on, true)
  }

  /** Follows the setting. `allowSetup`: a person's click, so a first-time download may run. */
  setEnabled(on: boolean, allowSetup = false): void {
    this.on = on
    if (!on) {
      this.queue?.stop()
      this.killWorker()
      this.state = "off"
      this.detail = undefined
      this.publish()
      return
    }
    if (this.state === "ready" || this.state === "loading") {
      this.publish()
      return
    }
    this.starting = this.start(allowSetup).catch((error: unknown) => {
      this.state = "error"
      this.detail = error instanceof Error ? error.message : String(error)
      this.publish()
      if (allowSetup) void vscode.window.showErrorMessage(`AI Pair couldn't start the voice: ${this.detail}`)
    })
  }

  pickVoice(): void {
    void (async () => {
      const current = this.options.config().voice
      const picked = await vscode.window.showQuickPick(
        VOICES.map((v) => ({ label: v.label, description: v.id === current ? "current" : v.id, id: v.id })),
        { title: "Whose voice should the agent have?", placeHolder: "Kokoro, on this machine. No download per voice." },
      )
      if (!picked) return
      this.options.setVoice(picked.id)
      this.publish()
      if (this.ready) void this.speak("Hi. I'll talk while we code.")
    })()
  }

  speak(text: string): Promise<void> {
    return this.queue && this.ready ? this.queue.speak(text) : Promise.resolve()
  }

  stop(): void {
    this.queue?.stop()
  }

  dispose(): void {
    this.stop()
    this.killWorker()
    this.output.dispose()
  }

  private publish(): void {
    this.panel.showVoiceStatus(this.status())
  }

  private async start(allowSetup: boolean): Promise<void> {
    this.state = "loading"
    this.detail = undefined
    this.publish()
    const warmed = await this.warmWorker(allowSetup)
    if (!this.on) return
    if (warmed) {
      this.queue = new SpeechQueue<string>({
        synth: (text) => this.synth(text),
        play: (file) => this.play(file),
        stopPlaying: () => this.player?.kill("SIGTERM"),
        release: (file) => fs.rm(file, { force: true }, () => {}),
      })
    } else {
      const omp = this.ompCommand()
      if (!omp) {
        throw new Error(
          "no local voice was found. The voice is OMP's Kokoro: install OMP, or set `aiPair.voice.runtimePath` to a bun or node program.",
        )
      }
      // No warm process to be had: `omp say` makes and plays each line itself, seconds slower.
      this.queue = new SpeechQueue<string>({
        synth: async (text) => text,
        play: (text) => this.run(omp, ["say", "--voice", this.options.config().voice, text], true),
        stopPlaying: () => this.player?.kill("SIGTERM"),
      })
      this.detail = "Speaking through omp say; each line takes a few seconds."
    }
    this.state = "ready"
    this.publish()
  }

  /** Starts the warm Kokoro process; false when this machine has neither the runtime nor a way to run it. */
  private async warmWorker(allowSetup: boolean): Promise<boolean> {
    let runtime = findKokoroRuntime()
    if (!runtime && allowSetup) {
      const omp = this.ompCommand()
      if (omp) {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "AI Pair: getting the local voice (one-time download)…" },
          () => this.run(omp, ["say", "--out", path.join(os.tmpdir(), "ai-pair-voice-setup.wav"), "Voice ready."], false),
        )
        runtime = findKokoroRuntime()
      }
    }
    if (!runtime) return false
    const js = this.jsRuntime()
    if (!js) return false
    const workerPath = path.join(this.options.extensionPath, "dist", "voiceWorker.js")
    const kokoroPath = path.join(runtime, "node_modules", "kokoro-js", "dist", "kokoro.js")
    const child = spawn(js, [workerPath], {
      cwd: runtime,
      env: { ...process.env, AI_PAIR_KOKORO_PATH: kokoroPath },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.worker = child
    this.killingWorker = false
    child.stderr?.on("data", (data: Buffer) => this.output.append(data.toString()))
    child.on("exit", () => {
      for (const synth of this.synths.values()) synth.reject(new Error("The voice process stopped."))
      this.synths.clear()
      if (this.worker === child) this.worker = undefined
      if (!this.killingWorker && this.on) {
        this.state = "error"
        this.detail = "The voice process stopped. Its words are in the AI Pair Voice output."
        this.publish()
      }
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Kokoro took too long to load.")), 300_000)
      const lines = readline.createInterface({ input: child.stdout! })
      lines.on("line", (line) => {
        let frame: Record<string, unknown>
        try {
          frame = JSON.parse(line) as Record<string, unknown>
        } catch {
          return
        }
        if (frame.type === "ready") {
          clearTimeout(timer)
          resolve()
          return
        }
        if (frame.type === "fatal") {
          clearTimeout(timer)
          reject(new Error(typeof frame.error === "string" ? frame.error : "Kokoro couldn't load."))
          return
        }
        const id = frame.id
        if (typeof id !== "number") return
        const synth = this.synths.get(id)
        if (!synth) return
        this.synths.delete(id)
        if (frame.ok === true && typeof frame.file === "string") synth.resolve(frame.file)
        else if (frame.ok === true) synth.resolve(this.outPath(id))
        else synth.reject(new Error(typeof frame.error === "string" ? frame.error : "That line couldn't be spoken."))
      })
      child.on("exit", () => {
        clearTimeout(timer)
        reject(new Error("The voice process stopped while loading."))
      })
    })
    return true
  }

  private outPath(id: number): string {
    return path.join(os.tmpdir(), `ai-pair-voice-${process.pid}-${id}.wav`)
  }

  private synth(text: string): Promise<string> {
    const child = this.worker
    if (!child?.stdin?.writable) return Promise.reject(new Error("The voice isn't running."))
    const id = ++this.seq
    const { voice, rate } = this.options.config()
    return new Promise<string>((resolve, reject) => {
      this.synths.set(id, { resolve, reject })
      child.stdin!.write(`${JSON.stringify({ id, text, voice, speed: rate, out: this.outPath(id) })}\n`)
    })
  }

  /** Plays one WAV with the machine's own player. */
  private play(file: string): Promise<void> {
    const command = playerFor(file)
    if (!command) return Promise.reject(new Error("No way to play sound was found on this machine."))
    return this.run(command.cmd, command.args, true)
  }

  /** Runs a program to its end; as a player, it can be cut off with `stop`. */
  private run(cmd: string, args: string[], asPlayer: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
      if (asPlayer) this.player = child
      let err = ""
      child.stderr?.on("data", (data: Buffer) => (err += data.toString()))
      child.stdout?.on("data", (data: Buffer) => this.output.append(data.toString()))
      child.on("error", reject)
      child.on("exit", (code) => {
        if (this.player === child) this.player = undefined
        if (code === 0 || code === null) resolve()
        else reject(new Error(err.trim().split("\n").at(-1) || `${cmd} exited with code ${code}.`))
      })
    })
  }

  private killWorker(): void {
    const child = this.worker
    if (!child) return
    this.killingWorker = true
    this.worker = undefined
    child.stdin?.end()
    child.kill("SIGTERM")
  }

  private ompCommand(): string | undefined {
    return this.options.config().ompPath.trim() || findOmp(HOST)
  }

  /** A bun or node that can load the speech engine's native code; VS Code's own runtime cannot. */
  private jsRuntime(): string | undefined {
    const set = this.options.config().runtimePath.trim()
    if (set) return set
    const bun = which(HOST, "bun", [path.join(HOST.home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"])
    if (bun) return bun
    const node = which(HOST, "node", ["/opt/homebrew/bin", "/usr/local/bin", path.join(HOST.home, ".local", "bin")])
    if (node) return node
    for (const root of [path.join(HOST.home, ".nvm", "versions", "node"), path.join(HOST.home, ".local", "share", "mise", "installs", "node")]) {
      try {
        for (const name of fs.readdirSync(root).sort().reverse()) {
          const candidate = path.join(root, name, "bin", "node")
          if (fs.existsSync(candidate)) return candidate
        }
      } catch {
        // Not this machine's way of keeping node.
      }
    }
    return undefined
  }
}

/** Where OMP keeps its Kokoro runtime, newest first; undefined until OMP has spoken once. */
function findKokoroRuntime(): string | undefined {
  const roots = [
    path.join(path.dirname(ompFile(HOST)), "cache", "tts-runtime"),
    path.join(HOST.home, ".omp", "agent", "cache", "tts-runtime"),
  ]
  for (const root of roots) {
    try {
      for (const name of fs.readdirSync(root).sort().reverse()) {
        const dir = path.join(root, name)
        if (fs.existsSync(path.join(dir, "node_modules", "kokoro-js", "dist", "kokoro.js"))) return dir
      }
    } catch {
      // Not installed here.
    }
  }
  return undefined
}

let linuxPlayer: string | undefined

/** The machine's own way to play a WAV out loud. */
function playerFor(file: string): { cmd: string; args: string[] } | undefined {
  switch (process.platform) {
    case "darwin":
      return { cmd: "afplay", args: [file] }
    case "win32":
      return {
        cmd: "powershell.exe",
        args: ["-NoProfile", "-Command", `(New-Object System.Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`],
      }
    default: {
      linuxPlayer ??= ["pw-play", "paplay", "aplay", "ffplay"].find((name) => which(HOST, name)) ?? ""
      if (!linuxPlayer) return undefined
      return linuxPlayer === "ffplay" ? { cmd: linuxPlayer, args: ["-nodisp", "-autoexit", "-loglevel", "quiet", file] } : { cmd: linuxPlayer, args: [file] }
    }
  }
}
