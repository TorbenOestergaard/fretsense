import { describe, expect, it } from 'vitest';
import {
  DAILY_GOAL,
  DEFAULT_SETTINGS,
  applyAnswer,
  dayKey,
  emptyProgress,
  itemKey,
  knowledgePoints,
  levelInfo,
  levelOf,
  levelStart,
  masterySummary,
  migrateV1,
  normaliseProgress,
  pointsOf,
  positionKey,
  practiceByDay,
  practiceMs,
  practiceStep,
  progressStore,
  streakOf,
  type ItemStat,
  type Mode,
  type ProgressData,
  type Settings,
} from './progress';
import { bucketOf, dailySeries, eventsFor, groupBy } from './analytics';
import { Scheduler, itemWeight } from './scheduler';
import { FEEDBACK_MISS_MS, FEEDBACK_OK_MS, REVEAL_AFTER_MS, Session } from './session';

function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const NOW = new Date(2026, 10, 13, 20, 0, 0).getTime();
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

function answerMany(data: ProgressData, string: number, pc: number, times: number, ms: number, firstTry = true) {
  let next = data;
  for (let i = 0; i < times; i++) next = applyAnswer(next, { mode: 'notes', key: itemKey(string, pc), string, pc, firstTry, ms }, NOW).data;
  return next;
}

const noteLevel = (data: ProgressData, string: number, pc: number) => levelOf(data.stats.notes[itemKey(string, pc)]);

describe('mastery', () => {
  it('needs several fast answers to climb: one lucky hit is not "instant"', () => {
    let data = emptyProgress();
    expect(noteLevel(data, 3, 0)).toBe(0);
    const levels: number[] = [];
    for (let i = 0; i < 4; i++) {
      data = answerMany(data, 3, 0, 1, 1500);
      levels.push(noteLevel(data, 3, 0));
    }
    expect(levels).toEqual([1, 2, 3, 4]);
  });

  it('treats slow answers as not yet known', () => {
    const data = answerMany(emptyProgress(), 3, 0, 5, 6500);
    expect(noteLevel(data, 3, 0)).toBe(1);
  });

  it('is damped downward too: one slip or one slow answer does not undo a known note', () => {
    const known = answerMany(emptyProgress(), 2, 5, 8, 1500);
    expect(noteLevel(answerMany(known, 2, 5, 1, 0, false), 2, 5)).toBe(4);
    expect(noteLevel(answerMany(known, 2, 5, 1, 7000), 2, 5)).toBe(4);
    const twoMisses = answerMany(known, 2, 5, 2, 0, false);
    expect(noteLevel(twoMisses, 2, 5)).toBe(3);
    expect(noteLevel(answerMany(twoMisses, 2, 5, 2, 0, false), 2, 5)).toBe(2);
    expect(noteLevel(answerMany(twoMisses, 2, 5, 7, 1500), 2, 5)).toBe(4);
  });

  it('keeps each exercise in its own statistics', () => {
    let data = answerMany(emptyProgress(), 3, 0, 8, 1500);
    for (let i = 0; i < 4; i++) {
      data = applyAnswer(data, { mode: 'sweep', key: itemKey(3, 0), string: 3, pc: 0, firstTry: false, ms: 9000 }, NOW).data;
      data = applyAnswer(data, { mode: 'positions', key: positionKey('major', 1, '5'), pc: 7, firstTry: false, ms: 9000 }, NOW).data;
    }
    expect(noteLevel(data, 3, 0)).toBe(4);
    expect(levelOf(data.stats.sweep[itemKey(3, 0)])).toBe(1);
    expect(levelOf(data.stats.positions[positionKey('major', 1, '5')])).toBe(1);
    expect(masterySummary(data, 'notes').solid).toBe(1);
    expect(masterySummary(data, 'sweep').solid).toBe(0);
  });

  it('summarises the neck per string', () => {
    let data = emptyProgress();
    for (let pc = 0; pc < 12; pc++) data = answerMany(data, 0, pc, 4, 1500);
    const summary = masterySummary(data);
    expect(summary.solid).toBe(12);
    expect(summary.perString[0].solid).toBe(12);
    expect(summary.perString[3].solid).toBe(0);
    expect(summary.counts[0]).toBe(60);
  });

  it('carries version 1 progress over as the Note finder starting point', () => {
    const data = migrateV1({
      items: { '0:0': { seen: 12, correct: 12, ewmaMs: 1800, acc: 1, last: NOW }, '3:0': { seen: 2, correct: 1, ewmaMs: 6000, acc: 0.5, last: NOW } },
      xp: 420,
      days: { '2026-11-13': { answers: 14, correct: 13, xp: 420 } },
      sessions: [{ t: NOW, mode: 'degrees', n: 10, correct: 5, avgMs: 5000, xp: 100 }],
      settings: { mode: 'degrees', naturalsOnly: false },
    });
    expect(noteLevel(data, 0, 0)).toBe(4);
    expect(noteLevel(data, 3, 0)).toBe(1);
    expect(data.xp).toBe(420);
    expect(data.sessions).toHaveLength(0);
    expect(data.settings.mode).toBe('positions');
    expect(data.settings.naturalsOnly).toBe(false);
  });
});

