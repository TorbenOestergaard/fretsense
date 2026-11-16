import { describe, expect, it } from 'vitest';
import { pickVoice } from '../audio/voice';
import { DEFAULT_SETTINGS, applyAnswer, emptyProgress, itemKey, type Settings } from './progress';
import { Scheduler, toQuestion } from './scheduler';
import { FEEDBACK_OK_MS, REVEAL_AFTER_MS, Session } from './session';
import { introWords, promptWords, repeatWords, revealWords, sayDegree, sayNote, summaryWords } from './spoken';
import { buildScale, positionsOf } from '../music/theory';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
const note = (string: number, pc: number, mode: 'notes' | 'sweep' = 'notes') => toQuestion({ string, pc }, mode, null);

describe('spoken wording', () => {
  it('says the string first and the note last in the Note finder', () => {
    expect(promptWords(note(3, 0), null)).toEqual({ context: ['G string.'], target: 'C.' });
    expect(promptWords(note(0, 9), null)).toEqual({ context: ['Low E string.'], target: 'A.' });
    expect(promptWords(note(5, 4), null)).toEqual({ context: ['High E string.'], target: 'E.' });
  });

  it('says a sharp or flat under one of its two names, chosen per question', () => {
    expect(sayNote(1, () => 0.1)).toBe('C sharp');
    expect(sayNote(1, () => 0.9)).toBe('D flat');
    expect(sayNote(10, () => 0.9)).toBe('B flat');
    expect(sayNote(7, () => 0.9)).toBe('G');
  });

  it('announces a sweep once per note and stays silent for the strings that follow', () => {
    const first = note(0, 6, 'sweep');
    expect(promptWords(first, null, () => 0)).toEqual({ context: ['Every'], target: 'F sharp.' });
    const second = note(1, 6, 'sweep');
    expect(promptWords(second, first)).toBeNull();
    expect(promptWords(note(0, 2, 'sweep'), note(5, 6, 'sweep'))).toEqual({ context: ['Every'], target: 'D.' });
    // Asked to say it again mid-sweep, it names the string that is due.
    expect(repeatWords(second, null)).toEqual(['A string.']);
  });

  it('asks scale degrees by name, with the root step and the key only at the start', () => {
    const scale = buildScale('G', 'minor');
    const box = positionsOf(scale)[1];
    const q = (degree: string) => toQuestion({ string: null, pc: scale.notes.find((n) => n.degree === degree)!.pc, degree, position: box }, 'positions', scale);
    expect(promptWords(q('5'), null)).toEqual({ context: [], target: 'Fifth.' });
    expect(promptWords(q('♭7'), null)).toEqual({ context: [], target: 'Flat seventh.' });
    expect(sayDegree('1')).toBe('root');
    expect(introWords(q('1'), true)).toBe('G minor, position 2. Play the root.');
    expect(introWords(q('1'), false)).toBe('Position 2. Play the root.');
    const flat = toQuestion({ string: null, pc: 10, degree: '1', position: positionsOf(buildScale('B♭', 'major'))[0] }, 'positions', buildScale('B♭', 'major'));
    expect(introWords(flat, true)).toBe('B flat major, position 1. Play the root.');
  });

  it('gives the answer as a fret, or as note, string and fret inside a box', () => {
    expect(revealWords(note(1, 0))).toBe('Fret 3.');
    expect(revealWords(note(1, 9))).toBe('Open or fret 12.');
    const scale = buildScale('G', 'major');
    const box = positionsOf(scale)[0];
    const fifth = toQuestion({ string: null, pc: 2, degree: '5', position: box }, 'positions', scale);
    const lowest = [...fifth.cells].sort((a, b) => a.string - b.string)[0];
    expect(revealWords(fifth)).toMatch(/^D\. (Low E|A|D|G|B|High E) string, (open|fret \d+)\.$/);
    expect(revealWords(fifth)).toContain(lowest.fret === 0 ? 'open' : `fret ${lowest.fret}`);
  });

  it('sums up the round', () => {
    expect(summaryWords(20, 18, 2440)).toBe('Round done. 18 of 20 first try. Average 2.4 seconds.');
    expect(summaryWords(5, 0, 0)).toBe('Round done. 0 of 5 first try.');
  });
});

