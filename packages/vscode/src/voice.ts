// The agent's voice, on this machine, kept warm in its own small process and fed one sentence at a
// time: the next is made while the last is still sounding. Two engines: Kokoro, the local speech
// model OMP ships (bun or node runs it, since VS Code's runtime refuses its native code), and
// Chatterbox Turbo, more natural but heavier, on Apple Silicon's GPU through mlx-audio (uv runs it).
// With no warm Kokoro to be had, `omp say` speaks each line itself: slower to start, but the same
// voice, still local.

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

/** Which speech model talks. */
export type VoiceModel = "kokoro" | "chatterbox"

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

/** Chatterbox runs on the GPU of an Apple Silicon Mac; nowhere else is it quick enough to keep up. */
const CHATTERBOX_HERE = process.platform === "darwin" && process.arch === "arm64"

/**
 * What uv runs Chatterbox with: a pinned mlx-audio, since the worker reaches into its Chatterbox
 * model for the built-in voice, and the 4-bit model, about 1.5 times faster than it speaks on an M3.
 */
const MLX_AUDIO = "mlx-audio==0.5.9"
const CHATTERBOX_MODEL = "mlx-community/chatterbox-turbo-4bit"

/**
 * The session's speed carries over to the voice up to here: faster is hard to follow. Below 1 it
 * doesn't carry over at all, since a slowed voice drawls; the extra time goes to pauses instead.
 */
const MAX_PACE = 2

/** The fastest and slowest a line is ever spoken, all speedups together: past 2× words blur. */
const TALK_RANGE = { min: 0.5, max: 2 }

export type VoiceOptions = {
  extensionPath: string
  config(): {
    enabled: boolean
    model: VoiceModel
    /** The Kokoro voice. */
    voice: string
    /** A recording Chatterbox speaks like; empty for its own voice. */
    chatterboxVoice: string
    /** How fast the voice talks, on top of the session's speed. */
    rate: number
    /** The session's speed: the panel's speed menu. */
    pace: number
    runtimePath: string
    ompPath: string
  }
  /** Writes the `aiPair.voice.enabled` setting. */
  setEnabled(on: boolean): void
  /** Writes `aiPair.voice.model`, and `aiPair.voice.voice` or `aiPair.voice.chatterboxVoice` to match. */
  setVoice(model: VoiceModel, voice: string): Promise<void>
}

type Synth = { resolve: (file: string) => void; reject: (error: Error) => void }

export class VoiceEngine implements VoicePort, VoicePanelPort {
  private queue?: SpeechQueue<string>
  private worker?: ChildProcess
  private killingWorker = false
  private player?: ChildProcess
  private seq = 0
  private readonly synths = new Map<number, Synth>()
  /** Chatterbox's recordings to play faster or slower than made, by file. Only it plays them: it's Mac-only. */
  private readonly playbackRates = new Map<string, number>()
  private state: VoiceStatus["state"] = "off"
  private detail: string | undefined
  private on = false
  /** The model the running (or starting) voice uses; a different one in the settings means a restart. */
  private model: VoiceModel | undefined
  /** Bumped per start, so a start overtaken by a newer one, or by turning off, quietly lets go. */
  private startSeq = 0
  private starting: Promise<void> | undefined
  private readonly output = vscode.window.createOutputChannel("AI Pair Voice")

  constructor(
    private readonly panel: NarrationPanel,
    private readonly options: VoiceOptions,
  ) {}

  get ready(): boolean {
    return this.state === "ready"
  }

  get enabled(): boolean {
    return this.on
  }

