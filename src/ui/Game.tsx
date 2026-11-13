import { useEffect, useReducer, useRef, useState } from 'react';
import { mic } from '../audio/mic';
import { progressStore, type MasteryLevel, type Mode } from '../game/progress';
import { Scheduler } from '../game/scheduler';
import { REVEAL_AFTER_MS, Session, type AnswerResult } from '../game/session';
import { POSITION_MAX_FRET, STRING_NAMES, STRING_NUMBERS, midiName, pcName, pcOf, type ScalePosition } from '../music/theory';
import { Fretboard, type CellStyle } from './Fretboard';
import { levelToUnit, useFrame, useMicState } from './hooks';

export interface RoundSummary {
  mode: Mode;
  context: string | null;
  results: AnswerResult[];
  xp: number;
  bestCombo: number;
  changes: { key: string; label: string; before: MasteryLevel; after: MasteryLevel }[];
}

interface Props {
  onDone: (summary: RoundSummary) => void;
  onQuit: () => void;
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const fretName = (f: number) => (f === 0 ? 'open' : `fret ${f}`);
const whereText = (cells: { string: number; fret: number }[], withString: boolean) =>
  cells.map((c) => (withString ? `${STRING_NAMES[c.string]} string ${fretName(c.fret)}` : fretName(c.fret))).join(withString ? ', ' : ' or ');
export const positionTitle = (p: ScalePosition) => `Position ${p.index + 1}`;
export const positionFrets = (p: ScalePosition) => (p.lo === 0 ? `open to fret ${p.hi}` : `frets ${p.lo}–${p.hi}`);

export function Game({ onDone, onQuit }: Props) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const totals = useRef({ xp: 0, lastXp: 0, changes: [] as RoundSummary['changes'] });
  const micState = useMicState();

  const [session] = useState(() => {
    const settings = progressStore.get().settings;
    const scheduler = new Scheduler(settings, (key) => progressStore.get().stats[settings.mode][key]);
    const onResult = (result: AnswerResult) => {
      const q = result.question;
      const outcome = progressStore.record(
        { mode: q.mode, key: q.key, pc: q.pc, string: result.string, fret: result.fret, firstTry: result.firstTry, ms: result.ms, combo: result.combo },
        Date.now(),
      );
      totals.current.xp += outcome.xp;
      totals.current.lastXp = outcome.xp;
      const existing = totals.current.changes.find((c) => c.key === q.key);
      if (existing) existing.after = outcome.after;
      else totals.current.changes.push({ key: q.key, label: q.label, before: outcome.before, after: outcome.after });
    };
    return { run: new Session(scheduler, scheduler.roundLength(), performance.now(), onResult), scheduler, mode: settings.mode, help: settings.positionHelp };
  });
  const run = session.run;
  const scale = session.scheduler.scale;

