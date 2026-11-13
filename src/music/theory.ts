// Standard tuning only. String index 0 is the low E (6th string), 5 is the high E (1st string).

export const STRING_COUNT = 6;
export const STRING_OPEN_MIDI = [40, 45, 50, 55, 59, 64] as const;
export const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E'] as const;
export const STRING_LETTERS = ['E', 'A', 'D', 'G', 'B', 'e'] as const;
/** Conventional string numbers: the low E is the 6th string. */
export const STRING_NUMBERS = [6, 5, 4, 3, 2, 1] as const;
export const MAX_FRET = 12;

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const NATURAL_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

export function pcOf(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function isNatural(pc: number): boolean {
  return NATURAL_PCS.has(pc);
}

/** Name of a pitch class. Accidentals show both spellings by default ("F♯/G♭"). */
export function pcName(pc: number, style: 'sharp' | 'flat' | 'both' = 'both'): string {
  if (isNatural(pc) || style === 'sharp') return SHARP_NAMES[pc];
  if (style === 'flat') return FLAT_NAMES[pc];
  return `${SHARP_NAMES[pc]}/${FLAT_NAMES[pc]}`;
}

/** Scientific pitch name, e.g. 40 -> "E2". */
export function midiName(midi: number): string {
  return `${SHARP_NAMES[pcOf(midi)]}${Math.floor(midi / 12) - 1}`;
}

export function freqToMidi(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4);
}

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function fretMidi(string: number, fret: number): number {
  return STRING_OPEN_MIDI[string] + fret;
}

/** Every fret (0..maxFret) on a string that sounds the given pitch class. */
export function fretsFor(string: number, pc: number, maxFret = MAX_FRET): number[] {
  const frets: number[] = [];
  for (let fret = 0; fret <= maxFret; fret++) {
    if (pcOf(fretMidi(string, fret)) === pc) frets.push(fret);
  }
  return frets;
}

/** The exact pitches that count as "this note on this string". */
export function targetMidis(string: number, pc: number, maxFret = MAX_FRET): number[] {
  return fretsFor(string, pc, maxFret).map((fret) => fretMidi(string, fret));
}

// ---------------------------------------------------------------------------
// Scales and degrees

export interface DegreeDef {
  /** "1", "♭3", "5" ... */
  label: string;
  /** Scale-step number 1..7, used for letter spelling. */
  num: number;
  /** Semitones above the tonic. */
  semis: number;
}

export interface ScaleType {
  id: ScaleId;
  name: string;
  short: string;
  degrees: DegreeDef[];
  tonics: string[];
}

export type ScaleId = 'major' | 'minor' | 'majorPent' | 'minorPent';

const MAJOR_TONICS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_TONICS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D'];

const d = (label: string, num: number, semis: number): DegreeDef => ({ label, num, semis });

export const SCALES: Record<ScaleId, ScaleType> = {
  major: {
    id: 'major',
    name: 'Major (Ionian)',
    short: 'major',
    degrees: [d('1', 1, 0), d('2', 2, 2), d('3', 3, 4), d('4', 4, 5), d('5', 5, 7), d('6', 6, 9), d('7', 7, 11)],
    tonics: MAJOR_TONICS,
  },
  majorPent: {
    id: 'majorPent',
    name: 'Major pentatonic',
    short: 'major pentatonic',
    degrees: [d('1', 1, 0), d('2', 2, 2), d('3', 3, 4), d('5', 5, 7), d('6', 6, 9)],
    tonics: MAJOR_TONICS,
  },
  minor: {
    id: 'minor',
    name: 'Natural minor (Aeolian)',
    short: 'minor',
    degrees: [d('1', 1, 0), d('2', 2, 2), d('♭3', 3, 3), d('4', 4, 5), d('5', 5, 7), d('♭6', 6, 8), d('♭7', 7, 10)],
    tonics: MINOR_TONICS,
  },
  minorPent: {
    id: 'minorPent',
    name: 'Minor pentatonic',
    short: 'minor pentatonic',
    degrees: [d('1', 1, 0), d('♭3', 3, 3), d('4', 4, 5), d('5', 5, 7), d('♭7', 7, 10)],
    tonics: MINOR_TONICS,
  },
};

export const SCALE_IDS: ScaleId[] = ['major', 'majorPent', 'minor', 'minorPent'];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function accidental(offset: number): string {
  if (offset === 0) return '';
  return (offset > 0 ? '♯' : '♭').repeat(Math.abs(offset));
}

/** "F#" -> { letter: 'F', pc: 6, display: 'F♯' } */
export function parseNote(name: string): { letter: string; pc: number; display: string } {
  const letter = name[0].toUpperCase();
  const rest = name.slice(1);
  let offset = 0;
  for (const ch of rest) {
    if (ch === '#' || ch === '♯') offset += 1;
    else if (ch === 'b' || ch === '♭') offset -= 1;
  }
  return { letter, pc: (((LETTER_PC[letter] + offset) % 12) + 12) % 12, display: letter + accidental(offset) };
}