describe('analytics', () => {
  it('derives averages per string, fret and day from the answer log', () => {
    let data = emptyProgress();
    const add = (mode: 'notes' | 'sweep', string: number, pc: number, fret: number, ms: number, firstTry: boolean, t: number) => {
      data = applyAnswer(data, { mode, key: itemKey(string, pc), string, fret, pc, firstTry, ms }, t).data;
    };
    const DAY = 24 * 3600 * 1000;
    add('notes', 3, 0, 5, 4000, true, NOW - DAY);
    add('notes', 3, 0, 5, 2000, true, NOW);
    add('notes', 3, 1, 6, 3000, false, NOW);
    add('notes', 4, 0, 1, 1000, true, NOW);
    add('sweep', 4, 0, 1, 500, true, NOW);

    const notes = eventsFor(data.events, 'notes');
    expect(notes).toHaveLength(4);
    expect(bucketOf(notes)).toEqual({ n: 4, ok: 3, avgMs: 7000 / 3 });
    expect(groupBy(notes, (e) => e.s).get(3)).toEqual({ n: 3, ok: 2, avgMs: 3000 });
    expect(groupBy(notes, (e) => e.f).get(1)?.avgMs).toBe(1000);
    expect(eventsFor(data.events, 'notes', 'accidentals')).toHaveLength(1);
    expect(eventsFor(data.events, 'notes', 'naturals')).toHaveLength(3);

    const days = dailySeries(notes);
    expect(days.map((d) => d.avgMs)).toEqual([4000, 1500]);
    expect(days[1].n).toBe(3);
  });
});

