import { mic } from '../audio/mic';
import { progressStore, type Sensitivity } from '../game/progress';
import { STRING_NAMES, STRING_OPEN_MIDI, midiName } from '../music/theory';
import { levelToUnit, useFrame, useMicState, useProgress } from './hooks';

const DEBUG = new URLSearchParams(location.search).has('debug');

export function MicCheck({ onBack }: { onBack: () => void }) {
  const state = useMicState();
  const frame = useFrame();
  const { settings } = useProgress();
  const running = state.status === 'running';
  const level = frame ? levelToUnit(frame.rms) : 0;
  const floor = frame ? levelToUnit(frame.noiseFloor) : 0;
  const midi = frame?.midi ?? null;
  const cents = frame?.cents ?? 0;
  const inTune = midi !== null && Math.abs(cents) <= 8;

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Mic check and tuner
        </div>
        <button className="ghost" onClick={onBack}>
          Back
        </button>
      </header>

      <section className="panel tuner">
        <div className={inTune ? 'tuner-note good' : 'tuner-note'}>{midi !== null ? midiName(midi) : '–'}</div>
        <div className="cents" aria-label={midi !== null ? `${Math.round(cents)} cents` : 'No note'}>
          <div className="cents-mid" />
          {midi !== null && <div className={inTune ? 'cents-needle good-bg' : 'cents-needle'} style={{ left: `${50 + cents}%` }} />}
        </div>
        <p className="muted small">
          {midi === null
            ? running
              ? 'Play a single note and let it ring.'
              : 'Start the microphone to begin.'
            : inTune
              ? 'In tune'
              : `${Math.abs(Math.round(cents))} cents ${cents > 0 ? 'sharp' : 'flat'}`}
        </p>
        <div className="open-strings">
          {STRING_OPEN_MIDI.map((open, s) => (
            <span key={s} className={midi === open ? (inTune ? 'chip chip-static chip-good' : 'chip chip-static chip-on') : 'chip chip-static'}>
              {STRING_NAMES[s]} <b>{midiName(open)}</b>
            </span>
          ))}
        </div>

        <div className="level-row">
          <span className="muted small">Input level</span>
          <div className="meter meter-wide">
            <div style={{ width: `${level * 100}%` }} />
            <i style={{ left: `${floor * 100}%` }} title="Background noise level" />
          </div>
        </div>

        <div className="start-row">
          {running ? (
            <button className="ghost" onClick={() => mic.stop()}>
              Stop microphone
            </button>
          ) : (
            <button className="primary" onClick={() => void mic.start(settings.deviceId)}>
              {state.status === 'starting' ? 'Starting…' : 'Start microphone'}
            </button>
          )}
          {state.devices.length > 1 && (
            <select
              aria-label="Microphone"
              value={settings.deviceId ?? ''}
              onChange={(e) => {
                const deviceId = e.target.value || null;
                progressStore.updateSettings({ deviceId });
                mic.stop();
                void mic.start(deviceId);
              }}
            >
              <option value="">Default microphone</option>
              {state.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <label className="row small">
            <span className="muted">Sensitivity</span>
            <select
              value={settings.sensitivity}
              onChange={(e) => {
                const sensitivity = e.target.value as Sensitivity;
                progressStore.updateSettings({ sensitivity });
                mic.setSensitivity(sensitivity);
              }}
            >
              <option value="low">Low (noisy room)</option>
              <option value="normal">Normal</option>
              <option value="high">High (quiet guitar)</option>
            </select>
          </label>
          {DEBUG && (
            <button className="ghost" onClick={() => void mic.startSynth()}>
              Use test tones
            </button>
          )}
        </div>
        {state.message && <p className="warn">{state.message}</p>}
        {running && state.deviceLabel && <p className="muted small">Listening on {state.deviceLabel}</p>}
      </section>

      <section className="panel">
        <h2>Getting a clean signal from an unplugged electric</h2>
        <ul className="tips">
          <li>Tune first. A note more than a quarter-tone off is heard as its neighbour.</li>
          <li>Sit with the guitar body 20–40 cm from the laptop, in a quiet room. Each of the six open strings should show up above.</li>
          <li>Play one note at a time and let it ring for a moment. Mute the other strings with your fretting hand.</li>
          <li>If quiet notes are not picked up, set sensitivity to High. If the app reacts to room noise, set it to Low.</li>
          <li>A small practice amp at low volume next to the laptop also works, and gives a stronger signal.</li>
        </ul>
      </section>
    </main>
  );
}
