import { STRING_COUNT, type ScaleId } from '../music/theory';

// ---------------------------------------------------------------------------
// What is tracked
//
// The unit of memory is "this note on this string": 6 strings x 12 pitch classes = 72 items.
// (Fret 12 repeats the open string, so frets 0-12 are covered by 72 items.)
// For each item we keep a moving average of how long a correct first-try answer takes and how
// often the first try is right. Mastery is "right, and fast" - recall, not working it out.

export type Mode = 'notes' | 'degrees' | 'sweep';

export interface ItemStat {
  seen: number;
  correct: number;
  /** Moving average response time in ms. A miss counts as SLOW_MS. */
  ewmaMs: number;
  /** Moving average of first-try correctness, 0..1. */
  acc: number;
  last: number;
}

export interface DegreeStat {
  seen: number;
  correct: number;
  ewmaMs: number;
}

export interface DayStat {
  answers: number;
  correct: number;
  xp: number;
}

export interface SessionRecord {
  t: number;
  mode: Mode;
  key?: string;
  n: number;
  correct: number;
  avgMs: number;
  xp: number;
}

export type Sensitivity = 'low' | 'normal' | 'high';

export interface Settings {
  mode: Mode;
  strings: boolean[];
  naturalsOnly: boolean;
  length: number;
  tonic: string;
  scaleId: ScaleId;
  sensitivity: Sensitivity;
  deviceId: string | null;
}

export interface ProgressData {
  v: 1;
  items: Record<string, ItemStat>;
  degrees: Record<string, DegreeStat>;
  xp: number;
  days: Record<string, DayStat>;
  sessions: SessionRecord[];
  settings: Settings;
}

export const FAST_MS = 2000;
export const SLOW_MS = 8000;
export const DAILY_GOAL = 40;
const TIME_ALPHA = 0.35;
const ACC_ALPHA = 0.3;
const MAX_SESSIONS = 200;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'notes',
  strings: new Array(STRING_COUNT).fill(true),
  naturalsOnly: true,
  length: 20,
  tonic: 'C',
  scaleId: 'major',
  sensitivity: 'normal',
  deviceId: null,
};

export function emptyProgress(): ProgressData {
  return { v: 1, items: {}, degrees: {}, xp: 0, days: {}, sessions: [], settings: { ...DEFAULT_SETTINGS } };
}

export function itemKey(string: number, pc: number): string {
  return `${string}:${pc}`;
}

// ---------------------------------------------------------------------------
// Mastery

/** 0..1, or null if never practised. */
export function scoreOf(stat: ItemStat | undefined): number | null {
  if (!stat || stat.seen === 0) return null;
  const speed = Math.min(1, Math.max(0, (SLOW_MS - stat.ewmaMs) / (SLOW_MS - FAST_MS)));
  return stat.acc * speed;
}

export const MASTERY_LABELS = ['New', 'Shaky', 'Learning', 'Solid', 'Instant'] as const;
export type MasteryLevel = 0 | 1 | 2 | 3 | 4;

/** 0 new, 1 shaky, 2 learning, 3 solid, 4 instant. */
export function levelOf(stat: ItemStat | undefined): MasteryLevel {
  const score = scoreOf(stat);
  if (score === null) return 0;
  if (score >= 0.85 && stat!.seen >= 3) return 4;
  if (score >= 0.65) return 3;
  if (score >= 0.4) return 2;
  return 1;
}

export interface MasterySummary {
  counts: number[];
  /** Items at "solid" or better. */
  solid: number;
  total: number;
  perString: { solid: number; total: number }[];
}

export function masterySummary(data: ProgressData): MasterySummary {
  const counts = [0, 0, 0, 0, 0];
  const perString = Array.from({ length: STRING_COUNT }, () => ({ solid: 0, total: 12 }));
  for (let s = 0; s < STRING_COUNT; s++) {
    for (let pc = 0; pc < 12; pc++) {
      const level = levelOf(data.items[itemKey(s, pc)]);
      counts[level]++;
      if (level >= 3) perString[s].solid++;
    }
  }
  return { counts, solid: counts[3] + counts[4], total: STRING_COUNT * 12, perString };
}

// ---------------------------------------------------------------------------
// XP, levels, streaks

export function xpFor(firstTry: boolean, ms: number, combo: number): number {
  if (!firstTry) return 2;
  const speedBonus = Math.round(10 * Math.min(1, Math.max(0, (6000 - ms) / 4500)));
  const multiplier = combo >= 10 ? 2 : combo >= 5 ? 1.5 : 1;
  return Math.round((10 + speedBonus) * multiplier);
}

