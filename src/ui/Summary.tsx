import { MASTERY_LABELS, MODE_TITLES, levelInfo } from '../game/progress';
import type { RoundSummary } from './Game';
import { Brand } from './Brand';
import { useProgress } from './hooks';
import { MASTERY_COLORS, MasteryMap, PositionGrid } from './MasteryMap';

interface Props {
  summary: RoundSummary;
  onAgain: () => void;
  onHome: () => void;
}

export function Summary({ summary, onAgain, onHome }: Props) {
  const data = useProgress();
  const { results } = summary;
  const firstTries = results.filter((r) => r.firstTry);
  const accuracy = results.length ? Math.round((firstTries.length / results.length) * 100) : 0;
  const avg = firstTries.length ? firstTries.reduce((sum, r) => sum + r.ms, 0) / firstTries.length / 1000 : null;
  const level = levelInfo(data.xp);
  const leveledUp = levelInfo(data.xp - summary.xp).level < level.level;

  const movedUp = summary.changes.filter((c) => c.after > c.before && c.before > 0);
  const fresh = summary.changes.filter((c) => c.before === 0).length;

  // The notes to think about before the next round: missed ones first, then the slowest.
  const worst = new Map<string, { label: string; cost: number; missed: boolean }>();
  for (const r of results) {
    const key = r.question.key;
    const cost = r.firstTry ? r.ms : 100000 + r.ms;
    const prev = worst.get(key);
    if (!prev || cost > prev.cost) {
      worst.set(key, { label: r.question.label, cost, missed: !r.firstTry });
    }
  }
  const needsWork = [...worst.values()]
    .filter((w) => w.missed || w.cost > 4000)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  return (
    <main className="page">
      <header className="topbar">
        <Brand onHome={onHome} title="Round complete" />
        <span className="muted">
          {MODE_TITLES[summary.mode]}
          {summary.context ? ` · ${summary.context}` : ''}
        </span>
      </header>

      <section className="tiles">
        <div className="tile">
          <span className="stat-label">First try</span>
          <b>{accuracy}%</b>
          <span className="muted small">
            {firstTries.length} of {results.length}
          </span>
        </div>
        <div className="tile">
          <span className="stat-label">Average time</span>
          <b>{avg === null ? '–' : `${avg.toFixed(1)} s`}</b>
          <span className="muted small">correct answers</span>
        </div>
        <div className="tile">
          <span className="stat-label">Best combo</span>
          <b>{summary.bestCombo}</b>
          <span className="muted small">in a row</span>
        </div>
        <div className="tile">
          <span className="stat-label">Earned</span>
          <b>+{summary.xp} XP</b>
          <span className={leveledUp ? 'good small' : 'muted small'}>{leveledUp ? `Level ${level.level} reached` : `Level ${level.level}`}</span>
        </div>
      </section>

      {(movedUp.length > 0 || fresh > 0 || needsWork.length > 0) && (
        <section className="panel two-col">
          <div>
            <h2>Moved up</h2>
            {movedUp.length === 0 && fresh === 0 && <p className="muted">Nothing changed level this round.</p>}
            <ul className="plain">
              {movedUp.map((c) => (
                <li key={c.key}>
                  {c.label}{' '}
                  <span className="muted">
                    <span style={{ color: MASTERY_COLORS[c.before].ink }}>{MASTERY_LABELS[c.before]}</span> →{' '}
                    <b style={{ color: MASTERY_COLORS[c.after].ink }}>{MASTERY_LABELS[c.after]}</b>
                  </span>
                </li>
              ))}
              {fresh > 0 && (
                <li className="muted">
                  {fresh} practised for the first time in this exercise
                </li>
              )}
            </ul>
          </div>
          <div>
            <h2>Needs work</h2>
            {needsWork.length === 0 && <p className="muted">Nothing slow or missed. These will come up less often.</p>}
            <ul className="plain">
              {needsWork.map((w) => (
                <li key={w.label}>
                  {w.label} <span className="muted">{w.missed ? 'missed' : `${(w.cost / 1000).toFixed(1)} s`}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="panel">
        {summary.mode === 'positions' ? <PositionGrid data={data} scaleId={data.settings.scaleId} /> : <MasteryMap data={data} mode={summary.mode} />}
      </section>

      <div className="start-row">
        <button className="primary" onClick={onAgain} autoFocus>
          Another round
        </button>
        <button className="ghost" onClick={onHome}>
          Back to overview
        </button>
      </div>
    </main>
  );
}
