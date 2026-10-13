// The speech queue: sentences in order, made ahead, dropped when stale, cut off on stop.
// Making and playing are fakes whose promises the test settles; no real waits.

import { expect, it, vi } from "vitest"
import { SpeechQueue } from "../src/voiceQueue"
import { splitSentences, spokenText } from "../src/voiceText"

type Settler = { resolve: () => void }

function fakeBackend() {
  const made: string[] = []
  const speeds: number[] = []
  const played: string[] = []
  const released: string[] = []
  const synths = new Map<string, Settler>()
  const plays = new Map<string, Settler>()
  let stopped = 0
  const backend = {
    synth: (text: string, speedScale: number) => {
      made.push(text)
      speeds.push(speedScale)
      return new Promise<string>((resolve) => synths.set(text, { resolve: () => resolve(text) }))
    },
    play: (token: string) => {
      played.push(token)
      return new Promise<void>((resolve) => plays.set(token, { resolve }))
    },
    stopPlaying: () => {
      stopped++
      for (const p of plays.values()) p.resolve()
      plays.clear()
    },
    release: (token: string) => released.push(token),
  }
  const settleSynth = (text: string) => synths.get(text)!.resolve()
  const settlePlay = (text: string) => plays.get(text)!.resolve()
  const tick = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { backend, made, speeds, played, released, settleSynth, settlePlay, tick, stops: () => stopped }
}

it("makes the next sentence while the last one plays, in order", async () => {
  const f = fakeBackend()
  const queue = new SpeechQueue<string>(f.backend)
  const done = queue.speak("One here. Two here.")
  expect(f.made).toEqual(["One here."])
  f.settleSynth("One here.")
  await f.tick()
  expect(f.played).toEqual(["One here."])
  expect(f.made).toEqual(["One here.", "Two here."]) // already being made, mid-play
  f.settlePlay("One here.")
  f.settleSynth("Two here.")
  await f.tick()
  expect(f.played).toEqual(["One here.", "Two here."])
  f.settlePlay("Two here.")
  await done
  expect(f.released).toEqual(["One here.", "Two here."])
})

it("stop cuts the line off and settles every speak", async () => {
  const f = fakeBackend()
  const queue = new SpeechQueue<string>(f.backend)
  const first = queue.speak("One here. Two here.")
  const second = queue.speak("Three here.")
  f.settleSynth("One here.")
  await f.tick()
  queue.stop()
  // The prefetched line settles when its making does.
  f.settleSynth("Two here.")
  await f.tick()
  await first
  await second
  expect(f.stops()).toBe(1)
  expect(f.played).toEqual(["One here."])
})

it("drops the oldest waiting lines when speech falls behind", async () => {
  const f = fakeBackend()
  const queue = new SpeechQueue<string>(f.backend)
  void queue.speak("First line.") // starts at once, never settles its making
  const speaks = []
  for (let i = 0; i < 9; i++) speaks.push(queue.speak(`Line ${i}.`))
  let settled = 0
  for (const s of speaks) void s.then(() => settled++)
  await f.tick()
  expect(queue.waiting).toBeLessThanOrEqual(6)
  expect(settled).toBeGreaterThan(0) // the dropped ones settled without a sound
  queue.stop()
})

it("spreads sentences across the span they cover, a touch slower and with pauses", async () => {
  vi.useFakeTimers()
  try {
    const f = fakeBackend()
    const queue = new SpeechQueue<string>(f.backend)
    // Two 3-word sentences: about 2280 ms of talk for 6000 ms of typing.
    const done = queue.speak("One two three. Four five six.", 6000)
    expect(f.speeds[0]).toBeCloseTo(0.85) // as slow as still sounds right
    f.settleSynth("One two three.")
    await f.tick()
    expect(f.played).toEqual(["One two three."])
    f.settlePlay("One two three.")
    f.settleSynth("Four five six.")
    await f.tick()
    // The second sentence waits out its share of the typing before it sounds.
    expect(f.played).toEqual(["One two three."])
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.played).toEqual(["One two three.", "Four five six."])
    f.settlePlay("Four five six.")
    await done
  } finally {
    vi.useRealTimers()
  }
})

it("cleans words for the ear and splits them to be spoken", () => {
  expect(spokenText("Now in `src/game.ts`, see [the docs](https://x.dev) and https://y.dev/a")).toBe(
    "Now in src/game.ts, see the docs and a link",
  )
  expect(spokenText("Type this:\n```ts\nconst x = 1\n```\nDone.")).toBe("Type this: Done.")
  expect(splitSentences("One. Two? Three! Four")).toEqual(["One.", "Two?", "Three!", "Four"])
})
