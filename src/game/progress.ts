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
//
// Points and levels are not accumulated per answer. They are worked out from two things:
// minutes practised (from the timestamps in the log) and how many items are Solid or Instant.

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
  /** No longer used. Kept so that an older build syncing with the same account keeps working. */
  xp: number;
  /**
   * Time practised that day in ms (see practiceStep). Stored, although it follows from the log,
   * because the log is capped and a reset of one exercise removes its answers from it.
   * Missing in data written by older builds; filled in from the log when the data is loaded.
   */
  ms?: number;
}

export interface SessionRecord {
  t: number;
  mode: Mode;
  key?: string;
  n: number;
  correct: number;
  avgMs: number;
  /** No longer used; see DayStat.xp. */
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
  /** No longer used; see DayStat.xp. Points are worked out by pointsOf(). */
  xp: number;
  days: Record<string, DayStat>;
  sessions: SessionRecord[];
  settings: Settings;
  /**
   * When statistics were last erased, per exercise or for everything. Sync uses it so that a
   * reset made in one browser is not undone by older answers arriving from another.
   */
  resets?: Resets;
}

/** `at` is when this record last changed; the newer record wins when two browsers sync. */
export type Resets = Partial<Record<Mode | 'all', number>> & { at: number };

export const FAST_MS = 2000;
export const SLOW_MS = 8000;
export const DAILY_GOAL = 40;
/** Attempts that count toward an item's status. */
export const RECENT_ATTEMPTS = 8;
/** Fewer attempts than this are averaged as if the missing ones scored 0. */
export const MIN_EVIDENCE = 4;
const TIME_ALPHA = 0.3;
export const MAX_SESSIONS = 300;
export const MAX_EVENTS = 30000;

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
// Points, levels, streaks
//
// Points = minutes practised + knowledge. One point per minute at the guitar, one per item that
// is Solid and two per item that is Instant, in all three exercises. Knowledge points follow the
// current status, so they (and with them the level) can drop a little when an item slips.

/** A pause between two answers longer than this is a break, not practice. */
export const MAX_GAP_MS = 30000;
export const POINTS_SOLID = 1;
export const POINTS_INSTANT = 2;

/**
 * Practice time one answer adds: the time since the previous answer when that was the same day
 * and at most 30 s ago (so the feedback pause and the root step count), otherwise the time the
 * answer itself took. `prevT` is when the previous answer in the log was given, in any exercise.
 */
export function practiceStep(prevT: number | null, e: { t: number; ms: number }): number {
  if (prevT !== null && dayKey(prevT) === dayKey(e.t)) {
    const gap = e.t - prevT;
    if (gap >= 0 && gap <= MAX_GAP_MS) return gap;
  }
  return Math.min(Math.max(0, Math.round(e.ms)), MAX_GAP_MS);
}

/** Practice time per day in ms, from a log in time order. */
export function practiceByDay(events: AnswerEvent[]): Record<string, number> {
  const days: Record<string, number> = {};
  let prevT: number | null = null;
  for (const e of events) {
    const day = dayKey(e.t);
    days[day] = (days[day] ?? 0) + practiceStep(prevT, e);
    prevT = e.t;
  }
  return days;
}

/** Total time practised in ms. */
export function practiceMs(data: Pick<ProgressData, 'days'>): number {
  return Object.values(data.days).reduce((sum, d) => sum + (d.ms ?? 0), 0);
}

export function knowledgePoints(stats: ProgressData['stats']): number {
  let points = 0;
  for (const mode of MODES) {
    for (const stat of Object.values(stats[mode] ?? {})) {
      const level = levelOf(stat);
      points += level === 4 ? POINTS_INSTANT : level === 3 ? POINTS_SOLID : 0;
    }
  }
  return points;
}

export interface Points {
  /** One per whole minute practised. */
  time: number;
  /** One per Solid item, two per Instant item. */
  knowledge: number;
  total: number;
}

export function pointsOf(data: Pick<ProgressData, 'days' | 'stats'>): Points {
  const time = Math.floor(practiceMs(data) / 60000);
  const knowledge = knowledgePoints(data.stats);
  return { time, knowledge, total: time + knowledge };
}

/** Points at which a level starts: 0, 30, 90, 180, 300, ... (level 10 at 1350). */
export function levelStart(level: number): number {
  return 15 * level * (level - 1);
}

