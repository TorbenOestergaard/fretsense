import { PitchDetector } from 'pitchy';
import { freqToMidi } from '../music/theory';

/** One analysis step of the incoming audio. */
export interface Frame {
  t: number;
  /** Nearest MIDI note, or null when nothing clearly pitched is sounding. */
  midi: number | null;
  /** Deviation from that note in cents (-50..50). */
  cents: number;
  freq: number;
  /** 0..1, how periodic the signal is. A cleanly ringing string is above 0.9. */
  clarity: number;
  rms: number;
  /** Current estimate of the room's background level. */
  noiseFloor: number;
}

export interface GateOptions {
  /** Signal must be this many times louder than the background. */
  floorMultiplier: number;
  /** Absolute minimum level, linear (0.0008 is about -62 dBFS). */
  minRms: number;
  minClarity: number;
}

export const GATES: Record<'low' | 'normal' | 'high', GateOptions> = {
  low: { floorMultiplier: 4, minRms: 0.002, minClarity: 0.92 },
  normal: { floorMultiplier: 2.2, minRms: 0.0008, minClarity: 0.88 },
  high: { floorMultiplier: 1.5, minRms: 0.0004, minClarity: 0.84 },
};

// Low E is 82 Hz; the high E string at fret 24 is 1319 Hz. Anything outside is not a guitar note
// (mains hum at 50/60 Hz, whistles, pick clicks).
const MIN_FREQ = 70;
const MAX_FREQ = 1400;

export function rmsOf(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** Window length that holds roughly 85 ms: at least seven periods of the low E string. */
export function windowSizeFor(sampleRate: number): number {
  let size = 2048;
  while (size < sampleRate * 0.08) size *= 2;
  return size;
}

/**
 * Turns raw audio windows into frames: pitch (McLeod pitch method, via pitchy), clarity, level,
 * and a gate that separates a ringing string from room noise.
 *
 * The McLeod method works on the waveform's periodicity rather than on FFT peaks, which is what
 * makes the low strings detectable on a laptop microphone that barely records their fundamental.
 */
export class PitchAnalyzer {
  private detector: PitchDetector<Float32Array>;
  private noiseFloor = 0;
  private floorReady = false;
  gate: GateOptions;

  constructor(
    readonly size: number,
    readonly sampleRate: number,
    gate: GateOptions = GATES.normal,
  ) {
    this.detector = PitchDetector.forFloat32Array(size);
    // Gating is done here, against a measured noise floor, not by pitchy's fixed threshold.
    this.detector.minVolumeDecibels = -120;
    this.gate = gate;
  }

  analyze(buf: Float32Array, t: number): Frame {
    const rms = rmsOf(buf);
    const [freq, clarity] = this.detector.findPitch(buf, this.sampleRate);
    this.trackNoise(rms, clarity);

    const loud = rms > Math.max(this.gate.minRms, this.noiseFloor * this.gate.floorMultiplier);
    const pitched = clarity >= this.gate.minClarity && freq >= MIN_FREQ && freq <= MAX_FREQ;
    if (!loud || !pitched) {
      return { t, midi: null, cents: 0, freq: 0, clarity, rms, noiseFloor: this.noiseFloor };
    }
    const exact = freqToMidi(freq);
    const midi = Math.round(exact);
    return { t, midi, cents: (exact - midi) * 100, freq, clarity, rms, noiseFloor: this.noiseFloor };
  }

  /**
   * Background level estimate. Only unpitched sound may raise it, so playing continuously never
   * teaches the gate that "guitar" is the background.
   */
  private trackNoise(rms: number, clarity: number) {
    if (!this.floorReady) {
      this.noiseFloor = rms;
      this.floorReady = true;
      return;
    }
    if (rms < this.noiseFloor) this.noiseFloor += 0.2 * (rms - this.noiseFloor);
    else if (clarity < 0.5) this.noiseFloor += 0.03 * (rms - this.noiseFloor);
  }
}
