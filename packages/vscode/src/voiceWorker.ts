// The warm voice: a small process (bun or node, never VS Code's own runtime, which refuses the
// speech engine's native code) that loads Kokoro once and makes one WAV per line it is given.
// Lines in: { id, text, voice, speed, out }. Lines out: { type: "ready" }, then per line
// { id, ok, seconds } or { id, ok: false, error }. AI_PAIR_KOKORO_PATH names the kokoro-js module
// to load — the copy the extension fetched into its own storage, so it is only ever downloaded once.

import * as fs from "node:fs"
import * as readline from "node:readline"
import { pathToFileURL } from "node:url"

type KokoroModule = {
  KokoroTTS: {
    from_pretrained(
      model: string,
      options: { dtype: string; device: string },
    ): Promise<{
      generate(text: string, options: { voice: string; speed: number }): Promise<{ audio: Float32Array; toWav(): Uint8Array }>
    }>
  }
}

const say = (frame: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(frame)}\n`)

const modulePath = process.env.AI_PAIR_KOKORO_PATH
if (!modulePath) {
  say({ type: "fatal", error: "AI_PAIR_KOKORO_PATH is not set." })
  process.exit(1)
}

// An untyped external module, loaded from wherever it was found on this machine.
const kokoro = (await import(pathToFileURL(modulePath).href)) as KokoroModule
const tts = await kokoro.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" })
say({ type: "ready" })

const lines = readline.createInterface({ input: process.stdin })
for await (const line of lines) {
  if (!line.trim()) continue
  let request: { id?: unknown; text?: unknown; voice?: unknown; speed?: unknown; out?: unknown }
  try {
    request = JSON.parse(line) as typeof request
  } catch {
    continue
  }
  const { id, text, voice, speed, out } = request
  if (typeof id !== "number" || typeof text !== "string" || typeof out !== "string") continue
  try {
    const audio = await tts.generate(text, {
      voice: typeof voice === "string" && voice ? voice : "af_heart",
      speed: typeof speed === "number" && speed > 0 ? speed : 1,
    })
    fs.writeFileSync(out, audio.toWav())
    say({ id, ok: true, seconds: audio.audio.length / 24000 })
  } catch (error) {
    say({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
