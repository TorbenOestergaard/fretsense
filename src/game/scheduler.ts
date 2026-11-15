import {
  STRING_COUNT,
  STRING_NAMES,
  buildScale,
  fretMidi,
  fretsFor,
  isNatural,
  pcName,
  positionsOf,
  targetMidis,
  type Scale,
  type ScalePosition,
} from '../music/theory';
import { itemKey, noteChoice, positionKey, scoreOf, type ItemStat, type Mode, type Settings } from './progress';

export interface PoolItem {
  /** The string to play on, or null when anywhere inside a scale position counts. */
  string: number | null;
  pc: number;
  /** Degree label in the session's key ("3", "♭7"), for scale-position practice. */
  degree?: string;
  position?: ScalePosition;
}

export interface Question extends PoolItem {
  mode: Mode;
  /** Key of this item in the mode's statistics. */
  key: string;
  /** "C on the G string", "5th in position 2". */
  label: string;
  /** The big thing to find: "C", "F♯/G♭", or "3rd". */
  prompt: string;
  /** Note name spelled for the key (positions) or plain (note modes). */
  noteName: string;
  stringName?: string;
  /** Key context for positions: "G major". */
  context?: string;
  /** Exact MIDI pitches that are correct. */
  targets: number[];
  /** Every place on the board that is a correct answer. */
  cells: { string: number; fret: number }[];
}

export type StatLookup = (key: string) => ItemStat | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How much an item wants to be asked. Weak and stale items weigh more; mastered ones still recur. */
export function itemWeight(stat: ItemStat | undefined, now: number): number {
  const score = scoreOf(stat);
  if (score === null) return 1.2;
  const weakness = Math.pow(1 - score, 1.5) * 1.6;
  const staleDays = Math.min(7, Math.max(0, (now - stat!.last) / DAY_MS));
  return 0.12 + weakness + staleDays * 0.05;
}

export function enabledStrings(settings: Settings): number[] {
  const strings: number[] = [];
  for (let s = 0; s < STRING_COUNT; s++) if (settings.strings[s]) strings.push(s);
  return strings.length ? strings : [0, 1, 2, 3, 4, 5];
}

export function enabledPositions(settings: Settings): number[] {
  const positions = [0, 1, 2, 3, 4].filter((p) => settings.positions[p]);
  return positions.length ? positions : [0, 1, 2, 3, 4];
}

/** The notes that are asked: the naturals, the sharps and flats, or all twelve. */
export function enabledNotes(settings: Settings): number[] {
  const { naturals, accidentals } = noteChoice(settings);
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((pc) => (isNatural(pc) ? naturals : accidentals));
}

export function buildPool(settings: Settings): PoolItem[] {
  const notes = enabledNotes(settings);
  return enabledStrings(settings).flatMap((string) => notes.map((pc) => ({ string, pc })));
}

export function toQuestion(item: PoolItem, mode: Mode, scale: Scale | null): Question {
  if (item.position && item.degree && scale) {
    const note = scale.notes.find((n) => n.degree === item.degree)!;
    const cells = item.position.cells.filter((c) => c.degree === item.degree).map(({ string, fret }) => ({ string, fret }));
    return {
      ...item,
      mode,
      key: positionKey(scale.type.id, item.position.index, item.degree),
      label: `${note.ordinal} in position ${item.position.index + 1}`,
      prompt: note.ordinal,
      noteName: note.name,
      context: scale.name,
      targets: [...new Set(cells.map((c) => fretMidi(c.string, c.fret)))],
      cells,
    };
  }
  const string = item.string ?? 0;
  const noteName = pcName(item.pc);
  return {
    ...item,
    string,
    mode,
    key: itemKey(string, item.pc),
    label: `${pcName(item.pc, 'sharp')} on the ${STRING_NAMES[string]} string`,
    prompt: noteName,
    noteName,
    stringName: STRING_NAMES[string],
    targets: targetMidis(string, item.pc),
    cells: fretsFor(string, item.pc).map((fret) => ({ string, fret })),
  };
}

