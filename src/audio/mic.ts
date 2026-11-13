import { midiToFreq } from '../music/theory';
import { NoteTracker, type NoteEvent } from './noteTracker';
import { GATES, PitchAnalyzer, windowSizeFor, type Frame } from './pitch';

export type MicStatus = 'idle' | 'starting' | 'running' | 'denied' | 'error' | 'unsupported';

export interface MicState {
  status: MicStatus;
  message: string | null;
  /** "mic" for the real microphone, "synth" for the built-in test tone source. */
  source: 'mic' | 'synth' | null;
  devices: { id: string; label: string }[];
  deviceLabel: string | null;
}

const FRAME_INTERVAL_MS = 24;

/**
 * Microphone -> AnalyserNode -> pitch frames -> note events.
 *
 * The browser's voice processing (echo cancellation, noise suppression, automatic gain) is
 * switched off: it is tuned for speech and treats a sustained guitar note as noise to remove.
 */
class MicEngine {
  private state: MicState = { status: 'idle', message: null, source: null, devices: [], deviceLabel: null };
  private stateListeners = new Set<() => void>();
  private frameListeners = new Set<(frame: Frame) => void>();
  private noteListeners = new Set<(event: NoteEvent) => void>();

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private analyzer: PitchAnalyzer | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tracker = new NoteTracker();
  private sensitivity: keyof typeof GATES = 'normal';
  lastFrame: Frame | null = null;

  getState = (): MicState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  };

  onFrame(fn: (frame: Frame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onNote(fn: (event: NoteEvent) => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  setSensitivity(level: keyof typeof GATES) {
    this.sensitivity = level;
    if (this.analyzer) this.analyzer.gate = GATES[level];
  }

  async start(deviceId: string | null = null): Promise<boolean> {
    if (this.state.status === 'running' && this.state.source === 'mic') return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setState({ status: 'unsupported', message: 'This browser cannot access a microphone.' });
      return false;
    }
    this.teardown();
    this.setState({ status: 'starting', message: null });
    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      };
      if (deviceId) audio.deviceId = { exact: deviceId };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (err) {
        // A remembered input that is no longer plugged in: fall back to the default one.
        if (deviceId && err instanceof DOMException && err.name === 'OverconstrainedError') {
          delete audio.deviceId;
          stream = await navigator.mediaDevices.getUserMedia({ audio });
        } else throw err;
      }
      this.stream = stream;
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.resume();
      this.ctx = ctx;
      this.attach(ctx, ctx.createMediaStreamSource(stream));
      const track = stream.getAudioTracks()[0];
      this.setState({ status: 'running', message: null, source: 'mic', deviceLabel: track?.label ?? null });
      void this.refreshDevices();
      return true;
    } catch (err) {
      this.teardown();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.setState({
          status: 'denied',
          message: 'Microphone access was blocked. Allow it in the browser’s site settings, then try again.',
        });
      } else if (name === 'NotFoundError') {
        this.setState({ status: 'error', message: 'No microphone was found.' });
      } else {
        this.setState({ status: 'error', message: err instanceof Error ? err.message : 'Could not start the microphone.' });
      }
      return false;
    }
  }

  stop() {
    this.teardown();
    this.setState({ status: 'idle', message: null, source: null, deviceLabel: null });
  }

  /**
   * Test source: the same analysis chain, fed by synthesised plucks instead of the microphone.
   * Used for checking the app end to end without a guitar (open the app with ?debug).
   */
  async startSynth(): Promise<void> {
    this.teardown();
    const ctx = new AudioContext();
    await ctx.resume();
    this.ctx = ctx;
    const bus = ctx.createGain();
    this.synthBus = bus;
    this.attach(ctx, bus);
    this.setState({ status: 'running', message: null, source: 'synth', deviceLabel: 'Test tones' });
  }

  private synthBus: GainNode | null = null;

  /** Plays a plucked-string-like tone into the analysis chain (synth source only). */
  pluck(midi: number, seconds = 0.9, audible = false) {
    const ctx = this.ctx;
    const bus = this.synthBus;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.25, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    env.connect(bus);
    if (audible) env.connect(ctx.destination);
    // A weak fundamental with strong overtones, like a wound string through a small microphone.
    [0.35, 1, 0.6, 0.35, 0.2].forEach((amp, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = midiToFreq(midi) * (i + 1);
      gain.gain.value = amp * 0.4;
      osc.connect(gain).connect(env);
      osc.start(now);
      osc.stop(now + seconds + 0.05);
    });
  }

  private attach(ctx: AudioContext, source: AudioNode) {
    const size = windowSizeFor(ctx.sampleRate);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = size;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    this.analyser = analyser;
    this.analyzer = new PitchAnalyzer(size, ctx.sampleRate, GATES[this.sensitivity]);
    this.buf = new Float32Array(size);
    this.tracker.reset();
    this.timer = setInterval(() => this.step(), FRAME_INTERVAL_MS);
  }

  private step() {
    if (!this.analyser || !this.analyzer || !this.buf) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const frame = this.analyzer.analyze(this.buf, performance.now());
    this.lastFrame = frame;
    this.frameListeners.forEach((fn) => fn(frame));
    for (const event of this.tracker.push(frame)) this.noteListeners.forEach((fn) => fn(event));
  }

  private async refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all
        .filter((d) => d.kind === 'audioinput' && d.deviceId)
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
      this.setState({ devices });
    } catch {
      // Device list is a convenience; ignore failures.
    }
  }

  private teardown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.analyzer = null;
    this.synthBus = null;
    this.lastFrame = null;
  }

  private setState(patch: Partial<MicState>) {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((fn) => fn());
  }
}

export const mic = new MicEngine();
