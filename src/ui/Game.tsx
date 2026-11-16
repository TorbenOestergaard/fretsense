import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { mic } from '../audio/mic';
import { voice } from '../audio/voice';
import { pointsOf, practiceMs, progressStore, type MasteryLevel, type Mode, type Points } from '../game/progress';
import { Scheduler, type Question } from '../game/scheduler';
import { REVEAL_AFTER_MS, Session, type AnswerResult, type Hint } from '../game/session';
import { introWords, promptWords, repeatWords, revealWords, summaryWords, type SpokenPrompt } from '../game/spoken';
import { POSITION_MAX_FRET, STRING_NAMES, STRING_NUMBERS, midiName, pcName, pcOf, type ScalePosition } from '../music/theory';
import { Fretboard, type CellStyle } from './Fretboard';
import { Brand } from './Brand';
import { levelToUnit, useFrame, useMicState } from './hooks';
import { ACCENT } from './MasteryMap';

export interface RoundSummary {
  mode: Mode;
  context: string | null;
  results: AnswerResult[];
  /** Points and practice time when the round started, to show what the round added. */
  before: { points: Points; ms: number };
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
  const totals = useRef({ changes: [] as RoundSummary['changes'] });
  const micState = useMicState();

  const [session] = useState(() => {
    const settings = progressStore.get().settings;
    const scheduler = new Scheduler(settings, (key) => progressStore.get().stats[settings.mode][key]);
    const onResult = (result: AnswerResult) => {
      const q = result.question;
      const outcome = progressStore.record(
        { mode: q.mode, key: q.key, pc: q.pc, string: result.string, fret: result.fret, firstTry: result.firstTry, ms: result.ms, spoken: result.spoken },
        Date.now(),
      );
      const existing = totals.current.changes.find((c) => c.key === q.key);
      if (existing) existing.after = outcome.after;
      else totals.current.changes.push({ key: q.key, label: q.label, before: outcome.before, after: outcome.after });
    };
    const start = progressStore.get();
    return {
      // Gated: each question waits for its clock to be started, by the spoken prompt or at once.
      run: new Session(scheduler, scheduler.roundLength(), performance.now(), onResult, true),
      scheduler,
      mode: settings.mode,
      help: settings.positionHelp,
      before: { points: pointsOf(start), ms: practiceMs(start) },
    };
  });
  const run = session.run;
  const scale = session.scheduler.scale;

  const voiceState = useSyncExternalStore(voice.subscribe, voice.getState);
  /** The stage (question and phase) that was last announced, so each is announced once. */
  const announced = useRef<string | null>(null);
  const spoken = useRef<{ index: number; prompt: SpokenPrompt | null } | null>(null);
  const previousQuestion = useRef<Question | null>(null);
  const lastHint = useRef<Hint | null>(null);

  const toggleVoice = () => {
    voice.setPrefs({ on: !voice.getState().on });
    // Switched off while a prompt was being spoken: the question must not wait for it.
    if (!voice.active) run.startClock(performance.now());
    rerender();
  };