describe('voice choice', () => {
  const v = (name: string, lang: string, localService: boolean) => ({ name, lang, localService, voiceURI: name });

  it('never uses a voice that sends the text to a server', () => {
    expect(pickVoice([v('Google US English', 'en-US', false)], null)).toBeNull();
    expect(pickVoice([v('Google US English', 'en-US', false), v('Fred', 'en-US', true)], 'Google US English')?.name).toBe('Fred');
  });

  it('prefers the chosen voice, then a known clear one, and only English', () => {
    const voices = [v('Sara', 'da-DK', true), v('Fred', 'en-US', true), v('Samantha', 'en-US', true), v('Daniel', 'en-GB', true)];
    expect(pickVoice(voices, null)?.name).toBe('Samantha');
    expect(pickVoice(voices, 'Daniel')?.name).toBe('Daniel');
    expect(pickVoice(voices, 'Sara')?.name).toBe('Samantha');
    expect(pickVoice([v('Sara', 'da-DK', true)], null)).toBeNull();
  });
});

describe('session with spoken prompts', () => {
  const make = (patch: Partial<Settings> = {}) => {
    let s = 7;
    const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000);
    const scheduler = new Scheduler(settings({ mode: 'notes', ...patch }), () => undefined, rng, () => 0);
    return new Session(scheduler, scheduler.roundLength(), 0, () => {}, true);
  };

  it('holds a question until its clock is started: no answer, no miss, no time limit', () => {
    const s = make();
    expect(s.waiting).toBe(true);
    s.noteOn(s.question.targets[0], 500);
    s.noteHeld(s.question.targets[0] + 1, 800);
    s.tick(REVEAL_AFTER_MS + 5000);
    expect(s.phase).toBe('asking');
    expect(s.results).toHaveLength(0);

    // "G string." took 900 ms; the clock starts as the note name begins.
    s.startClock(20000, true);
    s.noteOn(s.question.targets[0], 21500);
    expect(s.lastResult).toMatchObject({ firstTry: true, ms: 1500, spoken: true });

    s.tick(21500 + FEEDBACK_OK_MS);
    expect(s.phase).toBe('asking');
    expect(s.waiting).toBe(true);
    s.startClock(23000);
    s.noteOn(s.question.targets[0], 24000);
    expect(s.lastResult).toMatchObject({ ms: 1000, spoken: false });
  });

  it('counts the time limit from the spoken word, and Space or a click never waits for the voice', () => {
    const s = make();
    s.startClock(3000, true);
    s.tick(3000 + REVEAL_AFTER_MS - 1);
    expect(s.phase).toBe('asking');
    s.tick(3000 + REVEAL_AFTER_MS);
    expect(s.phase).toBe('revealed');

    const t = make();
    t.skip(100);
    expect(t.phase).toBe('revealed');
    const u = make();
    const cell = u.question.cells[0];
    u.click(cell.string, cell.fret, 400);
    expect(u.phase).toBe('feedback');
  });

  it('waits again after the untimed root step of a scale box', () => {
    const s = make({ mode: 'positions', tonic: 'G', scaleId: 'majorPent', positions: [true, false, false, false, false] });
    expect(s.phase).toBe('intro');
    expect(s.waiting).toBe(false);
    s.noteOn(43, 5000);
    expect(s.phase).toBe('asking');
    expect(s.waiting).toBe(true);
    s.noteOn(s.question.targets[0], 5400); // played while "Fifth." is still being said
    expect(s.phase).toBe('asking');
    s.startClock(5200, true);
    s.noteOn(s.question.targets[0], 6600);
    expect(s.lastResult).toMatchObject({ ms: 1400, spoken: true });
  });

  it('marks spoken answers in the log and leaves the others as they were', () => {
    let data = applyAnswer(emptyProgress(), { mode: 'notes', key: itemKey(3, 0), pc: 0, string: 3, fret: 5, firstTry: true, ms: 1500, spoken: true }, 1000).data;
    data = applyAnswer(data, { mode: 'notes', key: itemKey(3, 2), pc: 2, string: 3, fret: 7, firstTry: true, ms: 1500 }, 2000).data;
    expect(data.events[0].sp).toBe(1);
    expect('sp' in data.events[1]).toBe(false);
  });
});
