import { DAILY_GOAL, dayKey, levelInfo, progressStore, streakOf, type Mode, type ProgressData } from '../game/progress';
import { SCALES, SCALE_IDS, STRING_NAMES, buildScale, degreeOrdinal, parseNote } from '../music/theory';
import { useMicState, useProgress } from './hooks';
import { MasteryMap } from './MasteryMap';

const MODES: { id: Mode; title: string; blurb: string }[] = [
  { id: 'notes', title: 'Note finder', blurb: '“Play C on the G string.” Random notes, weighted toward the ones you are slow on.' },
  { id: 'degrees', title: 'Scale degrees', blurb: '“In G major, play the 3rd on the D string.” Ties every note to its role in a key.' },
  { id: 'sweep', title: 'String sweep', blurb: 'One note on every string, low to high. The classic “find every C” drill.' },
];

interface Props {
  onStart: () => void;
  onMic: () => void;
}

export function Home({ onStart, onMic }: Props) {
  const data = useProgress();
  const micState = useMicState();
  const { settings } = data;
  const level = levelInfo(data.xp);
  const today = data.days[dayKey(Date.now())]?.correct ?? 0;
  const streak = streakOf(data.days, Date.now());
  const scaleType = SCALES[settings.scaleId];
  const tonic = scaleType.tonics.includes(settings.tonic) ? settings.tonic : scaleType.tonics[0];
  const scale = buildScale(tonic, settings.scaleId);
  const set = progressStore.updateSettings;

  const toggleString = (s: number) => {
    const strings = settings.strings.map((on, i) => (i === s ? !on : on));
    if (strings.some(Boolean)) set({ strings });
  };

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Fretsense
        </div>
        <div className="stats">
          <div className="stat" title={`${level.into} of ${level.need} XP to the next level`}>
            <span className="stat-label">Level {level.level}</span>
            <div className="bar xp">
              <div style={{ width: `${(level.into / level.need) * 100}%` }} />
            </div>
          </div>
          <div className="stat" title={`Days in a row with ${DAILY_GOAL} correct notes`}>
            <span className="stat-label">Streak</span>
            <b>{streak} {streak === 1 ? 'day' : 'days'}</b>
          </div>
          <div className="stat" title="Correct first-try notes today">
            <span className="stat-label">Today</span>
            <b className={today >= DAILY_GOAL ? 'good' : ''}>
              {Math.min(today, 999)} / {DAILY_GOAL}
            </b>
          </div>
        </div>
      </header>

      <section className="panel">
        <MasteryMap data={data} />
      </section>

      <section className="panel">
        <h2>Practice</h2>
        <div className="modes" role="radiogroup" aria-label="Practice mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={settings.mode === m.id}
              className={settings.mode === m.id ? 'mode mode-on' : 'mode'}
              onClick={() => set({ mode: m.id })}
            >
              <strong>{m.title}</strong>
              <span>{m.blurb}</span>
            </button>
          ))}
        </div>

        <div className="options">
          <div className="option">
            <span className="option-label">Strings</span>
            <div className="chips">
              {[0, 1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  className={settings.strings[s] ? 'chip chip-on' : 'chip'}
                  aria-pressed={settings.strings[s]}
                  onClick={() => toggleString(s)}
                >
                  {STRING_NAMES[s]}
                </button>
              ))}
            </div>
          </div>

          {settings.mode === 'degrees' ? (
            <div className="option">
              <span className="option-label">Key</span>
              <div className="row">
                <select value={tonic} onChange={(e) => set({ tonic: e.target.value })} aria-label="Key">
                  {scaleType.tonics.map((t) => (
                    <option key={t} value={t}>
                      {parseNote(t).display}
                    </option>
                  ))}
                </select>
                <select
                  value={settings.scaleId}
                  aria-label="Scale"
                  onChange={(e) => {
                    const scaleId = e.target.value as typeof settings.scaleId;
                    const tonics = SCALES[scaleId].tonics;
                    set({ scaleId, tonic: tonics.includes(tonic) ? tonic : tonics[0] });
                  }}
                >
                  {SCALE_IDS.map((id) => (
                    <option key={id} value={id}>
                      {SCALES[id].name}
                    </option>
                  ))}
                </select>
                <button
                  className="ghost"
                  onClick={() => set({ tonic: scaleType.tonics[Math.floor(Math.random() * scaleType.tonics.length)] })}
                >
                  Random key
                </button>
              </div>
              <p className="muted small">{scale.notes.map((n) => `${n.degree} ${n.name}`).join('   ')}</p>
            </div>
          ) : (
            <div className="option">
              <span className="option-label">Notes</span>
              <div className="chips">
                <button className={settings.naturalsOnly ? 'chip chip-on' : 'chip'} aria-pressed={settings.naturalsOnly} onClick={() => set({ naturalsOnly: true })}>
                  Naturals only
                </button>
                <button className={!settings.naturalsOnly ? 'chip chip-on' : 'chip'} aria-pressed={!settings.naturalsOnly} onClick={() => set({ naturalsOnly: false })}>
                  With sharps and flats
                </button>
              </div>
            </div>
          )}

          <div className="option">
            <span className="option-label">Round length</span>
            <div className="chips">
              {[10, 20, 40].map((n) => (
                <button key={n} className={settings.length === n ? 'chip chip-on' : 'chip'} aria-pressed={settings.length === n} onClick={() => set({ length: n })}>
                  {n} notes
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="start-row">
          <button className="primary" onClick={onStart}>
            Start round
          </button>
          <button className="ghost" onClick={onMic}>
            Mic check and tuner
          </button>
          <span className="muted small">
            {micState.status === 'running'
              ? `Listening on ${micState.deviceLabel ?? 'microphone'}`
              : 'Starting a round asks for microphone access.'}
          </span>
        </div>
        {micState.message && <p className="warn">{micState.message}</p>}
      </section>

      <Trends data={data} />
    </main>
  );
}

function Trends({ data }: { data: ProgressData }) {
  const sessions = data.sessions.slice(-20);
  const degreeOrder = ['1', '2', '♭3', '3', '4', '5', '♭6', '6', '♭7', '7'];
  const degrees = degreeOrder.filter((label) => data.degrees[label]);
  if (sessions.length === 0 && degrees.length === 0) return null;

  const times = sessions.map((s) => s.avgMs / 1000);
  const max = Math.max(...times, 1);
  const W = 600;
  const H = 90;
  const x = (i: number) => (sessions.length === 1 ? W / 2 : 8 + (i / (sessions.length - 1)) * (W - 16));
  const y = (v: number) => 8 + (1 - v / max) * (H - 16);
  const last = sessions[sessions.length - 1];

  return (
    <section className="panel">
      <h2>Trend</h2>
      {sessions.length > 0 && (
        <div className="trend">
          <div>
            <p className="muted small">Average answer time over your last {sessions.length} {sessions.length === 1 ? 'round' : 'rounds'}. Lower is better.</p>
            <p className="trend-now">
              {(last.avgMs / 1000).toFixed(1)} s <span className="muted">· {Math.round((last.correct / last.n) * 100)}% first try in the latest round</span>
            </p>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="Average answer time per round">
            <polyline points={times.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" className="spark-line" />
            {times.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3.5} className="spark-dot">
                <title>{`${v.toFixed(1)} s`}</title>
              </circle>
            ))}
          </svg>
        </div>
      )}
      {degrees.length > 0 && (
        <div className="degree-stats">
          <p className="muted small">Scale degrees: average time to find each one.</p>
          <div className="chips">
            {degrees.map((label) => {
              const stat = data.degrees[label];
              return (
                <span key={label} className="chip chip-static">
                  {degreeOrdinal(label)} <b>{(stat.ewmaMs / 1000).toFixed(1)} s</b>
                </span>
              );
            })}
          </div>
        </div>
      )}
      <button
        className="ghost danger"
        onClick={() => {
          if (confirm('Erase all progress? This cannot be undone.')) progressStore.reset();
        }}
      >
        Reset progress
      </button>
    </section>
  );
}
