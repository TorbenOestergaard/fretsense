import type { Frame } from './pitch';

export type NoteEvent =
  /** A new note started (a new pitch, or the same pitch plucked again). */
  | { type: 'on'; midi: number; t: number }
  /** That note has now rung long enough to be deliberate rather than a brush or a slide. */
  | { type: 'held'; midi: number; t: number };

export interface TrackerOptions {
  /** Consecutive agreeing frames before a note counts. */
  confirmFrames: number;
  /** Frames without the note before it is considered over. */
  releaseFrames: number;
  holdMs: number;
  /** Level jump, relative to the quietest point of the ringing note, that means "plucked again". */
  repluckRatio: number;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  confirmFrames: 3,
  releaseFrames: 4,
  holdMs: 260,
  repluckRatio: 2.2,
};

const FLICKER_WINDOW_MS = 1500;
const REPLUCK_MIN_AGE_MS = 120;

/**
 * Turns the frame-by-frame pitch stream into discrete note events.
 *
 * The raw stream is messy: pick attacks are unpitched, a decaying note flickers in and out, and
 * the previous answer is usually still ringing when the next question appears. The tracker emits
 * exactly one "on" per pluck, so a ringing note can never answer a later question by accident.
 */
export class NoteTracker {
  private current: { midi: number; startT: number; held: boolean; minRms: number; lastRms: number } | null = null;
  private candidate: number | null = null;
  private candidateCount = 0;
  private missCount = 0;
  private lost: { midi: number; t: number; rms: number } | null = null;

  constructor(private readonly opts: TrackerOptions = DEFAULT_TRACKER) {}

  reset() {
    this.current = null;
    this.candidate = null;
    this.candidateCount = 0;
    this.missCount = 0;
    this.lost = null;
  }

  push(frame: Frame): NoteEvent[] {
    const events: NoteEvent[] = [];
    const cur = this.current;

    if (cur && frame.midi === cur.midi) {
      this.missCount = 0;
      this.candidate = null;
      this.candidateCount = 0;
      const age = frame.t - cur.startT;
      if (age <= REPLUCK_MIN_AGE_MS) {
        // The level is still building while the analysis window fills with the new note;
        // take the peak of the attack as the baseline instead of mistaking it for a second pluck.
        cur.minRms = Math.max(cur.minRms, frame.rms);
        cur.lastRms = frame.rms;
        return events;
      }
      if (frame.rms > cur.minRms * this.opts.repluckRatio) {
        this.start(frame, events);
        return events;
      }
      cur.minRms = Math.min(cur.minRms, frame.rms);
      cur.lastRms = frame.rms;
      if (!cur.held && age >= this.opts.holdMs) {
        cur.held = true;
        events.push({ type: 'held', midi: cur.midi, t: frame.t });
      }
      return events;
    }

    if (cur) {
      this.missCount++;
      if (this.missCount >= this.opts.releaseFrames) {
        this.lost = { midi: cur.midi, t: frame.t, rms: cur.lastRms };
        this.current = null;
      }
    }

    if (frame.midi === null) {
      this.candidate = null;
      this.candidateCount = 0;
      return events;
    }

    if (frame.midi === this.candidate) this.candidateCount++;
    else {
      this.candidate = frame.midi;
      this.candidateCount = 1;
    }
    if (this.candidateCount < this.opts.confirmFrames) return events;

    // A fading note that drops out and creeps back in is the same pluck, not a new one.
    const lost = this.lost;
    const flicker =
      !this.current &&
      lost !== null &&
      lost.midi === frame.midi &&
      frame.t - lost.t < FLICKER_WINDOW_MS &&
      frame.rms < lost.rms * 1.5;
    if (flicker) {
      this.current = { midi: frame.midi, startT: frame.t, held: true, minRms: frame.rms, lastRms: frame.rms };
      this.afterConfirm();
      return events;
    }
    this.start(frame, events);
    return events;
  }

  private start(frame: Frame, events: NoteEvent[]) {
    const midi = frame.midi!;
    this.current = { midi, startT: frame.t, held: false, minRms: frame.rms, lastRms: frame.rms };
    this.afterConfirm();
    events.push({ type: 'on', midi, t: frame.t });
  }

  private afterConfirm() {
    this.candidate = null;
    this.candidateCount = 0;
    this.missCount = 0;
    this.lost = null;
  }
}
