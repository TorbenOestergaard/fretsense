import { mic } from './mic';

// Spoken prompts and feedback sounds, so a round can be played with your eyes on the fretboard.
//
// Speech uses the browser's speechSynthesis with a voice installed on this computer. Voices that
// are not local (Chrome's "Google ..." voices) send the text to a server, so they are never used.
//
// The microphone hears the laptop speaker. While something is being said the microphone is
// ducked (see mic.duck); the sounds played while the app is listening are noise bursts without a
// pitch, which the detector ignores by design.

export interface VoicePrefs {
  on: boolean;
  /** voiceURI of the chosen voice, or null for the default pick. */
  voiceURI: string | null;
  volume: number;
  rate: number;
}

export interface VoiceState extends VoicePrefs {
  /** A local English voice exists, so prompts can be spoken. */
  available: boolean;
  voiceName: string | null;
}

interface SayOptions {
  /**
   * The last part has started to sound. Also called, with false, when the voice fails, so that a
   * clock waiting for it always starts.
   */
  onTarget?: (heard: boolean) => void;
  onEnd?: () => void;
}

/** Kept apart from the practice record: it describes this computer, and is never synced. */
const PREFS_KEY = 'fretsense.voice.v1';
const DEFAULT_PREFS: VoicePrefs = { on: false, voiceURI: null, volume: 1, rate: 1 };
/** macOS voices that pronounce single letters clearly, in order of preference. */
const PREFERRED = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Alex'];
/** Silence from the voice for this long means it is not going to speak. */
const START_TIMEOUT_MS = 1500;
/** No utterance here is longer than this; a missing "end" event must not block the round. */
const UTTERANCE_TIMEOUT_MS = 5000;
const AFTER_CANCEL_MS = 80;

function loadPrefs(): VoicePrefs {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<VoicePrefs>) : {};
    return {
      on: parsed.on === true,
      voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : null,
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_PREFS.volume,
      rate: typeof parsed.rate === 'number' ? Math.min(1.5, Math.max(0.6, parsed.rate)) : DEFAULT_PREFS.rate,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** The voice to use: the chosen one if it is still there, else a preferred local English voice. */
export function pickVoice<V extends { name: string; lang: string; localService: boolean; voiceURI: string }>(
  voices: V[],
  voiceURI: string | null,
): V | null {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith('en'));
  const chosen = voiceURI ? local.find((v) => v.voiceURI === voiceURI) : undefined;
  if (chosen) return chosen;
  for (const name of PREFERRED) {
    const match = local.find((v) => v.name === name) ?? local.find((v) => v.name.startsWith(name));
    if (match) return match;
  }
  return local[0] ?? null;
}

class VoiceEngine {
  private prefs = loadPrefs();
  private state: VoiceState = { ...this.prefs, available: false, voiceName: null };
  private listeners = new Set<() => void>();
  private voice: SpeechSynthesisVoice | null = null;
  private synth: SpeechSynthesis | null = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
  /** Identifies the current say(); callbacks of an earlier, cancelled one are ignored. */
  private job = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private lastCancelAt = -Infinity;
  private ownCtx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  constructor() {
    if (!this.synth) return;
    // Chrome fills the list asynchronously; the first call asks for it.
    this.refreshVoices();
    this.synth.addEventListener?.('voiceschanged', () => this.refreshVoices());
  }

  getState = (): VoiceState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Prompts are spoken: switched on, and a voice exists. */
  get active(): boolean {
    return this.state.on && this.state.available;
  }

