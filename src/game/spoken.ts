import { STRING_NAMES, fretMidi, pcName, isNatural } from '../music/theory';
import type { Question } from './scheduler';

// What the app says when prompts are spoken. Kept apart from the speech engine so that the
// wording can be tested, and short: every word delays the moment you can play.
//
// The context comes first and the word to act on last ("G string." then "C sharp."). The
// reaction clock starts when that last word begins to sound.

export interface SpokenPrompt {
  /** Said first, untimed: which string, or "Every" for a sweep. */
  context: string[];
  /** The word to act on. The clock starts when it begins. */
  target: string;
}

const DEGREE_WORDS: Record<string, string> = {
  '1': 'root',
  '2': 'second',
  '3': 'third',
  '4': 'fourth',
  '5': 'fifth',
  '6': 'sixth',
  '7': 'seventh',
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "C♯" -> "C sharp", "B♭ minor" -> "B flat minor". */
export function sayName(name: string): string {
  return name.replace(/♯/g, ' sharp').replace(/♭/g, ' flat');
}

/** "♭7" -> "flat seventh", "1" -> "root". */
export function sayDegree(degree: string): string {
  const flat = degree.startsWith('♭');
  const word = DEGREE_WORDS[degree.replace('♭', '')] ?? degree;
  return flat ? `flat ${word}` : word;
}

export function sayString(string: number): string {
  return `${STRING_NAMES[string]} string`;
}

const sayFret = (fret: number) => (fret === 0 ? 'open' : `fret ${fret}`);

/**
 * A note name for speaking. A sharp or flat has two names and only one can be said, so it is
 * picked at random per question: both are worth knowing, and the item is the same either way.
 */
export function sayNote(pc: number, rng: () => number = Math.random): string {
  if (isNatural(pc)) return pcName(pc);
  return sayName(pcName(pc, rng() < 0.5 ? 'sharp' : 'flat'));
}

/**
 * The prompt for a question, or null when nothing needs saying.
 *
 * In a String sweep only the first string of a note is announced ("Every" "C sharp"): the
 * strings follow low to high, so you know the next one, and speaking it would only shut the
 * microphone while you are already playing.
 */
export function promptWords(q: Question, previous: Question | null, rng: () => number = Math.random): SpokenPrompt | null {
  if (q.position && q.degree) return { context: [], target: `${capital(sayDegree(q.degree))}.` };
  if (q.mode === 'sweep') {
    if (previous && previous.mode === 'sweep' && previous.pc === q.pc) return null;
    return { context: ['Every'], target: `${sayNote(q.pc, rng)}.` };
  }
  return { context: [`${capital(sayString(q.string ?? 0))}.`], target: `${sayNote(q.pc, rng)}.` };
}

/** The untimed step when a scale box starts. The key is only named at the start of the round. */
export function introWords(q: Question, firstBox: boolean): string {
  const position = `position ${(q.position?.index ?? 0) + 1}`;
  const lead = firstBox && q.context ? `${sayName(q.context)}, ${position}` : capital(position);
  return `${lead}. Play the root.`;
}

/** The answer, when it is shown after the time limit: "Fret 3." or "D. A string, fret 5." */
export function revealWords(q: Question): string {
  if (q.position) {
    // A degree can sit in two places in a box, an octave apart; the lower one is enough.
    const cell = [...q.cells].sort((a, b) => fretMidi(a.string, a.fret) - fretMidi(b.string, b.fret))[0];
    if (!cell) return `${sayName(q.noteName)}.`;
    return `${sayName(q.noteName)}. ${capital(sayString(cell.string))}, ${sayFret(cell.fret)}.`;
  }
  return `${capital(q.cells.map((c) => sayFret(c.fret)).join(' or '))}.`;
}

/** Saying the prompt again on request. Unlike promptWords this always says the whole thing. */
export function repeatWords(q: Question, prompt: SpokenPrompt | null): string[] {
  if (prompt) return [...prompt.context, prompt.target];
  return [`${capital(sayString(q.string ?? 0))}.`];
}

export function summaryWords(total: number, firstTries: number, avgMs: number): string {
  const average = firstTries ? ` Average ${(avgMs / 1000).toFixed(1)} seconds.` : '';
  return `Round done. ${firstTries} of ${total} first try.${average}`;
}
