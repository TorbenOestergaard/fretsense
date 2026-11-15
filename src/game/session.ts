import { fretMidi, pcOf } from '../music/theory';
import type { Question, Scheduler } from './scheduler';

export type Phase = 'intro' | 'asking' | 'revealed' | 'feedback' | 'done';

export interface AnswerResult {
  question: Question;
  /** Right on the first note played, without the answer being shown. */
  firstTry: boolean;
  ms: number;
  /** Where the answer was played, when that is known (string modes, or a click). */
  string: number | null;
  fret: number | null;
  revealed: boolean;
  mistakes: number;
  /** Combo count after this answer. */
  combo: number;
}

export type Hint =
  | { kind: 'wrong'; midi: number }
  /** Right note name, but not the pitch of that note on the asked string. */
  | { kind: 'octave'; midi: number }
  | { kind: 'wrongString'; string: number };

export const REVEAL_AFTER_MS = 12000;
export const FEEDBACK_OK_MS = 1000;
export const FEEDBACK_MISS_MS = 2200;
/** Nobody reads a prompt and plays the note this fast; treat earlier sounds as leftovers. */
const MIN_REACTION_MS = 150;

/**
 * One practice round as a small state machine, independent of audio and UI.
 *
 * intro -> (play the root, or skip) -> asking      [scale positions only, when the box changes]
 * asking -> (correct note) -> feedback -> next question
 * asking -> (12 s or skip) -> revealed -> (play it, or skip) -> feedback -> next question
 *
 * A wrong note does not end the question: you keep looking until you find it, because finding it
 * yourself is what builds the memory. It does mark the question as a miss for the statistics.
 *
 * Entering a new scale box starts with an untimed step: play the root. Getting your hand into
 * the box is not what is being measured, so the clock only runs for the degrees that follow.
 * Another pass through the box you are already in does not repeat that step.
 */
export class Session {
  phase: Phase = 'asking';
  index = 0;
  question: Question;
  askedAt: number;
  hint: Hint | null = null;
  combo = 0;
  bestCombo = 0;
  results: AnswerResult[] = [];
  lastResult: AnswerResult | null = null;
  private mistakes = 0;
  private revealed = false;
  private feedbackUntil = 0;

  constructor(
    private readonly scheduler: Scheduler,
    public total: number,
    now: number,
    private readonly onResult: (result: AnswerResult) => void = () => {},
  ) {
    this.question = scheduler.next();
    this.askedAt = now;
    if (this.question.position) this.phase = 'intro';
  }

  /** Pitches of the root inside the current box. */
  private rootMidis(): number[] {
    const position = this.question.position;
    if (!position) return [];
    return position.cells.filter((c) => c.degree === '1').map((c) => fretMidi(c.string, c.fret));
  }

  private begin(t: number) {
    this.phase = 'asking';
    this.askedAt = t;
    this.hint = null;
  }

  /** A new note started sounding. */
  noteOn(midi: number, t: number) {
    if (this.phase === 'intro') {
      if (t - this.askedAt >= MIN_REACTION_MS && this.rootMidis().includes(midi)) this.begin(t);
      return;
    }
    if (this.phase !== 'asking' && this.phase !== 'revealed') return;
    if (t - this.askedAt < MIN_REACTION_MS) return;
    if (this.question.targets.includes(midi)) this.resolve(t, true, midi);
  }

  /** A note has been held long enough to count as a deliberate answer. */
  noteHeld(midi: number, t: number) {
    if (this.phase !== 'asking' && this.phase !== 'revealed') return;
    if (t - this.askedAt < MIN_REACTION_MS) return;
    if (this.question.targets.includes(midi)) return;
    if (pcOf(midi) === this.question.pc) {
      // Same note name in another octave: a different string, or the detector slipped an octave.
      // Nudge without punishing.
      this.hint = { kind: 'octave', midi };
      return;
    }
    this.miss({ kind: 'wrong', midi });
  }

  /** Fallback input without a guitar: clicking a fret on the on-screen fretboard. */
  click(string: number, fret: number, t: number) {
    const midi = fretMidi(string, fret);
    if (this.phase === 'intro') {
      if (this.question.position?.cells.some((c) => c.degree === '1' && c.string === string && c.fret === fret)) this.begin(t);
      return;
    }
    if (this.phase !== 'asking' && this.phase !== 'revealed') return;
    if (this.question.string !== null && string !== this.question.string) {
      this.miss({ kind: 'wrongString', string });
      return;
    }
    if (this.question.cells.some((c) => c.string === string && c.fret === fret)) this.resolve(t, true, midi, string);
    else if (pcOf(midi) === this.question.pc) this.hint = { kind: 'octave', midi };
    else this.miss({ kind: 'wrong', midi });
  }

  /** Space bar: start the box, show the answer, or move on once it is shown. */
  skip(t: number) {
    if (this.phase === 'intro') this.begin(t);
    else if (this.phase === 'asking') this.reveal();
    else if (this.phase === 'revealed') this.resolve(t, false);
    else if (this.phase === 'feedback') this.advance(t);
  }

  /** Drive timeouts. Returns true when something changed. */
  tick(t: number): boolean {
    if (this.phase === 'asking' && t - this.askedAt >= REVEAL_AFTER_MS) {
      this.reveal();
      return true;
    }
    if (this.phase === 'feedback' && t >= this.feedbackUntil) {
      this.advance(t);
      return true;
    }
    return false;
  }

  private miss(hint: Hint) {
    this.mistakes++;
    this.combo = 0;
    this.hint = hint;
  }

  private reveal() {
    this.revealed = true;
    this.combo = 0;
    this.phase = 'revealed';
  }

  private resolve(t: number, played: boolean, midi?: number, clickedString?: number) {
    const firstTry = played && !this.revealed && this.mistakes === 0;
    if (firstTry) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    } else {
      this.combo = 0;
      if (this.scheduler.requeue(this.question)) this.total++;
    }
    const string = this.question.string ?? clickedString ?? null;
    const result: AnswerResult = {
      question: this.question,
      firstTry,
      ms: t - this.askedAt,
      string,
      fret: midi !== undefined && string !== null ? midi - fretMidi(string, 0) : null,
      revealed: this.revealed,
      mistakes: this.mistakes,
      combo: this.combo,
    };
    this.results.push(result);
    this.lastResult = result;
    this.hint = null;
    this.phase = 'feedback';
    this.feedbackUntil = t + (firstTry ? FEEDBACK_OK_MS : FEEDBACK_MISS_MS);
    this.onResult(result);
  }

  private advance(t: number) {
    this.index++;
    if (this.index >= this.total) {
      this.phase = 'done';
      return;
    }
    const previous = this.question.position;
    this.question = this.scheduler.next();
    this.askedAt = t;
    this.mistakes = 0;
    this.revealed = false;
    this.hint = null;
    this.phase = this.question.position && this.question.position !== previous ? 'intro' : 'asking';
  }
}
