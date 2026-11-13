import {
  STRING_COUNT,
  STRING_NAMES,
  buildScale,
  fretsFor,
  isNatural,
  pcName,
  targetMidis,
  type Scale,
} from '../music/theory';
import { itemKey, scoreOf, type ItemStat, type Mode, type Settings } from './progress';

export interface PoolItem {
  string: number;
  pc: number;
  /** Degree label in the session's key ("3", "♭7"), for the scale-degree mode. */
  degree?: string;
}

export interface Question extends PoolItem {
  mode: Mode;
  /** The big thing to find: "C", "F♯/G♭", or "3rd". */
  prompt: string;
  /** Note name spelled for the key (degree mode) or plain (note modes). */
  noteName: string;
  stringName: string;
  /** Key context for degree mode: "G major". */
  context?: string;
  /** Exact MIDI pitches that are correct. */
  targets: number[];
  frets: number[];
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

export function buildPool(settings: Settings, scale: Scale | null): PoolItem[] {
  const pool: PoolItem[] = [];
  for (const string of enabledStrings(settings)) {
    if (settings.mode === 'degrees' && scale) {
      for (const note of scale.notes) pool.push({ string, pc: note.pc, degree: note.degree });
    } else {
      for (let pc = 0; pc < 12; pc++) {
        if (settings.naturalsOnly && !isNatural(pc)) continue;
        pool.push({ string, pc });
      }
    }
  }
  return pool;
}

export function toQuestion(item: PoolItem, mode: Mode, scale: Scale | null): Question {
  const scaleNote = item.degree && scale ? scale.notes.find((n) => n.degree === item.degree) : undefined;
  const noteName = scaleNote ? scaleNote.name : pcName(item.pc);
  return {
    ...item,
    mode,
    prompt: scaleNote ? scaleNote.ordinal : noteName,
    noteName,
    stringName: STRING_NAMES[item.string],
    context: scaleNote && scale ? scale.name : undefined,
    targets: targetMidis(item.string, item.pc),
    frets: fretsFor(item.string, item.pc),
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

const RECENT_WINDOW = 3;
const RETRY_GAP = 3;

/**
 * Picks what to ask next.
 * - Weak, slow, new and stale items come up more often (adaptive, like spaced repetition).
 * - An item you missed comes back a few questions later, while the correction is still fresh.
 * - Sweep mode walks one note across the strings, low to high (the classic "find every C" drill).
 */
export class Scheduler {
  private recent: string[] = [];
  private retries: { item: PoolItem; due: number }[] = [];
  private asked = 0;
  private sweepQueue: PoolItem[] = [];
  private lastSweepPc = -1;
  readonly scale: Scale | null;
  private readonly pool: PoolItem[];

  constructor(
    private readonly settings: Settings,
    private readonly getStat: StatLookup,
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {
    this.scale = settings.mode === 'degrees' ? buildScale(settings.tonic, settings.scaleId) : null;
    this.pool = buildPool(settings, this.scale);
  }

  next(): Question {
    const item = this.settings.mode === 'sweep' ? this.nextSweep() : this.nextAdaptive();
    this.asked++;
    this.recent.push(itemKey(item.string, item.pc));
    if (this.recent.length > RECENT_WINDOW) this.recent.shift();
    return toQuestion(item, this.settings.mode, this.scale);
  }

  /** Call when the player missed an item so it returns shortly. */
  requeue(item: PoolItem) {
    if (this.settings.mode === 'sweep') return;
    if (this.retries.some((r) => r.item.string === item.string && r.item.pc === item.pc)) return;
    this.retries.push({ item: { string: item.string, pc: item.pc, degree: item.degree }, due: this.asked + RETRY_GAP });
  }

  private weightOf(item: PoolItem): number {
    return itemWeight(this.getStat(itemKey(item.string, item.pc)), this.now());
  }

  private nextAdaptive(): PoolItem {
    const dueIdx = this.retries.findIndex((r) => r.due <= this.asked);
    if (dueIdx >= 0) return this.retries.splice(dueIdx, 1)[0].item;

    const lastPitch = this.recent.length ? this.recent[this.recent.length - 1] : null;
    let candidates = this.pool.filter((item) => !this.recent.includes(itemKey(item.string, item.pc)));
    if (candidates.length === 0) candidates = this.pool.filter((item) => itemKey(item.string, item.pc) !== lastPitch);
    if (candidates.length === 0) candidates = this.pool;
    return pickWeighted(candidates, candidates.map((item) => this.weightOf(item)), this.rng);
  }

  private nextSweep(): PoolItem {
    if (this.sweepQueue.length === 0) {
      const strings = enabledStrings(this.settings);
      const pcs: number[] = [];
      for (let pc = 0; pc < 12; pc++) {
        if (this.settings.naturalsOnly && !isNatural(pc)) continue;
        if (pc !== this.lastSweepPc) pcs.push(pc);
      }
      const weights = pcs.map((pc) => strings.reduce((sum, string) => sum + this.weightOf({ string, pc }), 0));
      const pc = pickWeighted(pcs, weights, this.rng);
      this.lastSweepPc = pc;
      this.sweepQueue = strings.map((string) => ({ string, pc }));
    }
    return this.sweepQueue.shift()!;
  }
}