export function levelInfo(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remaining = xp;
  let need = 200;
  while (remaining >= need) {
    remaining -= need;
    level++;
    need = 200 + 100 * (level - 1);
  }
  return { level, into: remaining, need };
}

export function dayKey(t: number): string {
  const date = new Date(t);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${day}`;
}

/** Consecutive days on which the daily goal was met. Today not being done yet does not break it. */
export function streakOf(days: Record<string, DayStat>, now: number): number {
  const met = (t: number) => (days[dayKey(t)]?.correct ?? 0) >= DAILY_GOAL;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!met(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (met(cursor.getTime())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Recording answers

export interface AnswerInput {
  string: number;
  pc: number;
  degree?: string;
  firstTry: boolean;
  ms: number;
  combo: number;
}

export interface AnswerOutcome {
  data: ProgressData;
  xp: number;
  before: MasteryLevel;
  after: MasteryLevel;
}

export function applyAnswer(data: ProgressData, answer: AnswerInput, now: number): AnswerOutcome {
  const key = itemKey(answer.string, answer.pc);
  const prev = data.items[key];
  const before = levelOf(prev);
  const sampleMs = answer.firstTry ? Math.min(SLOW_MS, answer.ms) : SLOW_MS;
  const sampleAcc = answer.firstTry ? 1 : 0;
  const next: ItemStat = prev
    ? {
        seen: prev.seen + 1,
        correct: prev.correct + sampleAcc,
        ewmaMs: prev.ewmaMs + TIME_ALPHA * (sampleMs - prev.ewmaMs),
        acc: prev.acc + ACC_ALPHA * (sampleAcc - prev.acc),
        last: now,
      }
    : { seen: 1, correct: sampleAcc, ewmaMs: sampleMs, acc: sampleAcc, last: now };

  const degrees = { ...data.degrees };
  if (answer.degree) {
    const dPrev = degrees[answer.degree];
    degrees[answer.degree] = dPrev
      ? {
          seen: dPrev.seen + 1,
          correct: dPrev.correct + sampleAcc,
          ewmaMs: dPrev.ewmaMs + TIME_ALPHA * (sampleMs - dPrev.ewmaMs),
        }
      : { seen: 1, correct: sampleAcc, ewmaMs: sampleMs };
  }

  const xp = xpFor(answer.firstTry, answer.ms, answer.combo);
  const today = dayKey(now);
  const day = data.days[today] ?? { answers: 0, correct: 0, xp: 0 };
  const nextData: ProgressData = {
    ...data,
    items: { ...data.items, [key]: next },
    degrees,
    xp: data.xp + xp,
    days: { ...data.days, [today]: { answers: day.answers + 1, correct: day.correct + sampleAcc, xp: day.xp + xp } },
  };
  return { data: nextData, xp, before, after: levelOf(next) };
}

export function addSession(data: ProgressData, record: SessionRecord): ProgressData {
  return { ...data, sessions: [...data.sessions, record].slice(-MAX_SESSIONS) };
}

// ---------------------------------------------------------------------------
// Store (localStorage)

const STORAGE_KEY = 'fretsense.progress.v1';

function load(): ProgressData {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<ProgressData>;
    const base = emptyProgress();
    const settings = { ...base.settings, ...(parsed.settings ?? {}) };
    if (!Array.isArray(settings.strings) || settings.strings.length !== STRING_COUNT) {
      settings.strings = base.settings.strings;
    }
    return { ...base, ...parsed, v: 1, settings };
  } catch {
    return emptyProgress();
  }
}

let state: ProgressData | null = null;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: keep playing with in-memory progress.
  }
}

export const progressStore = {
  get(): ProgressData {
    if (!state) state = load();
    return state;
  },
  set(next: ProgressData) {
    state = next;
    persist();
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  updateSettings(patch: Partial<Settings>) {
    const current = progressStore.get();
    progressStore.set({ ...current, settings: { ...current.settings, ...patch } });
  },
  record(answer: AnswerInput, now: number): AnswerOutcome {
    const outcome = applyAnswer(progressStore.get(), answer, now);
    progressStore.set(outcome.data);
    return outcome;
  },
  addSession(record: SessionRecord) {
    progressStore.set(addSession(progressStore.get(), record));
  },
  reset() {
    const settings = progressStore.get().settings;
    progressStore.set({ ...emptyProgress(), settings });
  },
};
