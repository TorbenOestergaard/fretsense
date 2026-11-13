import { STRING_COUNT, type ScaleId } from '../music/theory';

// ---------------------------------------------------------------------------
// What is tracked
//
// Every exercise keeps its own statistics, because they are not equally hard: finding a note
// cold (Note finder) is slower than repeating a note you were just told across the strings
// (String sweep), and finding a degree inside a scale box is a different skill again.
//
// - notes / sweep: one item per "this note on this string" (6 strings x 12 notes = 72).
// - positions: one item per "this degree in this box of this scale type" (key-independent).
//
// Mastery of an item is the average of its last few attempts, where an attempt scores 0 for a
// miss and 0..1 by speed for a first-try hit. Averaging over a window damps the status in both
// directions: one slip does not undo a known note, and one lucky hit does not make it "instant".
//
// Every answer is also appended to an event log, from which the Progress view derives average
// times per string, note, fret, position and day.

export type Mode = 'notes' | 'positions' | 'sweep';
export const MODES: Mode[] = ['notes', 'positions', 'sweep'];
export const MODE_TITLES: Record<Mode, string> = {
  notes: 'Note finder',
  positions: 'Scale positions',
  sweep: 'String sweep',
};

export interface ItemStat {
  seen: number;
  correct: number;
  /** Scores (0..1) of the most recent attempts, newest last. */
  recent: number[];
  /** Moving average time of first-try answers in ms; 0 until there is one. */
  ms: number;
  last: number;
}

export interface AnswerEvent {
  t: number;
  m: Mode;
  /** Item key within the mode. */
  k: string;
  /** String and fret that were played, or -1 when not applicable. */
  s: number;
  f: number;
  pc: number;
  ms: number;
  ok: 0 | 1;
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
export type PositionHelp = 'roots' | 'shape' | 'none';

export interface Settings {
  mode: Mode;
  strings: boolean[];
  naturalsOnly: boolean;
  length: number;
  tonic: string;
  scaleId: ScaleId;
  /** Which of the five boxes to practise. */
  positions: boolean[];
  /** What the board shows while a degree is being asked. */
  positionHelp: PositionHelp;
  sensitivity: Sensitivity;
  deviceId: string | null;
}

export interface ProgressData {
  v: 2;
  stats: Record<Mode, Record<string, ItemStat>>;
  events: AnswerEvent[];
  xp: number;
  days: Record<string, DayStat>;
  sessions: SessionRecord[];
  settings: Settings;
}

export const FAST_MS = 2000;
export const SLOW_MS = 8000;
export const DAILY_GOAL = 40;
/** Attempts that count toward an item's status. */
export const RECENT_ATTEMPTS = 8;
/** Fewer attempts than this are averaged as if the missing ones scored 0. */
export const MIN_EVIDENCE = 4;
const TIME_ALPHA = 0.3;
const MAX_SESSIONS = 300;
const MAX_EVENTS = 30000;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'notes',
  strings: new Array(STRING_COUNT).fill(true),
  naturalsOnly: true,
  length: 20,
  tonic: 'C',
  scaleId: 'major',
  positions: [true, true, true, true, true],
  positionHelp: 'roots',
  sensitivity: 'normal',
  deviceId: null,
};

