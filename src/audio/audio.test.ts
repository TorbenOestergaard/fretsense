import { describe, expect, it } from 'vitest';
import { STRING_OPEN_MIDI, midiToFreq } from '../music/theory';
import { NoteTracker, type NoteEvent } from './noteTracker';
import { PitchAnalyzer, windowSizeFor, type Frame } from './pitch';

const SR = 48000;
const SIZE = windowSizeFor(SR);
const HOP = Math.round(SR * 0.024);

/** Deterministic noise so the tests do not flake. */
function makeNoise(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
}

interface Pluck {
  at: number;
  midi: number;
  amp?: number;
  /** Decay time constant in seconds. */
  decay?: number;
  /** Cents off pitch. */
  detune?: number;
}

/**
 * A rough model of an unplugged electric through a laptop microphone: the fundamental is weak
 * (small microphones roll off the bass), the overtones are strong, a burst of pick noise starts
 * each note, and there is a constant bed of room noise.
 */
function render(seconds: number, plucks: Pluck[], noiseLevel = 0.0006): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const noise = makeNoise();
  for (let i = 0; i < out.length; i++) out[i] = noise() * 2 * noiseLevel;
  const harmonics = [0.25, 1, 0.7, 0.4, 0.25, 0.12];
  plucks.forEach((p, idx) => {
    const start = Math.round(p.at * SR);
    // A new pluck on a monophonic line stops the previous note.
    const end = idx + 1 < plucks.length ? Math.round(plucks[idx + 1].at * SR) : out.length;
    const f0 = midiToFreq(p.midi) * Math.pow(2, (p.detune ?? 0) / 1200);
    const amp = p.amp ?? 0.03;
    const decay = p.decay ?? 1.2;
    for (let i = start; i < end; i++) {
      const t = (i - start) / SR;
      const env = amp * Math.exp(-t / decay) * Math.min(1, t / 0.004);
      let v = 0;
      for (let h = 0; h < harmonics.length; h++) {
        v += harmonics[h] * Math.exp(-t * h * 0.8) * Math.sin(2 * Math.PI * f0 * (h + 1) * t + h);
      }
      const pick = t < 0.012 ? noise() * amp * 3 : 0;
      out[i] += env * v * 0.45 + pick;
    }
  });
  return out;
}

function run(signal: Float32Array, analyzer = new PitchAnalyzer(SIZE, SR)) {
  const tracker = new NoteTracker();
  const frames: Frame[] = [];
  const events: NoteEvent[] = [];
  for (let end = SIZE; end <= signal.length; end += HOP) {
    const frame = analyzer.analyze(signal.subarray(end - SIZE, end), (end / SR) * 1000);
    frames.push(frame);
    events.push(...tracker.push(frame));
  }
  return { frames, events, ons: events.filter((e) => e.type === 'on') };
}

describe('pitch detection', () => {
  it('finds every fretted position from open to fret 12 on all six strings', () => {
    for (const open of STRING_OPEN_MIDI) {
      for (let fret = 0; fret <= 12; fret++) {
        const midi = open + fret;
        const { ons } = run(render(1.0, [{ at: 0.3, midi }]));
        expect(ons.map((e) => e.midi), `midi ${midi}`).toEqual([midi]);
      }
    }
  });

  it('tolerates a guitar that is 30 cents out of tune', () => {
    for (const detune of [-30, 30]) {
      const { ons } = run(render(1.0, [{ at: 0.3, midi: 45, detune }]));
      expect(ons.map((e) => e.midi)).toEqual([45]);
    }
  });

  it('hears a very quiet note above the room noise', () => {
    const { ons } = run(render(1.2, [{ at: 0.4, midi: 40, amp: 0.006 }]));
    expect(ons.map((e) => e.midi)).toEqual([40]);
  });

  it('stays silent on noise alone', () => {
    const { events } = run(render(2, [], 0.004));
    expect(events).toEqual([]);
  });

  it('reports a note within about 200 ms of the pluck', () => {
    const { ons } = run(render(1.0, [{ at: 0.3, midi: 52 }]));
    expect(ons[0].t - 300).toBeLessThan(220);
  });
});

