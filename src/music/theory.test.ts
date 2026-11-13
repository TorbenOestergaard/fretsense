import { describe, expect, it } from 'vitest';
import { POSITION_MAX_FRET, SCALES, SCALE_IDS, buildScale, fretsFor, freqToMidi, midiName, midiToFreq, pcName, positionsOf, targetMidis } from './theory';

describe('fretboard', () => {
  it('places notes on the right frets', () => {
    expect(fretsFor(0, 0)).toEqual([8]); // C on the low E string
    expect(fretsFor(1, 0)).toEqual([3]); // C on the A string
    expect(fretsFor(3, 0)).toEqual([5]); // C on the G string
    expect(fretsFor(4, 0)).toEqual([1]); // C on the B string
    expect(fretsFor(2, 2)).toEqual([0, 12]); // D on the D string: open and fret 12
  });

  it('accepts only the pitches of that string', () => {
    expect(targetMidis(0, 0).map(midiName)).toEqual(['C3']);
    expect(targetMidis(3, 0).map(midiName)).toEqual(['C4']);
    expect(targetMidis(5, 4).map(midiName)).toEqual(['E4', 'E5']);
  });

  it('converts between frequency and note', () => {
    expect(midiToFreq(40)).toBeCloseTo(82.41, 2);
    expect(freqToMidi(440)).toBe(69);
    expect(midiName(64)).toBe('E4');
  });

  it('names accidentals both ways unless asked', () => {
    expect(pcName(6)).toBe('F♯/G♭');
    expect(pcName(6, 'flat')).toBe('G♭');
    expect(pcName(7)).toBe('G');
  });
});

describe('scales', () => {
  const names = (tonic: string, id: Parameters<typeof buildScale>[1]) => buildScale(tonic, id).notes.map((n) => n.name);

  it('spells major keys with the right accidentals', () => {
    expect(names('C', 'major')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(names('G', 'major')).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F♯']);
    expect(names('Eb', 'major')).toEqual(['E♭', 'F', 'G', 'A♭', 'B♭', 'C', 'D']);
    expect(names('F#', 'major')).toEqual(['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯']);
  });

  it('spells minor and pentatonic scales', () => {
    expect(names('A', 'minor')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(names('C', 'minor')).toEqual(['C', 'D', 'E♭', 'F', 'G', 'A♭', 'B♭']);
    expect(names('A', 'minorPent')).toEqual(['A', 'C', 'D', 'E', 'G']);
    expect(names('G', 'majorPent')).toEqual(['G', 'A', 'B', 'D', 'E']);
  });

  it('labels degrees', () => {
    const scale = buildScale('A', 'minor');
    expect(scale.name).toBe('A minor');
    expect(scale.notes.map((n) => n.ordinal)).toEqual(['root', '2nd', '♭3rd', '4th', '5th', '♭6th', '♭7th']);
  });

  it('never needs a double accidental in the offered keys', () => {
    for (const id of SCALE_IDS) {
      for (const tonic of SCALES[id].tonics) {
        for (const note of buildScale(tonic, id).notes) expect(note.name.length, `${tonic} ${id}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('scale positions', () => {
  const frets = (tonic: string, id: Parameters<typeof buildScale>[1]) => positionsOf(buildScale(tonic, id)).map((p) => [p.lo, p.hi]);

  it('places the five major boxes where guitarists expect them', () => {
    expect(frets('G', 'major')).toEqual([[2, 5], [4, 8], [7, 10], [9, 13], [11, 15]]);
    expect(positionsOf(buildScale('G', 'major')).map((p) => p.shape)).toEqual(['E shape', 'D shape', 'C shape', 'A shape', 'G shape']);
  });

  it('numbers minor boxes from the one with the root on the low E string', () => {
    expect(frets('A', 'minorPent')).toEqual([[5, 8], [7, 10], [9, 13], [12, 15], [2, 5]]);
    const first = positionsOf(buildScale('A', 'minorPent'))[0];
    // The familiar A minor pentatonic box: two notes per string between frets 5 and 8.
    expect(first.cells.map((c) => `${c.string}:${c.fret}`)).toEqual(['0:5', '0:8', '1:5', '1:7', '2:5', '2:7', '3:5', '3:7', '4:5', '4:8', '5:5', '5:8']);
    expect(first.cells.filter((c) => c.degree === '1').map((c) => `${c.string}:${c.fret}`)).toEqual(['0:5', '2:7', '5:5']);
  });

  it('spells out the E-shape box of G major', () => {
    const box = positionsOf(buildScale('G', 'major'))[0];
    const perString = [0, 1, 2, 3, 4, 5].map((s) => box.cells.filter((c) => c.string === s).map((c) => c.fret));
    expect(perString).toEqual([[2, 3, 5], [2, 3, 5], [2, 4, 5], [2, 4, 5], [3, 5], [2, 3, 5]]);
  });

  it('keeps every box on the board and complete, in every key and scale', () => {
    for (const id of SCALE_IDS) {
      for (const tonic of SCALES[id].tonics) {
        const scale = buildScale(tonic, id);
        for (const box of positionsOf(scale)) {
          expect(box.lo, `${tonic} ${id}`).toBeGreaterThanOrEqual(0);
          expect(box.hi, `${tonic} ${id}`).toBeLessThanOrEqual(POSITION_MAX_FRET);
          expect(new Set(box.cells.map((c) => c.degree)).size, `${tonic} ${id} box ${box.index}`).toBe(scale.notes.length);
          // No pitch occurs twice in a box, so a played pitch identifies one place.
          const pitches = box.cells.map((c) => [40, 45, 50, 55, 59, 64][c.string] + c.fret);
          expect(new Set(pitches).size, `${tonic} ${id} box ${box.index}`).toBe(pitches.length);
        }
      }
    }
  });
});
