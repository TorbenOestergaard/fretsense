import {
  MAX_EVENTS,
  MAX_SESSIONS,
  MODES,
  advanceStat,
  dayKey,
  normaliseProgress,
  normaliseSettings,
  practiceByDay,
  practiceMs,
  type AnswerEvent,
  type DayStat,
  type ItemStat,
  type Mode,
  type ProgressData,
  type Resets,
  type SessionRecord,
  type Settings,
} from '../game/progress';

// ---------------------------------------------------------------------------
// Merging progress from two browsers
//
// The answer log is the source of truth: two logs are combined by taking every answer that is
// in either one, once. Counters (per-item statistics, per-day totals and practice time) are then
// worked out again from the combined log, so nothing is lost and nothing is counted twice.
// Merging the same data a second time changes nothing. Points and levels follow from the
// statistics and the practice time, so two merged browsers show what one browser with the
// combined log would show.
//
// Some history is not in the log (progress carried over from version 1, or answers beyond the
// log's size limit). Each side's "more than its log explains" remainder is kept, taking the
// larger of the two rather than adding them, because both browsers got it from the same place.

/** Settings that describe this computer rather than the player, and so are not synced. */
const DEVICE_SETTINGS = ['deviceId', 'sensitivity'] as const;
export type SyncedSettings = Omit<Settings, (typeof DEVICE_SETTINGS)[number]>;

/** What is stored on the server and written to backup files. */
export type SyncDoc = Omit<ProgressData, 'settings'> & { settings: SyncedSettings };

export function toSyncDoc(data: ProgressData): SyncDoc {
  const { deviceId: _deviceId, sensitivity: _sensitivity, ...settings } = data.settings;
  return { ...data, settings };
}

/** Reads a document from the server or a file; device settings fall back to the defaults. */
export function fromSyncDoc(raw: unknown): ProgressData {
  return normaliseProgress(raw);
}

const eventId = (e: AnswerEvent) => `${e.t}|${e.m}|${e.k}`;
const itemId = (mode: Mode, key: string) => `${mode}|${key}`;

function cutoff(resets: Resets | undefined, mode: Mode): number {
  return Math.max(resets?.[mode] ?? 0, resets?.all ?? 0);
}

function daysFromEvents(events: AnswerEvent[]): Record<string, DayStat> {
  const days: Record<string, DayStat> = {};
  const time = practiceByDay(events);
  for (const e of events) {
    const day = (days[dayKey(e.t)] ??= { answers: 0, correct: 0, xp: 0, ms: time[dayKey(e.t)] ?? 0 });
    day.answers++;
    day.correct += e.ok;
  }
  return days;
}

/** Drops what a reset (made here or in another browser) erased. */
function applyResets(side: ProgressData, resets: Resets | undefined): ProgressData {
  if (!resets || MODES.every((m) => cutoff(resets, m) === 0)) return side;
  const events = side.events.filter((e) => e.t > cutoff(resets, e.m));
  const stats = { ...side.stats };
  for (const mode of MODES) {
    const limit = cutoff(resets, mode);
    if (limit > cutoff(side.resets, mode)) {
      // This side has not seen the reset yet: its counters still include erased answers, so
      // they are rebuilt from what it logged afterwards.
      const kept = groupEvents(events.filter((e) => e.m === mode), (e) => e.k);
      stats[mode] = Object.fromEntries([...kept].map(([key, list]) => [key, replay(list)!]));
    } else {
      stats[mode] = Object.fromEntries(Object.entries(side.stats[mode] ?? {}).filter(([, stat]) => stat.last > limit));
    }
  }
  const sessions = side.sessions.filter((s) => s.t > cutoff(resets, s.mode));
  // "Reset everything" also clears the day totals. A browser that has not seen that reset yet
  // keeps only what it did afterwards.
  const missedFullReset = (resets.all ?? 0) > (side.resets?.all ?? 0);
  const days = missedFullReset ? daysFromEvents(events) : side.days;
  return { ...side, events, stats, sessions, days, xp: missedFullReset ? 0 : side.xp };
}

