import { DAILY_GOAL, dayKey, levelInfo, progressStore, streakOf, type Mode, type PositionHelp } from '../game/progress';
import { enabledPositions, positionRoundSize } from '../game/scheduler';
import { SCALES, SCALE_IDS, STRING_NAMES, buildScale, parseNote, positionsOf } from '../music/theory';
import { positionFrets } from './Game';
import { syncStatus } from './Account';
import { Brand } from './Brand';
import { useMicState, useProgress, useSync } from './hooks';
import { MasteryMap, PositionGrid } from './MasteryMap';

const MODES: { id: Mode; title: string; blurb: string }[] = [
  { id: 'notes', title: 'Note finder', blurb: '“Play C on the G string.” Random notes, weighted toward the ones you are slow on.' },
  { id: 'positions', title: 'Scale positions', blurb: '“G major, position 2: play the 5th.” Every degree of one box in random order, then the next box, round and round.' },
  { id: 'sweep', title: 'String sweep', blurb: 'One note on every string, low to high. The classic “find every C” drill.' },
];

const HELP: { id: PositionHelp; label: string }[] = [
  { id: 'shape', label: 'Scale shape' },
  { id: 'roots', label: 'Roots only' },
  { id: 'none', label: 'Nothing' },
];

interface Props {
  onStart: () => void;
  onMic: () => void;
  onProgress: () => void;
  onAccount: () => void;
}

export function Home({ onStart, onMic, onProgress, onAccount }: Props) {
  const syncState = useSync();
  const status = syncStatus(syncState, Date.now());
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
  const inPositions = settings.mode === 'positions';
  const boxes = positionsOf(scale);
  const selectedBoxes = enabledPositions(settings).length;
  const positionRound = positionRoundSize(settings.length, scale.notes.length, selectedBoxes);
  const togglePosition = (p: number) => {
    const positions = settings.positions.map((on, i) => (i === p ? !on : on));
    if (positions.some(Boolean)) set({ positions });
  };

  const toggleString = (s: number) => {
    const strings = settings.strings.map((on, i) => (i === s ? !on : on));
    if (strings.some(Boolean)) set({ strings });
  };

  return (
    <main className="page">
      <header className="topbar">
        <Brand onHome={() => window.scrollTo({ top: 0 })} />
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
          <button className="ghost" onClick={onProgress} title="Progress and timing">
            Progress
          </button>
          <div className="stat account">
            <button className="link" onClick={onAccount}>
              {syncState.user ? 'Account' : syncState.available ? 'Sign in to sync' : 'About your data'}
            </button>
            <span className={status.tone === 'off' ? 'warn small' : 'muted small'} role="status" title={status.text}>
              {syncState.user ? status.text : 'Stored in this browser only'}
            </span>
          </div>
        </div>
      </header>

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
          {inPositions ? (
            <>
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
              <div className="option">
                <span className="option-label">Positions</span>
                <div className="chips">
                  {boxes.map((box) => (
                    <button
                      key={box.index}
                      className={settings.positions[box.index] ? 'chip chip-on' : 'chip'}
                      aria-pressed={settings.positions[box.index]}
                      onClick={() => togglePosition(box.index)}
                      title={box.shape}
                    >
                      {box.index + 1} <span className="chip-sub">{positionFrets(box)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="option">
                <span className="option-label">Show on the board while asking</span>
                <div className="chips">
                  {HELP.map((h) => (
                    <button
                      key={h.id}
                      className={settings.positionHelp === h.id ? 'chip chip-on' : 'chip'}
                      aria-pressed={settings.positionHelp === h.id}
                      onClick={() => set({ positionHelp: h.id })}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="option">
                <span className="option-label">Round length</span>
                <div className="chips">
                  {[10, 20, 40].map((n) => (
                    <button key={n} className={settings.length === n ? 'chip chip-on' : 'chip'} aria-pressed={settings.length === n} onClick={() => set({ length: n })}>
                      {n} notes
                    </button>
                  ))}
                </div>
                <p className="muted small">
                  {positionRound.questions} questions: {positionRound.passes} {positionRound.passes === 1 ? 'pass' : 'passes'} of {scale.notes.length} degrees
                  {positionRound.passes > selectedBoxes
                    ? `, going round the selected ${selectedBoxes === 1 ? 'box' : 'boxes'} again in a new order.`
                    : selectedBoxes > 1
                      ? ', every selected box once.'
                      : '.'}
                </p>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
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

      <section className="panel">
        {settings.mode === 'positions' ? <PositionGrid data={data} scaleId={settings.scaleId} /> : <MasteryMap data={data} mode={settings.mode} />}
        <p className="muted small panel-foot">Each exercise keeps its own status. This is the one for the exercise selected above.</p>
      </section>

      <footer className="app-foot muted small">
        Fretsense {__APP_VERSION__}
        {__APP_COMMIT__ && ` · ${__APP_COMMIT__}`}
      </footer>
    </main>
  );
}
