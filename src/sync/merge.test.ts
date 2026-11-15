import { describe, expect, it } from 'vitest';
import { addSession, applyAnswer, emptyProgress, itemKey, type Mode, type ProgressData } from '../game/progress';
import { fingerprint, fromSyncDoc, importProgress, mergeProgress, toSyncDoc } from './merge';

const DAY = 24 * 3600 * 1000;
const T0 = new Date(2026, 10, 1, 12).getTime();

/** Plays `n` answers starting at `t`, one per 10 s, cycling over four notes on one string. */
function play(data: ProgressData, t: number, n: number, opts: { mode?: Mode; string?: number; miss?: boolean } = {}): ProgressData {
  let next = data;
  for (let i = 0; i < n; i++) {
    next = applyAnswer(
      next,
      { mode: opts.mode ?? 'notes', key: itemKey(opts.string ?? 0, i % 4), pc: i % 4, string: opts.string ?? 0, fret: i % 4, firstTry: !opts.miss, ms: 1500 + 100 * i, combo: i },
      t + i * 10000,
    ).data;
  }
  return next;
}

const core = (d: ProgressData) => ({ stats: d.stats, events: d.events, xp: d.xp, days: d.days, sessions: d.sessions });

describe('mergeProgress', () => {
  it('uploading to an empty server and downloading into an empty browser both keep everything', () => {
    const a = play(emptyProgress(), T0, 12);
    expect(core(mergeProgress(a, emptyProgress()))).toEqual(core(a));
    expect(core(mergeProgress(emptyProgress(), a))).toEqual(core(a));
  });

  it('the same data arriving twice changes nothing', () => {
    const a = addSession(play(emptyProgress(), T0, 12), { t: T0, mode: 'notes', n: 12, correct: 12, avgMs: 2000, xp: 150 });
    const once = mergeProgress(a, a);
    expect(core(once)).toEqual(core(a));
    const b = play(emptyProgress(), T0 + DAY, 9, { string: 3 });
    const merged = mergeProgress(a, b);
    expect(core(mergeProgress(merged, b))).toEqual(core(merged));
    expect(core(mergeProgress(merged, a))).toEqual(core(merged));
    expect(core(mergeProgress(b, merged))).toEqual(core(merged));
  });

  it('keeps every answer from both browsers and counts each once', () => {
    const shared = play(emptyProgress(), T0, 8);
    const a = play(shared, T0 + DAY, 6);
    const b = play(shared, T0 + 2 * DAY, 5, { miss: true });
    const merged = mergeProgress(a, b);
    expect(merged.events).toHaveLength(8 + 6 + 5);
    expect(merged.events.map((e) => e.t)).toEqual([...merged.events.map((e) => e.t)].sort((x, y) => x - y));
    const seen = Object.values(merged.stats.notes).reduce((n, s) => n + s.seen, 0);
    const correct = Object.values(merged.stats.notes).reduce((n, s) => n + s.correct, 0);
    expect(seen).toBe(19);
    expect(correct).toBe(14);
    const answers = Object.values(merged.days).reduce((n, d) => n + d.answers, 0);
    expect(answers).toBe(19);
    expect(merged.xp).toBe(a.xp + b.xp - shared.xp);
    expect(merged.xp).toBe(Object.values(merged.days).reduce((n, d) => n + d.xp, 0));
  });

  it('gives the same result whichever browser merges', () => {
    const shared = play(emptyProgress(), T0, 8);
    const a = play(shared, T0 + DAY, 6);
    const b = play(shared, T0 + DAY + 3600000, 7, { string: 2 });
    expect(core(mergeProgress(a, b))).toEqual(core(mergeProgress(b, a)));
  });

  it('replays an item practised in both browsers in time order', () => {
    const a = play(emptyProgress(), T0, 4);
    const b = play(emptyProgress(), T0 + 5000, 4, { miss: true });
    const stat = mergeProgress(a, b).stats.notes[itemKey(0, 0)];
    expect(stat.seen).toBe(2);
    expect(stat.correct).toBe(1);
    expect(stat.recent).toEqual([1, 0]);
    expect(stat.last).toBe(T0 + 5000);
  });

  it('estimates XP for a day practised separately in both browsers without exceeding the sum', () => {
    const a = play(emptyProgress(), T0, 10);
    const b = play(emptyProgress(), T0 + 3600000, 6);
    const merged = mergeProgress(a, b);
    expect(merged.xp).toBe(a.xp + b.xp);
  });

  it('keeps history that is not in the log without doubling it', () => {
    const carried = emptyProgress();
    carried.stats.notes['0:0'] = { seen: 30, correct: 25, recent: [1, 1, 1, 1], ms: 1800, last: T0 - DAY };
    carried.days['2026-10-30'] = { answers: 30, correct: 25, xp: 400 };
    carried.xp = 400;
    const a = play(carried, T0, 4);
    const b = play(carried, T0 + DAY, 4);
    const merged = mergeProgress(a, b);
    expect(merged.stats.notes['0:0'].seen).toBe(32);
    expect(merged.days['2026-10-30']).toEqual({ answers: 30, correct: 25, xp: 400 });
    expect(merged.xp).toBe(400 + (a.xp - 400) + (b.xp - 400));
  });

  it('keeps this browser’s settings, but a fresh browser adopts the synced ones', () => {
    const a = play(emptyProgress(), T0, 3);
    a.settings = { ...a.settings, tonic: 'G', sensitivity: 'high', deviceId: 'mic-a' };
    const b = play(emptyProgress(), T0 + DAY, 3);
    b.settings = { ...b.settings, tonic: 'D', deviceId: 'mic-b' };
    expect(mergeProgress(b, fromSyncDoc(toSyncDoc(a))).settings).toEqual(b.settings);
    const fresh = emptyProgress();
    fresh.settings.deviceId = 'mic-c';
    const adopted = mergeProgress(fresh, fromSyncDoc(toSyncDoc(a))).settings;
    expect(adopted.tonic).toBe('G');
    expect(adopted.deviceId).toBe('mic-c');
    expect(adopted.sensitivity).toBe('normal');
  });

  it('does not send device settings to the server', () => {
    const doc = toSyncDoc(emptyProgress()) as unknown as { settings: Record<string, unknown> };
    expect(doc.settings).not.toHaveProperty('deviceId');
    expect(doc.settings).not.toHaveProperty('sensitivity');
  });

  it('a reset in one browser is not undone by older answers from another', () => {
    const shared = play(play(emptyProgress(), T0, 8), T0 + 1000, 4, { mode: 'sweep' });
    const resetAt = T0 + DAY;
    const a: ProgressData = { ...shared, stats: { ...shared.stats, notes: {} }, events: shared.events.filter((e) => e.m !== 'notes'), resets: { at: resetAt, notes: resetAt } };
    const merged = mergeProgress(a, shared);
    expect(merged.events.every((e) => e.m === 'sweep')).toBe(true);
    expect(merged.stats.notes).toEqual({});
    expect(Object.keys(merged.stats.sweep)).toHaveLength(4);
    // The stale browser practised after the reset: that part survives.
    const later = play(shared, resetAt + 5000, 3);
    const merged2 = mergeProgress(later, a);
    expect(merged2.events.filter((e) => e.m === 'notes')).toHaveLength(3);
    expect(merged2.stats.notes[itemKey(0, 0)].seen).toBe(1);
  });

  it('a full reset clears XP and days in the other browser too', () => {
    const shared = play(emptyProgress(), T0, 8);
    const resetAt = T0 + DAY;
    const a: ProgressData = { ...emptyProgress(), resets: { at: resetAt, all: resetAt } };
    const merged = mergeProgress(shared, a);
    expect(merged.events).toHaveLength(0);
    expect(merged.xp).toBe(0);
    expect(merged.days).toEqual({});
  });

  it('restoring a backup brings back what a reset erased', () => {
    const before = play(emptyProgress(), T0, 8);
    const afterReset: ProgressData = { ...emptyProgress(), resets: { at: T0 + DAY, all: T0 + DAY } };
    const file = JSON.parse(JSON.stringify(toSyncDoc(before)));
    const restored = importProgress(afterReset, file, T0 + 2 * DAY);
    expect(core(restored)).toEqual(core(before));
    // ...and a server copy that still remembers the reset does not erase it again.
    expect(core(mergeProgress(restored, afterReset))).toEqual(core(before));
  });

  it('fingerprint changes with progress and survives a round trip through JSON', () => {
    const a = play(emptyProgress(), T0, 5);
    expect(fingerprint(fromSyncDoc(JSON.parse(JSON.stringify(toSyncDoc(a)))))).toBe(fingerprint(a));
    expect(fingerprint(play(a, T0 + DAY, 1))).not.toBe(fingerprint(a));
  });
});