  useEffect(() => {
    const offNote = mic.onNote((event) => {
      if (event.type === 'on') run.noteOn(event.midi, event.t);
      else run.noteHeld(event.midi, event.t);
      rerender();
    });
    const timer = setInterval(() => {
      if (run.tick(performance.now())) rerender();
    }, 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        run.skip(performance.now());
        rerender();
      } else if (e.code === 'Escape') onQuit();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offNote();
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [run, onQuit]);

  const finished = run.phase === 'done';
  useEffect(() => {
    if (!finished) return;
    const firstTries = run.results.filter((r) => r.firstTry);
    const avgMs = firstTries.length ? firstTries.reduce((sum, r) => sum + r.ms, 0) / firstTries.length : 0;
    progressStore.addSession({
      t: Date.now(),
      mode: session.mode,
      key: scale?.name,
      n: run.results.length,
      correct: firstTries.length,
      avgMs,
      xp: totals.current.xp,
    });
    onDone({
      mode: session.mode,
      context: scale?.name ?? null,
      results: run.results,
      xp: totals.current.xp,
      bestCombo: run.bestCombo,
      changes: totals.current.changes,
    });
    // Runs once, when the round ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (finished) return null;

  const q = run.question;
  const position = q.position;
  const intro = run.phase === 'intro';
  const showAnswer = run.phase === 'revealed' || run.phase === 'feedback';
  const shortName = scale ? q.noteName : pcName(q.pc, 'sharp');
  const ok = run.phase === 'feedback' && !!run.lastResult?.firstTry;
  const answerStyle = (label: string): CellStyle => ({
    shape: 'dot',
    fill: ok ? '#4fb477' : '#f2c94c',
    text: ok ? '#04170b' : '#2b2305',
    label,
  });
  const quiet = (label: string | undefined, root: boolean): CellStyle => ({
    shape: 'dot',
    fill: '#2b303b',
    text: '#aeb5c4',
    label,
    stroke: root ? '#8a93a6' : undefined,
    opacity: 0.95,
  });

  const cell = (s: number, f: number): CellStyle | null => {
    if (position) {
      const here = position.cells.find((c) => c.string === s && c.fret === f);
      if (!here) return null;
      const root = here.degree === '1';
      if (showAnswer) return here.degree === q.degree ? answerStyle(here.degree) : quiet(here.degree, root);
      if (intro) return root ? { shape: 'dot', fill: '#f2c94c', text: '#2b2305', label: '1' } : null;
      if (session.help === 'shape') return quiet(root ? '1' : undefined, root);
      if (session.help === 'roots') return root ? quiet('1', true) : null;
      return null;
    }
    if (!showAnswer || !q.cells.some((c) => c.string === s && c.fret === f)) return null;
    return answerStyle(shortName);
  };

  let lead: string;
  if (position) lead = `${q.context} · ${positionTitle(position).toLowerCase()} of 5 (${position.shape}) · ${positionFrets(position)}`;
  else if (session.mode === 'sweep') lead = `Every ${q.noteName}, low to high. Play`;
  else lead = 'Play';

  return (
    <main className="page game">
      <header className="game-bar">
        <button className="ghost" onClick={onQuit}>
          Quit
        </button>
        <div className="game-progress" aria-label={`Question ${run.index + 1} of ${run.total}`}>
          <div className="bar">
            <div style={{ width: `${((run.index + (run.phase === 'feedback' ? 1 : 0)) / run.total) * 100}%` }} />
          </div>
          <span>
            {Math.min(run.index + 1, run.total)} / {run.total}
          </span>
        </div>
        <div className={run.combo >= 5 ? 'pill pill-hot' : 'pill'}>Combo {run.combo}</div>
        <div className="pill">{totals.current.xp} XP</div>
      </header>

      <section className={`prompt prompt-${run.phase}${run.lastResult?.firstTry && run.phase === 'feedback' ? ' prompt-ok' : ''}`}>
        <p className="prompt-lead">{lead}</p>
        <p className={intro ? 'prompt-note prompt-note-intro' : 'prompt-note'} key={`${run.index}${intro ? 'i' : ''}`}>
          {intro && position ? positionTitle(position) : q.prompt}
        </p>
        <p className="prompt-string">
          {position ? (
            intro ? (
              <>
                Play the <strong>root</strong> inside the box to begin
              </>
            ) : (
              <>anywhere in the box</>
            )
          ) : (
            <>
              on the <strong>{q.stringName}</strong> string{' '}
              <span className="muted">({ordinal(STRING_NUMBERS[q.string ?? 0])} string)</span>
            </>
          )}
        </p>
        <div className="countdown" aria-hidden="true">
          <div
            key={`${run.index}${intro ? 'i' : ''}`}
            style={{ animationDuration: `${REVEAL_AFTER_MS}ms`, animationPlayState: run.phase === 'asking' ? 'running' : 'paused' }}
          />
        </div>
        <p className="feedback" role="status">
          <Feedback run={run} xp={totals.current.lastXp} shortName={shortName} />
        </p>
      </section>

      <section className="panel board-panel">
        <Fretboard
          label={position ? `Fretboard, ${positionFrets(position)} highlighted` : `Fretboard, ${q.stringName} string highlighted`}
          highlightString={q.string}
          maxFret={position ? POSITION_MAX_FRET : undefined}
          band={position ? { lo: position.lo, hi: position.hi } : null}
          cell={cell}
          onCellClick={(s, f) => {
            run.click(s, f, performance.now());
            rerender();
          }}
        />
      </section>

      <footer className="game-foot">
        <Hearing />
        {micState.status !== 'running' && (
          <span className="warn">
            Microphone is off. Click a fret to answer, or{' '}
            <button className="link" onClick={() => void mic.start(progressStore.get().settings.deviceId)}>
              turn it on
            </button>
            .
          </span>
        )}
        <span className="muted small">{intro ? 'Space starts without playing the root' : 'Space shows the answer'} · Esc quits</span>
      </footer>
    </main>
  );
}

function Feedback({ run, xp, shortName }: { run: Session; xp: number; shortName: string }) {
  const q = run.question;
  const inBox = !!q.position;
  const where = whereText(q.cells, inBox);
  const degreeNote = q.context ? `The ${q.prompt} of ${q.context} is ${q.noteName}. ` : '';
  if (run.phase === 'intro') {
    return <span className="muted">Not timed. The roots are marked on the board.</span>;
  }
  if (run.phase === 'feedback' && run.lastResult) {
    const r = run.lastResult;
    if (r.firstTry) {
      return (
        <span className="good">
          {inBox ? `${q.noteName}` : where} · {(r.ms / 1000).toFixed(1)} s · +{xp} XP
        </span>
      );
    }
    return (
      <span>
        {degreeNote}
        {inBox ? `In this box: ${where}.` : `${shortName} on the ${q.stringName} string is ${where}.`}
      </span>
    );
  }
  if (run.phase === 'revealed') {
    return (
      <span>
        {degreeNote}
        {inBox ? 'It is marked on the board.' : `It is ${where}.`} Play it to continue.
      </span>
    );
  }
  const hint = run.hint;
  if (!hint) return <span className="muted">Listening…</span>;
  if (hint.kind === 'wrongString') return <span className="bad">That is the {STRING_NAMES[hint.string]} string.</span>;
  if (hint.kind === 'octave') {
    return (
      <span className="warn-text">
        {inBox
          ? `That is ${q.noteName}, but outside this box. Stay in ${positionFrets(q.position!)}.`
          : `That is ${pcName(pcOf(hint.midi), 'sharp')}, but in a different octave than the ${q.stringName} string has it. Check which string you are on.`}
      </span>
    );
  }
  return <span className="bad">That was {midiName(hint.midi)}. Keep looking.</span>;
}

/** Small live readout so you can see the app is hearing the guitar. */
function Hearing() {
  const frame = useFrame();
  const level = frame ? levelToUnit(frame.rms) : 0;
  return (
    <div className="hearing" aria-label="What the microphone hears">
      <span className="muted small">Hearing</span>
      <b>{frame?.midi != null ? midiName(frame.midi) : '–'}</b>
      <div className="meter">
        <div style={{ width: `${level * 100}%` }} />
      </div>
    </div>
  );
}
