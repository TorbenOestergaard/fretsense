import { describe, expect, it } from 'vitest';
import { SCALES, SCALE_IDS, buildScale, fretsFor, freqToMidi, midiName, midiToFreq, pcName, targetMidis } from './theory';

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