function pickWeighted<T>(items: T[], weights: number[], rng: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Size of a Scale positions round: the chosen length rounded to whole boxes, with every selected
 * box visited at least once.
 */
export function positionRoundSize(length: number, degrees: number, boxes: number): { passes: number; questions: number } {
  const passes = Math.max(boxes, Math.round(length / degrees));
  return { passes, questions: passes * degrees };
}

const RECENT_WINDOW = 3;
const RETRY_GAP = 3;

/**
 * Picks what to ask next.
 * - Note finder: weak, slow, new and stale items come up more often (adaptive, like spaced
 *   repetition), and an item you missed comes back a few questions later.
 * - String sweep: one note across the strings, low to high (the classic "find every C" drill).
 * - Scale positions: one box at a time; every degree of the scale once, in random order, then
 *   the next selected box, cycling (with a fresh order each pass) until the round length is
 *   reached. A missed degree is asked again before the box is left.
 */
export class Scheduler {
  private recent: string[] = [];
  private retries: { item: PoolItem; due: number }[] = [];
  private asked = 0;
  private queue: PoolItem[] = [];
  private lastSweepPc = -1;
  private retried = new Set<string>();
  /** Scale positions: the selected boxes, and how many box passes have been queued so far. */
  private readonly boxes: number[];
  private boxPass = 0;
  private lastItem: PoolItem | null = null;
  readonly scale: Scale | null;
  readonly positions: ScalePosition[];
  private readonly pool: PoolItem[];

  constructor(
    private readonly settings: Settings,
    private readonly getStat: StatLookup,
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {
    this.scale = settings.mode === 'positions' ? buildScale(settings.tonic, settings.scaleId) : null;
    this.positions = this.scale ? positionsOf(this.scale) : [];
    this.pool = this.scale ? [] : buildPool(settings);
    this.boxes = this.scale ? enabledPositions(settings) : [];
  }

  /**
   * How many boxes a Scale positions round walks through. The round length is rounded to whole
   * boxes, and every selected box is visited at least once. With fewer boxes selected than that,
   * the round keeps cycling through them.
   */
  private boxPasses(): number {
    return positionRoundSize(this.settings.length, this.scale?.notes.length ?? 1, this.boxes.length).passes;
  }

  /** Queues every degree of the next box in a fresh random order. */
  private fillBox() {
    const scale = this.scale!;
    const position = this.positions[this.boxes[this.boxPass % this.boxes.length]];
    this.boxPass++;
    const degrees = scale.notes.map((n) => n.degree);
    for (let i = degrees.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [degrees[i], degrees[j]] = [degrees[j], degrees[i]];
    }
    // Staying in the same box: do not open the new pass with the degree that was just asked.
    if (position === this.lastItem?.position && degrees[0] === this.lastItem.degree && degrees.length > 1) {
      [degrees[0], degrees[degrees.length - 1]] = [degrees[degrees.length - 1], degrees[0]];
    }
    this.retried.clear();
    this.queue = degrees.map((degree) => ({ string: null, pc: scale.notes.find((n) => n.degree === degree)!.pc, degree, position }));
  }

  /** Number of questions in a round, before any repeats of missed degrees. */
  roundLength(): number {
    if (this.settings.mode === 'positions') return this.boxPasses() * this.scale!.notes.length;
    if (this.settings.mode === 'sweep') {
      const strings = enabledStrings(this.settings).length;
      return Math.max(1, Math.round(this.settings.length / strings)) * strings;
    }
    return this.settings.length;
  }

  next(): Question {
    const mode = this.settings.mode;
    const item = mode === 'positions' ? this.nextInBox() : mode === 'sweep' ? this.nextSweep() : this.nextAdaptive();
    this.lastItem = item;
    this.asked++;
    const question = toQuestion(item, mode, this.scale);
    this.recent.push(question.key);
    if (this.recent.length > RECENT_WINDOW) this.recent.shift();
    return question;
  }

  /**
   * Call when the player missed an item so it returns shortly.
   * Returns true when that adds a question to the round.
   */
  requeue(item: Question): boolean {
    if (this.settings.mode === 'sweep') return false;
    if (this.settings.mode === 'positions') {
      if (this.retried.has(item.key)) return false;
      this.retried.add(item.key);
      // Ask it again as the last question of this pass of the box (the queue holds one box).
      this.queue.push({ string: null, pc: item.pc, degree: item.degree, position: item.position });
      return true;
    }
    if (this.retries.some((r) => r.item.string === item.string && r.item.pc === item.pc)) return false;
    this.retries.push({ item: { string: item.string, pc: item.pc }, due: this.asked + RETRY_GAP });
    return false;
  }

  private keyOf(item: PoolItem): string {
    return itemKey(item.string ?? 0, item.pc);
  }

  private weightOf(item: PoolItem): number {
    return itemWeight(this.getStat(this.keyOf(item)), this.now());
  }

  private nextAdaptive(): PoolItem {
    const dueIdx = this.retries.findIndex((r) => r.due <= this.asked);
    if (dueIdx >= 0) return this.retries.splice(dueIdx, 1)[0].item;

    const last = this.recent.length ? this.recent[this.recent.length - 1] : null;
    let candidates = this.pool.filter((item) => !this.recent.includes(this.keyOf(item)));
    if (candidates.length === 0) candidates = this.pool.filter((item) => this.keyOf(item) !== last);
    if (candidates.length === 0) candidates = this.pool;
    return pickWeighted(candidates, candidates.map((item) => this.weightOf(item)), this.rng);
  }

  private nextInBox(): PoolItem {
    if (this.queue.length === 0) this.fillBox();
    return this.queue.shift()!;
  }

  private nextSweep(): PoolItem {
    if (this.queue.length === 0) {
      const strings = enabledStrings(this.settings);
      const pcs = enabledNotes(this.settings).filter((pc) => pc !== this.lastSweepPc);
      const weights = pcs.map((pc) => strings.reduce((sum, string) => sum + this.weightOf({ string, pc }), 0));
      const pc = pickWeighted(pcs, weights, this.rng);
      this.lastSweepPc = pc;
      this.queue = strings.map((string) => ({ string, pc }));
    }
    return this.queue.shift()!;
  }
}
