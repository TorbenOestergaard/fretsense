import { describe, expect, it } from 'vitest';
import {
  DAILY_GOAL,
  DEFAULT_SETTINGS,
  applyAnswer,
  dayKey,
  emptyProgress,
  itemKey,
  levelInfo,
  levelOf,
  masterySummary,
  streakOf,
  xpFor,
  type ItemStat,
  type ProgressData,
  type Settings,
} from './progress';
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
  for (let i = 0; i < times; i++) next = applyAnswer(next, { string, pc, firstTry, ms, combo: 0 }, NOW).data;
  return next;
}

describe('mastery', () => {
  it('rises with fast correct answers and needs repetition to reach "instant"', () => {
    let data = emptyProgress();
    expect(levelOf(data.items[itemKey(3, 0)])).toBe(0);
    data = answerMany(data, 3, 0, 1, 1500);
    expect(levelOf(data.items[itemKey(3, 0)])).toBe(3);
    data = answerMany(data, 3, 0, 2, 1500);
    expect(levelOf(data.items[itemKey(3, 0)])).toBe(4);
  });

  it('treats slow answers as not yet known', () => {
    const data = answerMany(emptyProgress(), 3, 0, 5, 6500);
    expect(levelOf(data.items[itemKey(3, 0)])).toBe(1);
  });

  it('drops after misses and recovers gradually', () => {
    let data = answerMany(emptyProgress(), 2, 5, 5, 1500);
    data = answerMany(data, 2, 5, 2, 0, false);
    expect(levelOf(data.items[itemKey(2, 5)])).toBeLessThan(3);
    data = answerMany(data, 2, 5, 6, 1500);
    expect(levelOf(data.items[itemKey(2, 5)])).toBe(4);
  });

  it('summarises the neck per string', () => {
    let data = emptyProgress();
    for (let pc = 0; pc < 12; pc++) data = answerMany(data, 0, pc, 3, 1500);
    const summary = masterySummary(data);
    expect(summary.solid).toBe(12);
    expect(summary.perString[0].solid).toBe(12);
    expect(summary.perString[3].solid).toBe(0);
    expect(summary.counts[0]).toBe(60);
  });
});

describe('xp and streaks', () => {
  it('rewards speed and combos, and gives little for a miss', () => {
    expect(xpFor(true, 1500, 0)).toBe(20);
    expect(xpFor(true, 6000, 0)).toBe(10);
    expect(xpFor(true, 1500, 10)).toBe(40);
    expect(xpFor(false, 1500, 0)).toBe(2);
  });

  it('levels up at growing thresholds', () => {
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: 200 });
    expect(levelInfo(200).level).toBe(2);
    expect(levelInfo(499)).toEqual({ level: 2, into: 299, need: 300 });
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
    const strong: ItemStat = { seen: 10, correct: 10, ewmaMs: 1500, acc: 1, last: NOW };
    const weak: ItemStat = { seen: 10, correct: 4, ewmaMs: 6000, acc: 0.4, last: NOW };
    expect(itemWeight(weak, NOW)).toBeGreaterThan(itemWeight(strong, NOW) * 8);

    // The player knows the two low strings cold, and nothing else.
    const stats = (key: string) => (key.startsWith('0:') || key.startsWith('1:') ? strong : undefined);
    const scheduler = new Scheduler(settings({ naturalsOnly: false }), stats, seededRng(), () => NOW);
    let lowStrings = 0;
    for (let i = 0; i < 600; i++) if (scheduler.next().string <= 1) lowStrings++;
    expect(lowStrings / 600).toBeLessThan(0.08);
    expect(lowStrings).toBeGreaterThan(0);
  });

  it('never repeats a note within three questions', () => {
    const scheduler = new Scheduler(settings({ strings: [false, false, false, true, false, false] }), () => undefined, seededRng(7), () => NOW);
    const asked: string[] = [];
    for (let i = 0; i < 200; i++) {
      const q = scheduler.next();
      expect(asked.slice(-3)).not.toContain(itemKey(q.string, q.pc));
      asked.push(itemKey(q.string, q.pc));
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
    const keys = following.map((q) => itemKey(q.string, q.pc));
    expect(keys.slice(0, 3)).not.toContain(itemKey(missed.string, missed.pc));
    expect(keys[3]).toBe(itemKey(missed.string, missed.pc));
  });

  it('asks for scale degrees in the chosen key', () => {
    const scheduler = new Scheduler(settings({ mode: 'degrees', tonic: 'G', scaleId: 'major' }), () => undefined, seededRng(), () => NOW);
    const seen = new Map<string, string>();
    for (let i = 0; i < 200; i++) {
      const q = scheduler.next();
      expect(q.context).toBe('G major');
      seen.set(q.prompt, q.noteName);
    }
    expect(seen.get('root')).toBe('G');
    expect(seen.get('3rd')).toBe('B');
    expect(seen.get('7th')).toBe('F♯');
    expect(seen.size).toBe(7);
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
    expect(s.lastResult).toMatchObject({ firstTry: true, ms: 1800, combo: 1 });
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
    expect(s.lastResult).toMatchObject({ firstTry: false, mistakes: 1, combo: 0 });
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
    s.click(s.question.string, s.question.frets[0], 3000);
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
});
