import { MASTERY_LABELS, MODE_TITLES, levelInfo, pointsOf, practiceMs } from '../game/progress';
import type { RoundSummary } from './Game';
import { hrefOf } from './route';
import { useProgress } from './hooks';
import { MASTERY_COLORS, MasteryMap, PositionGrid } from './MasteryMap';

interface Props {
  summary: RoundSummary;
  onAgain: () => void;
}

export function Summary({ summary, onAgain }: Props) {
  const data = useProgress();
  const { results } = summary;
  const firstTries = results.filter((r) => r.firstTry);
  const accuracy = results.length ? Math.round((firstTries.length / results.length) * 100) : 0;
  const avg = firstTries.length ? firstTries.reduce((sum, r) => sum + r.ms, 0) / firstTries.length / 1000 : null;
  // Points are worked out from practice time and status, so a round's share is the difference.
  const points = pointsOf(data);
  const gained = points.total - summary.before.points.total;
  const knowledge = points.knowledge - summary.before.points.knowledge;
  const roundSeconds = Math.round((practiceMs(data) - summary.before.ms) / 1000);
  const level = levelInfo(points.total);
  const levelBefore = levelInfo(summary.before.points.total).level;
  const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

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
    <main className="page-body">
      <header className="page-head">
        <h1>Round complete</h1>
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
          <span className="stat-label">Points</span>
          <b>{signed(gained)}</b>
          <span className={level.level > levelBefore ? 'good small' : 'muted small'} title="One point per minute practised, one per Solid item, two per Instant item">
            {level.level > levelBefore ? `Level ${level.level} reached · ` : level.level < levelBefore ? `Back to level ${level.level} · ` : ''}
            {Math.floor(roundSeconds / 60)}:{String(roundSeconds % 60).padStart(2, '0')} min practised, {signed(knowledge)} for status
          </span>
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
        <a className="button ghost" href={hrefOf('practice')}>
          Back to practice
        </a>
        <a className="button ghost" href={hrefOf('progress')}>
          See progress
        </a>
      </div>
    </main>
  );
}