export function levelInfo(points: number): { level: number; into: number; need: number } {
  let level = 1;
  while (levelStart(level + 1) <= points) level++;
  return { level, into: points - levelStart(level), need: levelStart(level + 1) - levelStart(level) };
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
}

export interface AnswerOutcome {
  data: ProgressData;
  before: MasteryLevel;
  after: MasteryLevel;
}

/** One more attempt on an item: `ok` is a first-try hit, `ms` the time it took. */
export function advanceStat(prev: ItemStat | undefined, ok: 0 | 1, ms: number, now: number): ItemStat {
  const prevMs = prev?.ms ?? 0;
  return {
    seen: (prev?.seen ?? 0) + 1,
    correct: (prev?.correct ?? 0) + ok,
    recent: [...(prev?.recent ?? []), ok ? speedScore(ms) : 0].slice(-RECENT_ATTEMPTS),
    ms: !ok ? prevMs : prevMs === 0 ? ms : prevMs + TIME_ALPHA * (Math.min(ms, 2 * SLOW_MS) - prevMs),
    last: now,
  };
}

export function applyAnswer(data: ProgressData, answer: AnswerInput, now: number): AnswerOutcome {
  const group = data.stats[answer.mode];
  const prev = group[answer.key];
  const before = levelOf(prev);
  const ok = answer.firstTry ? 1 : 0;
  const next = advanceStat(prev, ok, answer.ms, now);

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
  const last = data.events.length ? data.events[data.events.length - 1].t : null;
  // Data from an older build may lack the day's time; then it starts from what the log says.
  const dayMs = day.ms ?? practiceByDay(data.events)[today] ?? 0;
  const nextData: ProgressData = {
    ...data,
    stats: { ...data.stats, [answer.mode]: { ...group, [answer.key]: next } },
    events: [...data.events, event].slice(-MAX_EVENTS),
    days: { ...data.days, [today]: { ...day, answers: day.answers + 1, correct: day.correct + ok, ms: dayMs + practiceStep(last, event) } },
  };
  return { data: nextData, before, after: levelOf(next) };
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

export function normaliseSettings(raw: Partial<Settings> | undefined): Settings {
  const settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  if (!MODES.includes(settings.mode)) settings.mode = 'positions';
  if (!Array.isArray(settings.strings) || settings.strings.length !== STRING_COUNT) settings.strings = DEFAULT_SETTINGS.strings;
  if (!Array.isArray(settings.positions) || settings.positions.length !== 5) settings.positions = DEFAULT_SETTINGS.positions;
  return settings;
}

/**
 * Gives every day its practice time. Data from before points existed has none: it is worked out
 * from the log. A stored time is never lowered, because the log may no longer hold all of that
 * day's answers (log limit, or one exercise was reset).
 */
export function withPracticeTime(days: Record<string, DayStat>, events: AnswerEvent[]): Record<string, DayStat> {
  const fromLog = practiceByDay(events);
  const out: Record<string, DayStat> = {};
  for (const [key, day] of Object.entries(days)) out[key] = { ...day, ms: Math.max(day.ms ?? 0, fromLog[key] ?? 0) };
  return out;
}

/** Fills in anything missing from stored, synced or imported progress. */
export function normaliseProgress(raw: unknown): ProgressData {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProgressData>;
  const base = emptyProgress();
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const days = parsed.days && typeof parsed.days === 'object' ? parsed.days : {};
  return {
    ...base,
    ...parsed,
    v: 2,
    stats: { ...base.stats, ...(parsed.stats ?? {}) },
    events,
    xp: typeof parsed.xp === 'number' ? parsed.xp : 0,
    days: withPracticeTime(days, events),
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    settings: normaliseSettings(parsed.settings),
  };
}

function load(): ProgressData {
  try {
    if (typeof localStorage === 'undefined') return emptyProgress();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const v1 = localStorage.getItem(V1_KEY);
      return v1 ? migrateV1(JSON.parse(v1) as Record<string, unknown>) : emptyProgress();
    }
    return normaliseProgress(JSON.parse(raw));
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
    const now = Date.now();
    if (!mode) {
      progressStore.set({ ...emptyProgress(), settings: current.settings, resets: { at: now, all: now } });
      return;
    }
    progressStore.set({
      ...current,
      resets: { ...current.resets, at: now, [mode]: now },
      stats: { ...current.stats, [mode]: {} },
      events: current.events.filter((e) => e.m !== mode),
      sessions: current.sessions.filter((s) => s.mode !== mode),
    });
  },
};