  status(): VoiceStatus {
    const config = this.options.config()
    const voice = config.model === "kokoro" ? config.voice : config.chatterboxVoice ? `chatterbox: ${path.basename(config.chatterboxVoice)}` : "chatterbox"
    return { enabled: this.on, state: this.state, voice, detail: this.detail }
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
      this.startSeq++
      this.shutDown()
      this.state = "off"
      this.detail = undefined
      this.publish()
      return
    }
    if (this.state === "ready" || this.state === "loading") {
      this.publish()
      return
    }
    this.begin(allowSetup)
  }

  /** The model setting changed: a voice that is on starts over with the new one. */
  followModel(allowSetup: boolean): void {
    if (!this.on || this.options.config().model === this.model) {
      this.publish()
      return
    }
    this.shutDown()
    this.begin(allowSetup)
  }

  pickVoice(): void {
    void (async () => {
      const config = this.options.config()
      type Item = vscode.QuickPickItem & { model?: VoiceModel; voice?: string; browse?: boolean }
      const mark = (model: VoiceModel, voice: string) => (config.model === model && (model === "kokoro" ? config.voice : config.chatterboxVoice) === voice ? "current" : undefined)
      const items: Item[] = [
        { label: "Kokoro · light, works everywhere", kind: vscode.QuickPickItemKind.Separator },
        ...VOICES.map((v): Item => ({ label: v.label, description: mark("kokoro", v.id) ?? v.id, model: "kokoro", voice: v.id })),
      ]
      if (CHATTERBOX_HERE) {
        const recording = config.chatterboxVoice
        items.push(
          { label: "Chatterbox · more natural, Apple Silicon, about 1.3 GB fetched once", kind: vscode.QuickPickItemKind.Separator },
          { label: "Chatterbox's own voice", description: mark("chatterbox", ""), model: "chatterbox", voice: "" },
          ...(recording ? [{ label: path.basename(recording), description: mark("chatterbox", recording) ?? "the recording you chose", model: "chatterbox" as const, voice: recording }] : []),
          { label: "Sound like a recording…", description: "10 seconds or more of one person speaking clearly", browse: true },
        )
      }
      const picked = await vscode.window.showQuickPick(items, { title: "Whose voice should the agent have?", placeHolder: "All of them run on this machine." })
      if (!picked) return
      let model = picked.model
      let voice = picked.voice
      if (picked.browse) {
        const files = await vscode.window.showOpenDialog({
          title: "A recording of the voice: one person, speaking clearly, who agreed to be copied",
          canSelectMany: false,
          filters: { Audio: ["wav", "mp3", "flac", "m4a"] },
        })
        if (!files?.[0]) return
        model = "chatterbox"
        voice = files[0].fsPath
      }
      if (!model || voice === undefined) return
      const sameModel = model === this.model
      await this.options.setVoice(model, voice)
      if (!this.on) return
      if (sameModel) {
        this.publish()
        if (this.ready) void this.speak("Hi. I'll talk while we code.")
        return
      }
      this.followModel(true)
      await this.starting
      if (this.ready) void this.speak("Hi. I'll talk while we code.")
    })()
  }

  // The queue fits speech to the typing at the voice's own pace, so the span it gets is in those terms.
  speak(text: string, spanMs?: number, onStart?: () => void, signal?: AbortSignal): Promise<void> {
    if (this.queue && this.ready) return this.queue.speak(text, (spanMs ?? 0) * this.pace(), onStart, signal)
    onStart?.()
    return Promise.resolve()
  }

  prepare(text: string, spanMs: number): void {
    if (this.queue && this.ready) this.queue.prepare(text, spanMs * this.pace())
  }

  /** How many times its own pace the voice talks at, before fitting a line to its typing. */
  private pace(): number {
    const { rate, pace } = this.options.config()
    return rate * Math.min(MAX_PACE, Math.max(1, pace))
  }

  stop(): void {
    this.queue?.stop()
  }

  dispose(): void {
    this.startSeq++
    this.shutDown()
    this.output.dispose()
  }

  private publish(): void {
    this.panel.showVoiceStatus(this.status())
  }

  private begin(allowSetup: boolean): void {
    const seq = ++this.startSeq
    this.starting = this.start(allowSetup, seq).catch((error: unknown) => {
      if (seq !== this.startSeq) return
      this.state = "error"
      this.detail = error instanceof Error ? error.message : String(error)
      this.publish()
      if (allowSetup) void vscode.window.showErrorMessage(`AI Pair couldn't start the voice: ${this.detail}`)
    })
  }

  /** Stops whatever is speaking and the process behind it. */
  private shutDown(): void {
    this.queue?.stop()
    this.queue = undefined
    this.killWorker()
    this.model = undefined
  }

  private async start(allowSetup: boolean, seq: number): Promise<void> {
    const model = this.options.config().model
    this.model = model
    this.state = "loading"
    this.detail = undefined
    this.publish()
    const warmed = model === "chatterbox" ? (await this.warmChatterbox(allowSetup), true) : await this.warmKokoro(allowSetup)
    if (seq !== this.startSeq) return
    if (warmed) {
      this.queue = new SpeechQueue<string>({
        synth: (text, speedScale) => this.synth(text, speedScale),
        play: (file) => this.play(file),
        stopPlaying: () => this.player?.kill("SIGTERM"),
        release: (file) => {
          this.playbackRates.delete(file)
          fs.rm(file, { force: true }, () => {})
        },
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
  private async warmKokoro(allowSetup: boolean): Promise<boolean> {
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
    const kokoroPath = path.join(runtime, "node_modules", "kokoro-js", "dist", "kokoro.js")
    await this.spawnWorker(js, [path.join(this.options.extensionPath, "dist", "voiceWorker.js")], {
      cwd: runtime,
      env: { ...process.env, AI_PAIR_KOKORO_PATH: kokoroPath },
      timeoutMs: 300_000,
    })
    return true
  }

  /**
   * Starts the warm Chatterbox process under uv, or says why it can't. Only a person's click may
   * fetch: uv's packages and the model (about 1.3 GB together, kept in uv's and Hugging Face's
   * caches) are otherwise only used if they are already on the machine.
   */
  private async warmChatterbox(allowSetup: boolean): Promise<void> {
    if (!CHATTERBOX_HERE) throw new Error("Chatterbox runs on Apple Silicon Macs only. Pick a Kokoro voice instead.")
    const uv = which(HOST, "uv", [path.join(HOST.home, ".local", "bin"), path.join(HOST.home, ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin"])
    if (!uv) throw new Error("Chatterbox is run by uv, which wasn't found. Install it (https://docs.astral.sh/uv/), or pick a Kokoro voice.")
    const args = ["tool", "run", ...(allowSetup ? [] : ["--offline"]), "--from", MLX_AUDIO, "python", path.join(this.options.extensionPath, "dist", "chatterboxWorker.py")]
    const env = { ...process.env, AI_PAIR_CHATTERBOX_MODEL: CHATTERBOX_MODEL, TQDM_DISABLE: "1", ...(allowSetup ? {} : { HF_HUB_OFFLINE: "1" }) }
    const warm = () => this.spawnWorker(uv, args, { env, timeoutMs: allowSetup ? 1_800_000 : 120_000 })
    if (!allowSetup) {
      await warm().catch((error: unknown) => {
        throw new Error(`Chatterbox couldn't start from what's already downloaded (${error instanceof Error ? error.message : String(error)}). Turn the voice off and on to fetch it.`)
      })
      return
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "AI Pair: starting Chatterbox (the first time fetches about 1.3 GB)…" },
      warm,
    )
  }

  /** Runs a voice worker and waits for its `ready`; its replies then settle the sentences asked of it. */
  private async spawnWorker(cmd: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<void> {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] })
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
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The voice took too long to load.")), options.timeoutMs)
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
          reject(new Error(typeof frame.error === "string" ? frame.error : "The voice couldn't load."))
          return
        }
        const id = frame.id
        if (typeof id !== "number") return
        const synth = this.synths.get(id)
        if (!synth) return
        this.synths.delete(id)
        if (frame.ok === true) synth.resolve(this.outPath(id))
        else synth.reject(new Error(typeof frame.error === "string" ? frame.error : "That line couldn't be spoken."))
      })
      child.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on("exit", () => {
        clearTimeout(timer)
        reject(new Error("The voice process stopped while loading. Its words are in the AI Pair Voice output."))
      })
    })
    // A worker that never got ready (too slow, or stuck) would otherwise linger unseen.
    await loaded.catch((error: unknown) => {
      if (this.worker === child) this.killWorker()
      throw error
    })
  }

  private outPath(id: number): string {
    return path.join(os.tmpdir(), `ai-pair-voice-${process.pid}-${id}.wav`)
  }

  private synth(text: string, speedScale: number): Promise<string> {
    const child = this.worker
    if (!child?.stdin?.writable) return Promise.reject(new Error("The voice isn't running."))
    const id = ++this.seq
    const { model, voice, chatterboxVoice } = this.options.config()
    const speed = Math.min(TALK_RANGE.max, Math.max(TALK_RANGE.min, this.pace() * speedScale))
    const out = this.outPath(id)
    // Chatterbox has no pace to set: it talks at its own, and its recording is played faster or slower.
    const request = model === "chatterbox" ? { id, text, voice: chatterboxVoice, out } : { id, text, voice, speed, out }
    if (model === "chatterbox" && speed !== 1) this.playbackRates.set(out, speed)
    return new Promise<string>((resolve, reject) => {
      this.synths.set(id, { resolve, reject })
      child.stdin!.write(`${JSON.stringify(request)}\n`)
    })
  }

  /** Plays one WAV with the machine's own player, at the rate it was made to be played at. */
  private play(file: string): Promise<void> {
    const rate = this.playbackRates.get(file)
    this.playbackRates.delete(file)
    const command = playerFor(file, rate)
    if (!command) return Promise.reject(new Error("No way to play sound was found on this machine."))
    return this.run(command.cmd, command.args, true)
  }

  /** Runs a program to its end; as a player, it can be cut off with `stop`, and the panel knows it's sounding. */
  private run(cmd: string, args: string[], asPlayer: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
      if (asPlayer) {
        this.player = child
        this.panel.showSpeaking(true)
      }
      let err = ""
      child.stderr?.on("data", (data: Buffer) => (err += data.toString()))
      child.stdout?.on("data", (data: Buffer) => this.output.append(data.toString()))
      const finished = () => {
        if (this.player !== child) return
        this.player = undefined
        this.panel.showSpeaking(false)
      }
      child.on("error", (error) => {
        finished()
        reject(error)
      })
      child.on("exit", (code) => {
        finished()
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

/** The machine's own way to play a WAV out loud; `rate`, on a Mac, faster or slower at the same pitch. */
function playerFor(file: string, rate?: number): { cmd: string; args: string[] } | undefined {
  switch (process.platform) {
    case "darwin":
      return { cmd: "afplay", args: rate === undefined ? [file] : ["--rate", String(rate), "--rQuality", "1", file] }
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