  /** Says the current prompt again. The clock keeps running. */
  const repeat = () => {
    if (!voice.active || run.waiting) return;
    const q = run.question;
    if (run.phase === 'intro') voice.say([introWords(q, run.index === 0)]);
    else if (run.phase === 'asking') voice.say(repeatWords(q, spoken.current?.index === run.index ? spoken.current.prompt : null));
    else if (run.phase === 'revealed') voice.say([revealWords(q)]);
  };

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
      else if (e.code === 'KeyV' && !e.metaKey && !e.ctrlKey && !e.altKey) toggleVoice();
      else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey) repeat();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offNote();
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      // Leaving mid-round: stop talking. (The round summary is allowed to finish.)
      if (run.phase !== 'done') voice.cancel();
      announced.current = null;
    };
    // toggleVoice and repeat only read refs and the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, onQuit]);

  // Announce each new stage of the round once: speak the prompt and start the clock with the
  // word to act on, or start it at once when nothing is spoken.
  useEffect(() => {
    const speak = voice.active;
    if (run.hint && run.hint !== lastHint.current && run.hint.kind !== 'octave' && speak) voice.thud();
    lastHint.current = run.hint;

    const stage = `${run.index}:${run.phase}`;
    if (announced.current === stage) return;
    announced.current = stage;
    const q = run.question;
    if (run.phase === 'intro') {
      if (speak) voice.say([introWords(q, run.index === 0)]);
    } else if (run.phase === 'asking') {
      if (spoken.current?.index !== run.index) {
        spoken.current = { index: run.index, prompt: promptWords(q, previousQuestion.current) };
        previousQuestion.current = q;
      }
      const prompt = spoken.current.prompt;
      if (!run.waiting) return;
      if (speak && prompt) {
        voice.say([...prompt.context, prompt.target], {
          onTarget: (heard) => {
            run.startClock(performance.now(), heard);
            rerender();
          },
        });
      } else {
        run.startClock(performance.now());
        rerender();
      }
    } else if (run.phase === 'revealed') {
      if (speak) voice.say([revealWords(q)]);
    } else if (run.phase === 'feedback') {
      voice.cancel();
      if (speak) voice.tick();
    }
  });

  const finished = run.phase === 'done';
  useEffect(() => {
    if (!finished) return;
    const firstTries = run.results.filter((r) => r.firstTry);
    const avgMs = firstTries.length ? firstTries.reduce((sum, r) => sum + r.ms, 0) / firstTries.length : 0;
    if (voice.active) voice.say([summaryWords(run.results.length, firstTries.length, avgMs)]);
    progressStore.addSession({
      t: Date.now(),
      mode: session.mode,
      key: scale?.name,
      n: run.results.length,
      correct: firstTries.length,
      avgMs,
      xp: 0, // unused since points replaced XP; the field stays for older builds
    });
    onDone({
      mode: session.mode,
      context: scale?.name ?? null,
      results: run.results,
      before: session.before,
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
    fill: ok ? '#4fb477' : ACCENT.fill,
    text: ok ? '#04170b' : ACCENT.text,
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
      if (intro) return root ? { shape: 'dot', ...ACCENT, label: '1' } : null;
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
    <main className="page-body game">
      <header className="game-bar">
        {/* Leaving by the logo is the same as Quit: answers so far are already recorded. */}
        <Brand onQuit={onQuit} />
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
        <button
          className="ghost"
          onClick={(e) => {
            // Keep the focus off the button, so Space goes on showing the answer.
            e.currentTarget.blur();
            toggleVoice();
          }}
          disabled={!voiceState.available}
          aria-pressed={voiceState.on && voiceState.available}
          title={voiceState.available ? `Spoken prompts (V). Voice: ${voiceState.voiceName}` : 'No English voice is installed on this computer'}
        >
          Voice {voiceState.on && voiceState.available ? 'on' : 'off'}
        </button>
        <div className={run.combo >= 5 ? 'pill pill-hot' : 'pill'}>Combo {run.combo}</div>
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
            style={{ animationDuration: `${REVEAL_AFTER_MS}ms`, animationPlayState: run.phase === 'asking' && !run.waiting ? 'running' : 'paused' }}
          />
        </div>
        <p className="feedback" role="status">
          <Feedback run={run} shortName={shortName} />
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
        <span className="muted small">{intro ? 'Space starts without playing the root' : 'Space shows the answer'}
          {voiceState.on && voiceState.available ? ' · R says it again' : ''} · V voice · Esc quits</span>
      </footer>
    </main>
  );
}

function Feedback({ run, shortName }: { run: Session; shortName: string }) {
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
          {inBox ? `${q.noteName}` : where} · {(r.ms / 1000).toFixed(1)} s
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