describe('points, levels and streaks', () => {
  const at = (data: ProgressData, t: number, ms: number, opts: { mode?: Mode; pc?: number; firstTry?: boolean } = {}) =>
    applyAnswer(data, { mode: opts.mode ?? 'notes', key: itemKey(0, opts.pc ?? 0), string: 0, pc: opts.pc ?? 0, firstTry: opts.firstTry ?? true, ms }, t).data;

  it('counts practice time from the gaps between answers, leaving out breaks', () => {
    expect(practiceStep(null, { t: NOW, ms: 3200 })).toBe(3200); // first answer: its own time
    expect(practiceStep(NOW, { t: NOW + 4500, ms: 3000 })).toBe(4500); // includes the feedback pause
    expect(practiceStep(NOW, { t: NOW + 30000, ms: 3000 })).toBe(30000);
    expect(practiceStep(NOW, { t: NOW + 30001, ms: 3000 })).toBe(3000); // a break: only the answer itself
    expect(practiceStep(NOW, { t: NOW + 600000, ms: 500000 })).toBe(30000); // walked away mid-question
    const lateNight = new Date(2026, 10, 13, 23, 59, 55).getTime();
    expect(practiceStep(lateNight, { t: lateNight + 10000, ms: 2000 })).toBe(2000); // a new day starts fresh

    let data = emptyProgress();
    for (let i = 0; i < 31; i++) data = at(data, NOW + i * 4000, 2500, { pc: i % 12 });
    data = at(data, NOW + 3600000, 2500); // an hour later
    expect(data.days[dayKey(NOW)].ms).toBe(2500 + 30 * 4000 + 2500);
    expect(practiceMs(data)).toBe(125000);
    expect(pointsOf(data).time).toBe(2);
    expect(practiceByDay(data.events)).toEqual({ [dayKey(NOW)]: 125000 });
  });

  it('gives one point per Solid item and two per Instant item, in every exercise', () => {
    let data = emptyProgress();
    for (let i = 0; i < 4; i++) {
      data = at(data, NOW + i * 1000, 1500, { pc: 0 }); // instant
      data = at(data, NOW + i * 1000, 3500, { pc: 1 }); // solid: 0.75
      data = at(data, NOW + i * 1000, 5500, { pc: 2 }); // learning
      data = at(data, NOW + i * 1000, 1500, { pc: 3, mode: 'sweep' }); // instant, other exercise
      data = at(data, NOW + i * 1000, 3500, { pc: 4, mode: 'positions' }); // solid
    }
    expect(knowledgePoints(data.stats)).toBe(2 + 1 + 0 + 2 + 1);
    expect(pointsOf(data)).toEqual({ time: 0, knowledge: 6, total: 6 });
    // Points follow the current status: two misses take the Instant note down to Solid.
    data = at(at(data, NOW + 9000, 9000, { pc: 0, firstTry: false }), NOW + 9500, 9000, { pc: 0, firstTry: false });
    expect(knowledgePoints(data.stats)).toBe(5);
  });

  it('starts level L at 15·L·(L−1) points', () => {
    expect([1, 2, 3, 4, 5, 10, 15, 20].map(levelStart)).toEqual([0, 30, 90, 180, 300, 1350, 3150, 5700]);
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: 30 });
    expect(levelInfo(29).level).toBe(1);
    expect(levelInfo(30)).toEqual({ level: 2, into: 0, need: 60 });
    expect(levelInfo(299)).toEqual({ level: 4, into: 119, need: 120 });
    expect(levelInfo(300).level).toBe(5);
    expect(levelInfo(1350)).toEqual({ level: 10, into: 0, need: 300 });
  });

  it('loads data stored by an older build: nothing is lost and the practice time is filled in from the log', () => {
    let data = emptyProgress();
    for (let i = 0; i < 40; i++) data = at(data, NOW - 24 * 3600 * 1000 + i * 5000, 2000, { pc: i % 12 });
    for (let i = 0; i < 20; i++) data = at(data, NOW + i * 5000, 2000, { pc: i % 12, mode: 'sweep' });
    // As version 0.2 stored it: XP everywhere, no time per day.
    const stored = JSON.parse(JSON.stringify({
      ...data,
      xp: 5120,
      days: Object.fromEntries(Object.entries(data.days).map(([key, d]) => [key, { answers: d.answers, correct: d.correct, xp: 2560 }])),
      sessions: [{ t: NOW, mode: 'sweep', n: 20, correct: 20, avgMs: 2000, xp: 400 }],
    }));
    expect(stored.days[dayKey(NOW)]).not.toHaveProperty('ms');

    const loaded = normaliseProgress(stored);
    expect(loaded.events).toEqual(data.events);
    expect(loaded.stats).toEqual(data.stats);
    expect(loaded.sessions).toEqual(stored.sessions);
    expect(loaded.xp).toBe(5120);
    expect(loaded.days[dayKey(NOW)]).toEqual({ answers: 20, correct: 20, xp: 2560, ms: 2000 + 19 * 5000 });
    expect(loaded.days).toEqual(Object.fromEntries(Object.entries(data.days).map(([key, d]) => [key, { ...d, xp: 2560 }])));
    expect(pointsOf(loaded)).toEqual(pointsOf(data));
    expect(normaliseProgress(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded); // loading again changes nothing

    // Not loaded through normaliseProgress at all: the next answer still starts from the log.
    const next = at(stored as ProgressData, NOW + 20 * 5000, 2000);
    expect(next.days[dayKey(NOW)].ms).toBe(2000 + 20 * 5000);
  });

  it('resetting one exercise does not take away the time spent on it', () => {
    let data = emptyProgress();
    for (let i = 0; i < 30; i++) data = at(data, NOW + i * 5000, 2000, { pc: i % 12, mode: i % 2 ? 'notes' : 'sweep' });
    const before = practiceMs(data);
    expect(before).toBe(2000 + 29 * 5000);
    progressStore.set(data);
    progressStore.reset('sweep');
    const after = progressStore.get();
    expect(after.events).toHaveLength(15);
    expect(after.stats.sweep).toEqual({});
    expect(practiceMs(after)).toBe(before);
    expect(practiceMs(normaliseProgress(JSON.parse(JSON.stringify(after))))).toBe(before);
    expect(practiceMs(at(after, NOW + 30 * 5000, 2000))).toBe(before + 5000);
    progressStore.reset();
    expect(pointsOf(progressStore.get()).total).toBe(0);
  });

  it('counts consecutive days that met the goal, without breaking on an unfinished today', () => {
    const day = (offset: number) => dayKey(NOW - offset * 24 * 3600 * 1000);
    const full = { answers: DAILY_GOAL, correct: DAILY_GOAL, xp: 0 };
    expect(streakOf({ [day(1)]: full, [day(2)]: full }, NOW)).toBe(2);
    expect(streakOf({ [day(0)]: full, [day(1)]: full, [day(2)]: full }, NOW)).toBe(3);
    expect(streakOf({ [day(2)]: full }, NOW)).toBe(0);
    expect(streakOf({ [day(0)]: { answers: 5, correct: 5, xp: 0 } }, NOW)).toBe(0);
  });
});