  setPrefs(patch: Partial<VoicePrefs>) {
    this.prefs = { ...this.prefs, ...patch };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Storage unavailable: the choice lasts until the page is closed.
    }
    if (!this.prefs.on) this.cancel();
    this.refreshVoices();
  }

  /**
   * Says the parts one after another. Anything still being said is cut off first. The microphone
   * is ducked from now until the last part has ended.
   */
  say(parts: string[], options: SayOptions = {}) {
    this.cancel();
    const wait = Math.max(0, this.lastCancelAt + AFTER_CANCEL_MS - performance.now());
    const synth = this.synth;
    const job = ++this.job;
    let targetDone = false;
    const target = (heard: boolean) => {
      if (targetDone) return;
      targetDone = true;
      options.onTarget?.(heard);
    };
    const finish = () => {
      if (job !== this.job) return;
      this.job++;
      this.clearWatchdog();
      target(false);
      mic.unduck();
      options.onEnd?.();
    };
    if (!synth || !this.voice || parts.length === 0) {
      finish();
      return;
    }
    const arm = (ms: number) => {
      this.clearWatchdog();
      this.watchdog = setTimeout(() => {
        if (job !== this.job) return;
        synth.cancel();
        finish();
      }, ms);
    };
    mic.duck();
    arm(START_TIMEOUT_MS + wait);
    let attempt = 0;
    const speakAll = () => parts.forEach((text, i) => {
      if (job !== this.job) return;
      const mine = attempt;
      const current = () => job === this.job && mine === attempt;
      const last = i === parts.length - 1;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = this.voice;
      utterance.lang = this.voice!.lang;
      utterance.volume = this.prefs.volume;
      utterance.rate = this.prefs.rate;
      utterance.onstart = () => {
        if (!current()) return;
        arm(UTTERANCE_TIMEOUT_MS);
        if (last) target(true);
      };
      utterance.onend = () => {
        if (!current()) return;
        if (last) finish();
        else arm(START_TIMEOUT_MS);
      };
      utterance.onerror = (event) => {
        if (!current()) return;
        // A cancel() from just before can land late and take these utterances with it
        // (seen in Chrome while the voice is still loading). Say it once more.
        const cutOff = event.error === 'canceled' || event.error === 'interrupted';
        if (cutOff && attempt === 0 && !targetDone) {
          attempt++;
          arm(START_TIMEOUT_MS + AFTER_CANCEL_MS);
          setTimeout(speakAll, AFTER_CANCEL_MS);
        } else finish();
      };
      synth.speak(utterance);
    });
    // Never in the same task: a say() that is cancelled at once (React's development mode mounts
    // a screen twice) then never reaches the speech queue. And Chrome drops utterances queued
    // directly after a cancel(), so a real cancel is given time to land.
    setTimeout(speakAll, wait);
  }

  /** Stops speaking without calling back, and opens the microphone again. */
  cancel() {
    this.job++;
    this.clearWatchdog();
    if (this.synth && (this.synth.speaking || this.synth.pending)) {
      this.synth.cancel();
      this.lastCancelAt = performance.now();
    }
    mic.unduck();
  }

  /** Right: a short high tick. It has no pitch, so the detector does not hear a note in it. */
  tick() {
    this.burst({ type: 'highpass', frequency: 3000, seconds: 0.035, gain: 0.5 });
  }

  /** Wrong: a low thud, also without a pitch. */
  thud() {
    this.burst({ type: 'lowpass', frequency: 260, seconds: 0.13, gain: 0.9 });
  }

  private burst(opts: { type: BiquadFilterType; frequency: number; seconds: number; gain: number }) {
    const ctx = this.audioContext();
    if (!ctx) return;
    if (!this.noise || this.noise.sampleRate !== ctx.sampleRate) {
      this.noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.25), ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.value = opts.frequency;
    filter.Q.value = 0.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(opts.gain * this.prefs.volume, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + opts.seconds);
    source.connect(filter).connect(env).connect(ctx.destination);
    source.start(now);
    source.stop(now + opts.seconds + 0.02);
  }

  /** The microphone's context when it is running, else one of our own (click-to-answer rounds). */
  private audioContext(): AudioContext | null {
    if (mic.context) return mic.context;
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ownCtx || this.ownCtx.state === 'closed') this.ownCtx = new AudioContext();
    if (this.ownCtx.state === 'suspended') void this.ownCtx.resume().catch(() => {});
    return this.ownCtx;
  }

  private clearWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private refreshVoices() {
    this.voice = this.synth ? pickVoice(this.synth.getVoices(), this.prefs.voiceURI) : null;
    this.state = { ...this.prefs, available: this.voice !== null, voiceName: this.voice?.name ?? null };
    this.listeners.forEach((fn) => fn());
  }
}

export const voice = new VoiceEngine();
