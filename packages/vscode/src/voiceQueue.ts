// The order words are spoken in: one sentence is made while the one before it plays, and a queue
// that falls behind drops its oldest lines instead of reading stale news. Duplex pacing lives
// here too: given how long the typing a `say` covers will take, its sentences are spread across
// that span — a touch slower or faster, with pauses between sentences — so the talking and the
// typing run together and finish about together. No audio here: making and playing a sentence
// are the backend's, so this can be tested with fakes.

import { splitSentences, spokenText } from "./voiceText"

export type SpeechBackend<T> = {
  /** Makes one sentence ready to play, at `speedScale` times its ordinary pace (1 unless fitting a span). */
  synth(text: string, speedScale: number): Promise<T>
  /** Plays it, settling when it ends or is stopped. */
  play(token: T): Promise<void>
  /** Cuts off whatever is playing now. */
  stopPlaying(): void
  /** Frees a played (or dropped) sentence: deletes its file, say. */
  release?(token: T): void
}

/** Sentences waiting their turn before the oldest unstarted ones are dropped as stale. */
const MAX_WAITING = 6

/** About how long a word takes to say: how spans are fitted. Rough is fine; ears forgive. */
const MS_PER_WORD = 380

/** The most a sentence is held back to spread speech over typing: longer reads as a stall. */
const MAX_GAP_MS = 3000

type Job = { text: string; done: () => void; speedScale: number; gapBeforeMs: number }

export class SpeechQueue<T> {
  private jobs: Job[] = []
  private running = false
  /** Bumped by `stop`, so a loop still holding an old sentence knows to let go of it. */
  private generation = 0
  /** Cancels a between-sentences pause in flight. */
  private cancelGap: (() => void) | undefined

  constructor(private readonly backend: SpeechBackend<T>) {}

  /** How many sentences are waiting, unstarted. */
  get waiting(): number {
    return this.jobs.length
  }

  /**
   * Speaks a `say`, spread across `spanMs` when given: the time the work it covers takes to play.
   * Settles when its last sentence has played, or was dropped or stopped.
   */
  speak(raw: string, spanMs = 0): Promise<void> {
    const sentences = splitSentences(spokenText(raw))
    if (sentences.length === 0) return Promise.resolve()
    const estimates = sentences.map((s) => Math.max(1, s.split(/\s+/).filter(Boolean).length) * MS_PER_WORD)
    const total = estimates.reduce((a, b) => a + b, 0)
    // Fit the span with pace first (a touch either way; more sounds wrong), then with pauses.
    const speedScale = spanMs > 0 ? Math.min(1.3, Math.max(0.85, total / spanMs)) : 1
    const fitted = total / speedScale
    const extra = spanMs > fitted ? Math.min(spanMs, fitted * 1.6) - fitted : 0
    const gap = sentences.length > 1 ? Math.min(extra / (sentences.length - 1), MAX_GAP_MS) : 0
    return new Promise<void>((resolve) => {
      let left = sentences.length
      const one = () => {
        if (--left === 0) resolve()
      }
      sentences.forEach((text, i) => this.jobs.push({ text, done: one, speedScale, gapBeforeMs: i === 0 ? 0 : gap }))
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
    this.cancelGap?.()
    this.backend.stopPlaying()
  }

  /** A pause between sentences, cut short by `stop`. */
  private gapWait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.cancelGap = undefined
        resolve()
      }, ms)
      this.cancelGap = () => {
        clearTimeout(timer)
        this.cancelGap = undefined
        resolve()
      }
    })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    const gen = this.generation
    let ahead: { job: Job; token: Promise<T | undefined> } | undefined
    const startNext = () => {
      const job = this.jobs.shift()
      return job ? { job, token: this.backend.synth(job.text, job.speedScale).catch(() => undefined) } : undefined
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
          if (current.job.gapBeforeMs > 0) await this.gapWait(current.job.gapBeforeMs)
          if (gen === this.generation) await this.backend.play(token).catch(() => {})
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