describe('scheduler', () => {
  it('asks weak notes far more often than mastered ones', () => {
    const strong: ItemStat = { seen: 10, correct: 10, recent: new Array(8).fill(1), ms: 1500, last: NOW };
    const weak: ItemStat = { seen: 10, correct: 4, recent: [0, 0.3, 0, 0.3, 0, 0, 0.3, 0.3], ms: 6000, last: NOW };
    expect(itemWeight(weak, NOW)).toBeGreaterThan(itemWeight(strong, NOW) * 8);

    // The player knows the two low strings cold, and nothing else.
    const stats = (key: string) => (key.startsWith('0:') || key.startsWith('1:') ? strong : undefined);
    const scheduler = new Scheduler(settings({ naturalsOnly: false }), stats, seededRng(), () => NOW);
    let lowStrings = 0;
    for (let i = 0; i < 600; i++) if (scheduler.next().string! <= 1) lowStrings++;
    expect(lowStrings / 600).toBeLessThan(0.08);
    expect(lowStrings).toBeGreaterThan(0);
  });

  it('never repeats a note within three questions', () => {
    const scheduler = new Scheduler(settings({ strings: [false, false, false, true, false, false] }), () => undefined, seededRng(7), () => NOW);
    const asked: string[] = [];
    for (let i = 0; i < 200; i++) {
      const q = scheduler.next();
      expect(asked.slice(-3)).not.toContain(q.key);
      asked.push(q.key);
    }
  });

  it('respects the string and naturals filters', () => {
    const scheduler = new Scheduler(settings({ strings: [false, false, true, true, false, false] }), () => undefined, seededRng(), () => NOW);
    for (let i = 0; i < 100; i++) {
      const q = scheduler.next();
      expect([2, 3]).toContain(q.string);
      expect(q.prompt).toMatch(/^[A-G]$/);
    }
  });

  it('brings a missed note back after three other questions', () => {
    const scheduler = new Scheduler(settings(), () => undefined, seededRng(3), () => NOW);
    const missed = scheduler.next();
    scheduler.requeue(missed);
    const following = [scheduler.next(), scheduler.next(), scheduler.next(), scheduler.next()];
    const keys = following.map((q) => q.key);
    expect(keys.slice(0, 3)).not.toContain(missed.key);
    expect(keys[3]).toBe(missed.key);
  });

  it('walks the scale positions one box at a time, every degree once in random order', () => {
    const scheduler = new Scheduler(settings({ mode: 'positions', tonic: 'G', scaleId: 'major' }), () => undefined, seededRng(), () => NOW);
    expect(scheduler.roundLength()).toBe(35);
    const asked = Array.from({ length: 35 }, () => scheduler.next());
    expect(asked.map((q) => q.position!.index)).toEqual([0, 1, 2, 3, 4].flatMap((p) => new Array(7).fill(p)));
    for (let p = 0; p < 5; p++) {
      const box = asked.slice(p * 7, p * 7 + 7);
      expect(box.map((q) => q.degree).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
      expect(box.every((q) => q.context === 'G major' && q.string === null)).toBe(true);
    }
    expect(asked.slice(0, 7).map((q) => q.degree)).not.toEqual(['1', '2', '3', '4', '5', '6', '7']);
    const third = asked.find((q) => q.position!.index === 0 && q.degree === '3')!;
    expect(third.noteName).toBe('B');
    expect(third.prompt).toBe('3rd');
    // B inside frets 2-5: A string fret 2 and G string fret 4.
    expect(third.cells).toEqual([{ string: 1, fret: 2 }, { string: 3, fret: 4 }]);
    expect(third.key).toBe(positionKey('major', 0, '3'));
  });

  it('practises only the chosen positions and repeats a missed degree before leaving the box', () => {
    const scheduler = new Scheduler(
      settings({ mode: 'positions', tonic: 'A', scaleId: 'minorPent', length: 10, positions: [true, true, false, false, false] }),
      () => undefined,
      seededRng(5),
      () => NOW,
    );
    expect(scheduler.roundLength()).toBe(10);
    const first = scheduler.next();
    expect(scheduler.requeue(first)).toBe(true);
    expect(scheduler.requeue(first)).toBe(false);
    const rest = Array.from({ length: 10 }, () => scheduler.next());
    expect(rest.slice(0, 5).every((q) => q.position!.index === 0)).toBe(true);
    expect(rest[4].key).toBe(first.key);
    expect(rest.slice(5).every((q) => q.position!.index === 1)).toBe(true);
  });

  it('keeps cycling through one selected box until the round length is reached', () => {
    const scheduler = new Scheduler(
      settings({ mode: 'positions', tonic: 'G', scaleId: 'major', length: 20, positions: [false, true, false, false, false] }),
      () => undefined,
      seededRng(4),
      () => NOW,
    );
    expect(scheduler.roundLength()).toBe(21); // three passes of seven degrees
    const asked = Array.from({ length: 21 }, () => scheduler.next());
    expect(asked.every((q) => q.position!.index === 1)).toBe(true);
    const passes = [0, 1, 2].map((i) => asked.slice(i * 7, i * 7 + 7).map((q) => q.degree));
    for (const pass of passes) expect([...pass].sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(passes[1]).not.toEqual(passes[0]); // reshuffled
    for (let i = 1; i < asked.length; i++) expect(asked[i].degree).not.toBe(asked[i - 1].degree);
  });

  it('rounds the round to whole boxes and visits every selected box at least once', () => {
    const lengthOf = (patch: Partial<Settings>) => new Scheduler(settings({ mode: 'positions', tonic: 'A', ...patch }), () => undefined, seededRng(), () => NOW).roundLength();
    const one = [true, false, false, false, false];
    expect(lengthOf({ scaleId: 'minorPent', length: 10, positions: one })).toBe(10);
    expect(lengthOf({ scaleId: 'minorPent', length: 40, positions: one })).toBe(40);
    expect(lengthOf({ scaleId: 'major', length: 10, positions: one })).toBe(7);
    expect(lengthOf({ scaleId: 'major', length: 40, positions: one })).toBe(42);
    // All five boxes are never cut short by a small round length.
    expect(lengthOf({ scaleId: 'major', length: 10 })).toBe(35);

    const scheduler = new Scheduler(
      settings({ mode: 'positions', tonic: 'A', scaleId: 'minorPent', length: 20, positions: [true, false, true, false, false] }),
      () => undefined,
      seededRng(),
      () => NOW,
    );
    const boxes = Array.from({ length: 20 }, () => scheduler.next().position!.index);
    expect(boxes).toEqual([0, 2, 0, 2].flatMap((p) => new Array(5).fill(p)));
  });

  it('asks a degree missed in a later pass again before that pass ends', () => {
    const scheduler = new Scheduler(
      settings({ mode: 'positions', tonic: 'A', scaleId: 'minorPent', length: 10, positions: [true, false, false, false, false] }),
      () => undefined,
      seededRng(6),
      () => NOW,
    );
    const firstPass = Array.from({ length: 5 }, () => scheduler.next());
    expect(scheduler.requeue(firstPass[4])).toBe(true);
    expect(scheduler.next().key).toBe(firstPass[4].key);
    const second = scheduler.next();
    expect(scheduler.requeue(second)).toBe(true); // a new pass may repeat a miss again
    const rest = Array.from({ length: 5 }, () => scheduler.next());
    expect(rest[4].key).toBe(second.key);
  });

  it('sweeps one note across the strings from low to high', () => {
    const scheduler = new Scheduler(settings({ mode: 'sweep' }), () => undefined, seededRng(), () => NOW);
    const first = Array.from({ length: 6 }, () => scheduler.next());
    expect(first.map((q) => q.string)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(first.map((q) => q.pc)).size).toBe(1);
    expect(scheduler.next().pc).not.toBe(first[0].pc);
  });
});

describe('session', () => {
  const make = (total = 3, patch: Partial<Settings> = {}) => {
    const scheduler = new Scheduler(settings(patch), () => undefined, seededRng(11), () => NOW);
    return new Session(scheduler, total, 0);
  };

  it('accepts the right pitch immediately and moves on after the feedback pause', () => {
    const s = make();
    const first = s.question;
    s.noteOn(first.targets[0], 1800);
    expect(s.phase).toBe('feedback');
    expect(s.lastResult).toMatchObject({ firstTry: true, ms: 1800 });
    s.tick(1800 + FEEDBACK_OK_MS);
    expect(s.phase).toBe('asking');
    expect(s.index).toBe(1);
    expect(s.question).not.toBe(first);
  });

  it('ignores a note that is still ringing when the question appears', () => {
    const s = make();
    s.noteOn(s.question.targets[0], 50);
    expect(s.phase).toBe('asking');
  });

  it('keeps the question open after a wrong note, but records a miss', () => {
    const s = make();
    const wrong = s.question.targets[0] + 1;
    s.noteOn(wrong, 1000);
    expect(s.hint).toBeNull(); // a wrong note only counts once it is held
    s.noteHeld(wrong, 1300);
    expect(s.hint).toEqual({ kind: 'wrong', midi: wrong });
    s.noteOn(s.question.targets[0], 2500);
    expect(s.lastResult).toMatchObject({ firstTry: false, mistakes: 1 });
    expect(s.phase).toBe('feedback');
    s.tick(2500 + FEEDBACK_OK_MS);
    expect(s.phase).toBe('feedback'); // misses get a longer look at the answer
    s.tick(2500 + FEEDBACK_MISS_MS);
    expect(s.phase).toBe('asking');
  });

  it('nudges without penalty when the note name is right but the octave is not', () => {
    const s = make();
    s.noteHeld(s.question.targets[0] + 12, 1000);
    expect(s.hint?.kind).toBe('octave');
    s.noteOn(s.question.targets[0], 2000);
    expect(s.lastResult?.firstTry).toBe(true);
  });

  it('reveals the answer after the time limit and waits for it to be played', () => {
    const s = make();
    s.tick(REVEAL_AFTER_MS);
    expect(s.phase).toBe('revealed');
    s.noteOn(s.question.targets[0], REVEAL_AFTER_MS + 900);
    expect(s.lastResult).toMatchObject({ firstTry: false, revealed: true });
  });

  it('supports skipping with the space bar and clicking a fret', () => {
    const s = make();
    s.skip(500);
    expect(s.phase).toBe('revealed');
    s.skip(900);
    expect(s.phase).toBe('feedback');
    s.skip(1000);
    expect(s.phase).toBe('asking');
    s.click(s.question.cells[0].string, s.question.cells[0].fret, 3000);
    expect(s.lastResult?.firstTry).toBe(true);
  });

  it('finishes after the last question and tracks the best combo', () => {
    const s = make(2);
    s.noteOn(s.question.targets[0], 1000);
    s.tick(1000 + FEEDBACK_OK_MS);
    s.noteOn(s.question.targets[0], 4000);
    s.tick(4000 + FEEDBACK_OK_MS);
    expect(s.phase).toBe('done');
    expect(s.results).toHaveLength(2);
    expect(s.bestCombo).toBe(2);
  });

  it('starts each scale box with an untimed step: play the root', () => {
    const scheduler = new Scheduler(
      settings({ mode: 'positions', tonic: 'G', scaleId: 'majorPent', positions: [true, true, false, false, false] }),
      () => undefined,
      seededRng(2),
      () => NOW,
    );
    const s = new Session(scheduler, scheduler.roundLength(), 0);
    expect(s.phase).toBe('intro');
    s.tick(60000);
    expect(s.phase).toBe('intro'); // no time limit
    s.noteOn(45, 61000); // A2 is in the box but is not the root
    expect(s.phase).toBe('intro');
    s.noteOn(43, 62000); // G2, low E string fret 3
    expect(s.phase).toBe('asking');
    expect(s.askedAt).toBe(62000);

    let t = 62000;
    for (let i = 0; i < 5; i++) {
      t += 2000;
      s.noteOn(s.question.targets[0], t);
      expect(s.lastResult).toMatchObject({ firstTry: true, ms: 2000 });
      t += FEEDBACK_OK_MS;
      s.tick(t);
    }
    expect(s.phase).toBe('intro'); // second box
    expect(s.question.position!.index).toBe(1);
    s.skip(t);
    expect(s.phase).toBe('asking');
  });

  it('shows the root step once when the same box is repeated, and again when the box changes', () => {
    const play = (patch: Partial<Settings>) => {
      const scheduler = new Scheduler(settings({ mode: 'positions', tonic: 'G', scaleId: 'majorPent', length: 20, ...patch }), () => undefined, seededRng(2), () => NOW);
      const s = new Session(scheduler, scheduler.roundLength(), 0);
      const intros: number[] = [];
      let t = 0;
      while (s.phase !== 'done') {
        if (s.phase === 'intro') {
          intros.push(s.index);
          s.skip(t);
        }
        t += 2000;
        s.noteOn(s.question.targets[0], t);
        t += FEEDBACK_OK_MS;
        s.tick(t);
      }
      return { intros, answered: s.results.length };
    };
    expect(play({ positions: [true, false, false, false, false] })).toEqual({ intros: [0], answered: 20 });
    expect(play({ positions: [true, true, false, false, false] })).toEqual({ intros: [0, 5, 10, 15], answered: 20 });
  });

  it('accepts a degree anywhere in the box, nudges outside it, and extends the round after a miss', () => {
    const scheduler = new Scheduler(
      settings({ mode: 'positions', tonic: 'G', scaleId: 'major', length: 10, positions: [true, false, false, false, false] }),
      () => undefined,
      seededRng(2),
      () => NOW,
    );
    const s = new Session(scheduler, scheduler.roundLength(), 0);
    s.skip(0);
    const q = s.question;
    expect(q.targets.length).toBeGreaterThanOrEqual(1);
    s.noteHeld(Math.max(...q.targets) + 12, 1000);
    expect(s.hint?.kind).toBe('octave');
    s.noteHeld(q.targets[0] + 1, 1500);
    expect(s.hint?.kind).toBe('wrong');
    s.noteOn(q.targets[q.targets.length - 1], 2500);
    expect(s.lastResult).toMatchObject({ firstTry: false, mistakes: 1 });
    expect(s.total).toBe(8);
  });
});