function groupEvents<K>(events: AnswerEvent[], keyOf: (e: AnswerEvent) => K): Map<K, AnswerEvent[]> {
  const groups = new Map<K, AnswerEvent[]>();
  for (const e of events) {
    const key = keyOf(e);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

const okCount = (events: AnswerEvent[] | undefined) => (events ?? []).reduce((n, e) => n + e.ok, 0);

function replay(events: AnswerEvent[]): ItemStat | undefined {
  let stat: ItemStat | undefined;
  for (const e of events) stat = advanceStat(stat, e.ok, e.ms, e.t);
  return stat;
}

function mergeStat(a: ItemStat | undefined, b: ItemStat | undefined, evA: AnswerEvent[], evB: AnswerEvent[], merged: AnswerEvent[]): ItemStat | undefined {
  const seen = merged.length + Math.max(0, (a?.seen ?? 0) - evA.length, (b?.seen ?? 0) - evB.length);
  const correct = okCount(merged) + Math.max(0, (a?.correct ?? 0) - okCount(evA), (b?.correct ?? 0) - okCount(evB));
  // A side whose log already holds every answer has an up-to-date status: keep it as it is.
  // Only when each side has answers the other lacks is the status replayed from the log.
  const aComplete = a && evA.length === merged.length;
  const bComplete = b && evB.length === merged.length;
  const shape = aComplete && bComplete ? (b.last > a.last ? b : a) : aComplete ? a : bComplete ? b : (replay(merged) ?? a ?? b);
  return shape ? { ...shape, seen, correct } : undefined;
}

/** One side of a day: its stored totals and what its own log says about that day. */
interface DaySide {
  stat: DayStat | undefined;
  events: AnswerEvent[];
  /** Practice time that day according to this side's log. */
  logMs: number;
  /**
   * Practice time that day which this side's log lost to the log limit and the merged log has
   * again (the other side still holds those answers). It must not be counted a second time.
   */
  recoveredMs: number;
}

/**
 * Totals of one day. Each is what the merged log says, plus whatever a side holds beyond its
 * own log (answers past the log limit, or of an exercise that was reset since).
 */
function mergeDay(a: DaySide, b: DaySide, merged: AnswerEvent[], mergedMs: number): DayStat {
  const extra = (pick: (stat: DayStat) => number | undefined, logged: (side: DaySide) => number) =>
    Math.max(0, ...[a, b].map((side) => ((side.stat && pick(side.stat)) ?? logged(side)) - logged(side)));
  // (For the time, `logged` also covers what the other side's log gives back; see recoveredMs.)
  return {
    answers: merged.length + extra((d) => d.answers, (side) => side.events.length),
    correct: okCount(merged) + extra((d) => d.correct, (side) => okCount(side.events)),
    // Unused since points replaced XP; carried along for older builds.
    xp: Math.max(a.stat?.xp ?? 0, b.stat?.xp ?? 0),
    ms: mergedMs + extra((d) => d.ms, (side) => side.logMs + side.recoveredMs),
  };
}

/**
 * Combines the progress in this browser with progress from elsewhere (the server, a backup
 * file). Settings stay as they are here, unless this browser has no history yet.
 */
export function mergeProgress(local: ProgressData, incoming: ProgressData): ProgressData {
  const resets = (incoming.resets?.at ?? 0) > (local.resets?.at ?? 0) ? incoming.resets : local.resets;
  const a = applyResets(local, resets);
  const b = applyResets(incoming, resets);

  const byId = new Map<string, AnswerEvent>();
  for (const e of a.events) byId.set(eventId(e), e);
  for (const e of b.events) if (!byId.has(eventId(e))) byId.set(eventId(e), e);
  const all = [...byId.values()].sort((x, y) => x.t - y.t);

  const itemOf = (e: AnswerEvent) => itemId(e.m, e.k);
  const [itemsA, itemsB, itemsAll] = [groupEvents(a.events, itemOf), groupEvents(b.events, itemOf), groupEvents(all, itemOf)];
  const stats = { notes: {}, positions: {}, sweep: {} } as ProgressData['stats'];
  for (const mode of MODES) {
    const keys = new Set([...Object.keys(a.stats[mode] ?? {}), ...Object.keys(b.stats[mode] ?? {})]);
    for (const e of all) if (e.m === mode) keys.add(e.k);
    for (const key of keys) {
      const id = itemId(mode, key);
      const stat = mergeStat(a.stats[mode]?.[key], b.stats[mode]?.[key], itemsA.get(id) ?? [], itemsB.get(id) ?? [], itemsAll.get(id) ?? []);
      if (stat) stats[mode][key] = stat;
    }
  }

  const dayOf = (e: AnswerEvent) => dayKey(e.t);
  const [daysA, daysB, daysAll] = [groupEvents(a.events, dayOf), groupEvents(b.events, dayOf), groupEvents(all, dayOf)];
  const [timeA, timeB, timeAll] = [practiceByDay(a.events), practiceByDay(b.events), practiceByDay(all)];
  // A full log has dropped its oldest answers but still counts their time in the day totals.
  // Where the merged log reaches further back than such a log, that older stretch is the same
  // practice, already counted.
  const recovered = (side: ProgressData): Record<string, number> => {
    if (side.events.length < MAX_EVENTS) return {};
    const oldest = side.events[0].t;
    if (all[0].t >= oldest) return {};
    const since = practiceByDay(all.filter((e) => e.t >= oldest));
    return Object.fromEntries(Object.entries(timeAll).map(([day, ms]) => [day, ms - (since[day] ?? 0)]));
  };
  const [backA, backB] = [recovered(a), recovered(b)];
  const days: Record<string, DayStat> = {};
  for (const day of [...new Set([...Object.keys(a.days), ...Object.keys(b.days), ...daysAll.keys()])].sort()) {
    days[day] = mergeDay(
      { stat: a.days[day], events: daysA.get(day) ?? [], logMs: timeA[day] ?? 0, recoveredMs: backA[day] ?? 0 },
      { stat: b.days[day], events: daysB.get(day) ?? [], logMs: timeB[day] ?? 0, recoveredMs: backB[day] ?? 0 },
      daysAll.get(day) ?? [],
      timeAll[day] ?? 0,
    );
  }
  // Unused since points replaced XP; carried along for older builds.
  const xp = Math.max(a.xp, b.xp);

  const sessions = new Map<string, SessionRecord>();
  for (const s of [...a.sessions, ...b.sessions]) if (!sessions.has(`${s.t}|${s.mode}`)) sessions.set(`${s.t}|${s.mode}`, s);

  const fresh = local.events.length === 0 && local.sessions.length === 0;
  const settings = fresh
    ? normaliseSettings({ ...incoming.settings, ...Object.fromEntries(DEVICE_SETTINGS.map((k) => [k, local.settings[k]])) })
    : local.settings;

  const merged: ProgressData = {
    v: 2,
    stats,
    events: all.slice(-MAX_EVENTS),
    xp,
    days,
    sessions: [...sessions.values()].sort((x, y) => x.t - y.t).slice(-MAX_SESSIONS),
    settings,
  };
  if (resets) merged.resets = resets;
  return merged;
}

/**
 * Restores a backup file into this browser. Like a merge, but earlier resets are forgotten,
 * since bringing back what was erased is the point of restoring a backup.
 */
export function importProgress(local: ProgressData, file: unknown, now: number): ProgressData {
  const { resets: _old, ...incoming } = fromSyncDoc(file);
  const { resets: _mine, ...current } = local;
  return { ...mergeProgress(current, incoming), resets: { at: now } };
}

/** True when the file looks like something this app exported. */
export function looksLikeProgress(raw: unknown): boolean {
  const doc = raw as Partial<ProgressData> | null;
  return !!doc && typeof doc === 'object' && doc.v === 2 && Array.isArray(doc.events) && typeof doc.stats === 'object';
}

/** A cheap fingerprint: two documents with the same one hold the same progress. */
export function fingerprint(data: ProgressData): string {
  const last = data.events[data.events.length - 1];
  const items = MODES.map((m) => Object.keys(data.stats[m] ?? {}).length).join(',');
  const resets = data.resets ? MODES.map((m) => cutoff(data.resets, m)).join(',') + `@${data.resets.at}` : '';
  const settings = Object.entries(toSyncDoc(data).settings)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(';');
  return [data.events.length, last ? eventId(last) : '', practiceMs(data), data.sessions.length, items, Object.keys(data.days).length, resets, settings].join('/');
}