export function emptyProgress(): ProgressData {
  return {
    v: 2,
    stats: { notes: {}, positions: {}, sweep: {} },
    events: [],
    xp: 0,
    days: {},
    sessions: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function itemKey(string: number, pc: number): string {
  return `${string}:${pc}`;
}

export function positionKey(scaleId: ScaleId, position: number, degree: string): string {
  return `${scaleId}:${position}:${degree}`;
}

// ---------------------------------------------------------------------------
// Mastery

export function speedScore(ms: number): number {
  return Math.min(1, Math.max(0, (SLOW_MS - ms) / (SLOW_MS - FAST_MS)));
}

/** 0..1, or null if never practised. */
export function scoreOf(stat: ItemStat | undefined): number | null {
  if (!stat || stat.seen === 0 || stat.recent.length === 0) return null;
  const sum = stat.recent.reduce((a, b) => a + b, 0);
  return sum / Math.max(stat.recent.length, MIN_EVIDENCE);
}

export const MASTERY_LABELS = ['New', 'Shaky', 'Learning', 'Solid', 'Instant'] as const;
export type MasteryLevel = 0 | 1 | 2 | 3 | 4;

/** 0 new, 1 shaky, 2 learning, 3 solid, 4 instant. */
export function levelOf(stat: ItemStat | undefined): MasteryLevel {
  const score = scoreOf(stat);
  if (score === null) return 0;
  if (score >= 0.85) return 4;
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

/** Summary of the 72 string/note items of the Note finder or the String sweep. */
export function masterySummary(data: ProgressData, mode: 'notes' | 'sweep' = 'notes'): MasterySummary {
  const counts = [0, 0, 0, 0, 0];
  const perString = Array.from({ length: STRING_COUNT }, () => ({ solid: 0, total: 12 }));
  for (let s = 0; s < STRING_COUNT; s++) {
    for (let pc = 0; pc < 12; pc++) {
      const level = levelOf(data.stats[mode][itemKey(s, pc)]);
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
  mode: Mode;
  /** Item key within the mode: itemKey() or positionKey(). */
  key: string;
  pc: number;
  /** String and fret that were played, when known. */
  string?: number | null;
  fret?: number | null;
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
  const group = data.stats[answer.mode];
  const prev = group[answer.key];
  const before = levelOf(prev);
  const ok = answer.firstTry ? 1 : 0;
  const attempt = answer.firstTry ? speedScore(answer.ms) : 0;
  const prevMs = prev?.ms ?? 0;
  const next: ItemStat = {
    seen: (prev?.seen ?? 0) + 1,
    correct: (prev?.correct ?? 0) + ok,
    recent: [...(prev?.recent ?? []), attempt].slice(-RECENT_ATTEMPTS),
    ms: !answer.firstTry ? prevMs : prevMs === 0 ? answer.ms : prevMs + TIME_ALPHA * (Math.min(answer.ms, 2 * SLOW_MS) - prevMs),
    last: now,
  };

  const xp = xpFor(answer.firstTry, answer.ms, answer.combo);
  const today = dayKey(now);
  const day = data.days[today] ?? { answers: 0, correct: 0, xp: 0 };
  const event: AnswerEvent = {
    t: now,
    m: answer.mode,
    k: answer.key,
    s: answer.string ?? -1,
    f: answer.fret ?? -1,
    pc: answer.pc,
    ms: Math.round(answer.ms),
    ok,
  };
  const nextData: ProgressData = {
    ...data,
    stats: { ...data.stats, [answer.mode]: { ...group, [answer.key]: next } },
    events: [...data.events, event].slice(-MAX_EVENTS),
    xp: data.xp + xp,
    days: { ...data.days, [today]: { answers: day.answers + 1, correct: day.correct + ok, xp: day.xp + xp } },
  };
  return { data: nextData, xp, before, after: levelOf(next) };
}

export function addSession(data: ProgressData, record: SessionRecord): ProgressData {
  return { ...data, sessions: [...data.sessions, record].slice(-MAX_SESSIONS) };
}

// ---------------------------------------------------------------------------
// Store (localStorage)

const STORAGE_KEY = 'fretsense.progress.v2';
const V1_KEY = 'fretsense.progress.v1';

interface V1Item {
  seen: number;
  correct: number;
  ewmaMs: number;
  acc: number;
  last: number;
}

/**
 * Version 1 kept one set of note statistics for all exercises. Those become the Note finder's
 * starting point: each note keeps roughly the status it had, and real attempts replace the
 * carried-over values within a few answers.
 */
export function migrateV1(old: Record<string, unknown>): ProgressData {
  const base = emptyProgress();
  const items = (old.items ?? {}) as Record<string, V1Item>;
  for (const [key, item] of Object.entries(items)) {
    if (!item || !item.seen) continue;
    const score = Math.min(1, Math.max(0, item.acc * speedScore(item.ewmaMs)));
    base.stats.notes[key] = {
      seen: item.seen,
      correct: item.correct,
      recent: new Array(Math.min(item.seen, RECENT_ATTEMPTS)).fill(score),
      ms: item.ewmaMs,
      last: item.last,
    };
  }
  const sessions = Array.isArray(old.sessions) ? (old.sessions as SessionRecord[]) : [];
  return {
    ...base,
    xp: typeof old.xp === 'number' ? old.xp : 0,
    days: (old.days ?? {}) as Record<string, DayStat>,
    sessions: sessions.filter((s) => s.mode === 'notes' || s.mode === 'sweep'),
    settings: normaliseSettings(old.settings as Partial<Settings> | undefined),
  };
}

function normaliseSettings(raw: Partial<Settings> | undefined): Settings {
  const settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  if (!MODES.includes(settings.mode)) settings.mode = 'positions';
  if (!Array.isArray(settings.strings) || settings.strings.length !== STRING_COUNT) settings.strings = DEFAULT_SETTINGS.strings;
  if (!Array.isArray(settings.positions) || settings.positions.length !== 5) settings.positions = DEFAULT_SETTINGS.positions;
  return settings;
}

function load(): ProgressData {
  try {
    if (typeof localStorage === 'undefined') return emptyProgress();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const v1 = localStorage.getItem(V1_KEY);
      return v1 ? migrateV1(JSON.parse(v1) as Record<string, unknown>) : emptyProgress();
    }
    const parsed = JSON.parse(raw) as Partial<ProgressData>;
    const base = emptyProgress();
    return {
      ...base,
      ...parsed,
      v: 2,
      stats: { ...base.stats, ...(parsed.stats ?? {}) },
      events: Array.isArray(parsed.events) ? parsed.events : [],
      settings: normaliseSettings(parsed.settings),
    };
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
  /** Erase the statistics of one exercise, or everything. */
  reset(mode?: Mode) {
    const current = progressStore.get();
    if (!mode) {
      progressStore.set({ ...emptyProgress(), settings: current.settings });
      return;
    }
    progressStore.set({
      ...current,
      stats: { ...current.stats, [mode]: {} },
      events: current.events.filter((e) => e.m !== mode),
      sessions: current.sessions.filter((s) => s.mode !== mode),
    });
  },
};