describe('note tracking', () => {
  it('emits one event per pluck in a sequence of different notes', () => {
    const { ons } = run(
      render(3, [
        { at: 0.3, midi: 43 },
        { at: 1.0, midi: 55 },
        { at: 1.7, midi: 48 },
        { at: 2.3, midi: 64 },
      ]),
    );
    expect(ons.map((e) => e.midi)).toEqual([43, 55, 48, 64]);
  });

  it('counts the same pitch plucked again as a new note', () => {
    // C3 at fret 8 of the low E string, then C3 at fret 3 of the A string.
    const { ons } = run(
      render(2.5, [
        { at: 0.3, midi: 48 },
        { at: 1.3, midi: 48 },
      ]),
    );
    expect(ons.map((e) => e.midi)).toEqual([48, 48]);
  });

  it('does not re-trigger while a note rings out and fades into the noise', () => {
    const { ons } = run(render(5, [{ at: 0.3, midi: 50, decay: 0.7 }]));
    expect(ons.map((e) => e.midi)).toEqual([50]);
  });

  it('marks a note as held only after it has rung for a while', () => {
    const { events } = run(render(1.5, [{ at: 0.3, midi: 57 }]));
    const on = events.find((e) => e.type === 'on')!;
    const held = events.find((e) => e.type === 'held')!;
    expect(held.midi).toBe(57);
    expect(held.t - on.t).toBeGreaterThanOrEqual(250);
  });

  it('ignores a brush of a string that is too short to be a note', () => {
    const signal = render(1.5, [{ at: 0.3, midi: 59, decay: 0.01 }]);
    const { events } = run(signal);
    expect(events.filter((e) => e.type === 'held')).toEqual([]);
  });
});

describe('ducking while the app speaks', () => {
  /** Runs the chain with the analyser muted between two times (seconds), as mic.duck() does. */
  function runDucked(signal: Float32Array, from: number, to: number, duck = true) {
    const analyzer = new PitchAnalyzer(SIZE, SR);
    const tracker = new NoteTracker();
    const frames: Frame[] = [];
    const ons: NoteEvent[] = [];
    for (let end = SIZE; end <= signal.length; end += HOP) {
      const t = end / SR;
      const frame = analyzer.analyze(signal.subarray(end - SIZE, end), t * 1000, duck && t >= from && t < to);
      frames.push(frame);
      ons.push(...tracker.push(frame).filter((e) => e.type === 'on'));
    }
    return { frames, ons };
  }

  /** A quiet note at 2.0 s, after one second of "speech" from the speaker: a loud vowel, then a loud hiss. */
  function withSpeech() {
    const signal = render(3, [{ at: 2.0, midi: 52, amp: 0.006 }]);
    const noise = makeNoise(9);
    for (let i = Math.round(0.6 * SR); i < Math.round(1.6 * SR); i++) {
      const t = i / SR;
      const vowel = t < 1.2 ? Math.sin(2 * Math.PI * 147 * t) + 0.6 * Math.sin(2 * Math.PI * 294 * t) + 0.3 * Math.sin(2 * Math.PI * 441 * t) : 0;
      const hiss = t >= 1.2 ? noise() * 2 : 0;
      signal[i] += 0.05 * (vowel + hiss);
    }
    return signal;
  }

  it('would take a spoken vowel for a note if it kept listening', () => {
    const { ons } = runDucked(withSpeech(), 0.5, 1.8, false);
    expect(ons[0]?.midi).toBe(50); // D3, 147 Hz: the "speech", not the guitar
  });

  it('hears nothing while ducked, leaves the noise floor alone, and catches a quiet note right after', () => {
    const { frames, ons } = runDucked(withSpeech(), 0.5, 1.8);
    expect(ons.map((e) => e.midi)).toEqual([52]);
    const at = (seconds: number) => frames[Math.round((seconds * SR - SIZE) / HOP)];
    expect(at(1.75).noiseFloor).toBeCloseTo(at(0.45).noiseFloor, 6);
    expect(frames.filter((f) => f.t >= 500 && f.t < 1800).every((f) => f.midi === null)).toBe(true);
  });
});
