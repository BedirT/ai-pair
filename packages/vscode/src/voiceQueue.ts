// The order words are spoken in: one sentence is made while the one before it plays, and a queue
// that falls behind drops its oldest lines instead of reading stale news. No audio here: making
// and playing a sentence are the backend's, so this can be tested with fakes.

import { splitSentences, spokenText } from "./voiceText"

export type SpeechBackend<T> = {
  /** Makes one sentence ready to play. */
  synth(text: string): Promise<T>
  /** Plays it, settling when it ends or is stopped. */
  play(token: T): Promise<void>
  /** Cuts off whatever is playing now. */
  stopPlaying(): void
  /** Frees a played (or dropped) sentence: deletes its file, say. */
  release?(token: T): void
}

/** Sentences waiting their turn before the oldest unstarted ones are dropped as stale. */
const MAX_WAITING = 6

type Job = { text: string; done: () => void }

export class SpeechQueue<T> {
  private jobs: Job[] = []
  private running = false
  /** Bumped by `stop`, so a loop still holding an old sentence knows to let go of it. */
  private generation = 0

  constructor(private readonly backend: SpeechBackend<T>) {}

  /** How many sentences are waiting, unstarted. */
  get waiting(): number {
    return this.jobs.length
  }

  /** Speaks a `say`. Settles when its last sentence has played, or was dropped or stopped. */
  speak(raw: string): Promise<void> {
    const sentences = splitSentences(spokenText(raw))
    if (sentences.length === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let left = sentences.length
      const one = () => {
        if (--left === 0) resolve()
      }
      for (const text of sentences) this.jobs.push({ text, done: one })
      while (this.jobs.length > MAX_WAITING) this.jobs.shift()!.done()
      void this.pump()
    })
  }

  /** Cuts off the current sentence and drops everything waiting. */
  stop(): void {
    this.generation++
    const waiting = this.jobs
    this.jobs = []
    for (const job of waiting) job.done()
    this.backend.stopPlaying()
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    const gen = this.generation
    let ahead: { job: Job; token: Promise<T | undefined> } | undefined
    const startNext = () => {
      const job = this.jobs.shift()
      return job ? { job, token: this.backend.synth(job.text).catch(() => undefined) } : undefined
    }
    try {
      ahead = startNext()
      while (ahead && gen === this.generation) {
        const current = ahead
        const token = await current.token
        if (gen !== this.generation) {
          if (token !== undefined) this.backend.release?.(token)
          current.job.done()
          ahead = undefined
          break
        }
        ahead = startNext()
        if (token !== undefined) {
          await this.backend.play(token).catch(() => {})
          this.backend.release?.(token)
        }
        current.job.done()
      }
      if (gen !== this.generation && ahead) {
        // A sentence made ahead for a queue that was stopped: free it and let its `speak` settle.
        const dropped = ahead
        void dropped.token.then((token) => {
          if (token !== undefined) this.backend.release?.(token)
          dropped.job.done()
        })
      }
    } finally {
      this.running = false
      if (gen === this.generation && this.jobs.length > 0) void this.pump()
    }
  }
}