export interface ScaleNote {
  degree: string;
  /** "root", "3rd", "♭7th" */
  ordinal: string;
  pc: number;
  /** Spelled correctly for the key, e.g. "F♯" in G major. */
  name: string;
}

export interface Scale {
  tonic: string;
  type: ScaleType;
  /** "G major" */
  name: string;
  notes: ScaleNote[];
}

export function degreeOrdinal(label: string): string {
  const flat = label.startsWith('♭') ? '♭' : '';
  const num = label.replace('♭', '');
  if (num === '1') return 'root';
  const suffix = num === '2' ? 'nd' : num === '3' ? 'rd' : 'th';
  return `${flat}${num}${suffix}`;
}

export function buildScale(tonic: string, scaleId: ScaleId): Scale {
  const type = SCALES[scaleId];
  const root = parseNote(tonic);
  const rootLetterIdx = LETTERS.indexOf(root.letter);
  const notes = type.degrees.map((deg): ScaleNote => {
    const letter = LETTERS[(rootLetterIdx + deg.num - 1) % 7];
    const pc = (root.pc + deg.semis) % 12;
    let offset = pc - LETTER_PC[letter];
    if (offset > 6) offset -= 12;
    if (offset < -6) offset += 12;
    return { degree: deg.label, ordinal: degreeOrdinal(deg.label), pc, name: letter + accidental(offset) };
  });
  return { tonic, type, name: `${root.display} ${type.short}`, notes };
}

/** The scale note for a pitch class, if the pitch class is in the scale. */
export function scaleNoteFor(scale: Scale, pc: number): ScaleNote | undefined {
  return scale.notes.find((n) => n.pc === pc);
}

// ---------------------------------------------------------------------------
// The five scale positions (CAGED boxes)
//
// Each position is a fret window placed relative to where the parent major scale's tonic sits on
// the low E string. Minor scales use the windows of their relative major, numbered from the box
// that has the minor root under the first finger on the low E string (the familiar "position 1"
// of the minor pentatonic).

/** Highest fret drawn in position practice; the upper boxes of some keys reach past fret 12. */
export const POSITION_MAX_FRET = 15;

export interface PositionCell {
  string: number;
  fret: number;
  pc: number;
  degree: string;
}

export interface ScalePosition {
  /** 0..4 in playing order for this scale. */
  index: number;
  /** "E shape", "Em shape": the open chord the box is built around. */
  shape: string;
  lo: number;
  hi: number;
  cells: PositionCell[];
}

const BOXES = [
  { shape: 'E', minorShape: 'Dm', lo: -1, hi: 2 },
  { shape: 'D', minorShape: 'Cm', lo: 1, hi: 5 },
  { shape: 'C', minorShape: 'Am', lo: 4, hi: 7 },
  { shape: 'A', minorShape: 'Gm', lo: 6, hi: 10 },
  { shape: 'G', minorShape: 'Em', lo: 8, hi: 12 },
];

export function isMinorScale(id: ScaleId): boolean {
  return id === 'minor' || id === 'minorPent';
}

export function positionsOf(scale: Scale): ScalePosition[] {
  const minor = isMinorScale(scale.type.id);
  const tonicPc = parseNote(scale.tonic).pc;
  const majorPc = (tonicPc + (minor ? 3 : 0)) % 12;
  const rootFret = (majorPc - pcOf(STRING_OPEN_MIDI[0]) + 12) % 12;
  const order = minor ? [4, 0, 1, 2, 3] : [0, 1, 2, 3, 4];
  let previousLo = -1;
  return order.map((boxIdx, index) => {
    const box = BOXES[boxIdx];
    let lo = rootFret + box.lo;
    let hi = rootFret + box.hi;
    // Use the octave that fits the board, preferring to keep moving up the neck from box to box.
    const fits = [-12, 0, 12].filter((k) => lo + k >= 0 && hi + k <= POSITION_MAX_FRET);
    const shift = fits.find((k) => lo + k > previousLo) ?? fits[0] ?? 0;
    lo += shift;
    hi += shift;
    previousLo = lo;
    const cells: PositionCell[] = [];
    for (let string = 0; string < STRING_COUNT; string++) {
      for (let fret = Math.max(0, lo); fret <= hi; fret++) {
        const pc = pcOf(fretMidi(string, fret));
        const note = scaleNoteFor(scale, pc);
        if (note) cells.push({ string, fret, pc, degree: note.degree });
      }
    }
    // Report the frets the box actually uses (a pentatonic box is narrower than its parent scale's).
    const used = cells.map((c) => c.fret);
    return { index, shape: `${minor ? box.minorShape : box.shape} shape`, lo: Math.min(...used), hi: Math.max(...used), cells };
  });
}
