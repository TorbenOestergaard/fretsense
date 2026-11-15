import { useRef, useState } from 'react';
import { bucketOf, dailySeries, eventsFor, groupBy, lastDays, parsePositionKey, type Bucket, type DayPoint, type NoteFilter } from '../game/analytics';
import { DAILY_GOAL, MODE_ORDER, MODE_TITLES, dayKey, levelInfo, pointsOf, practiceMs, progressStore, streakOf, type Mode, type ProgressData } from '../game/progress';
import { SCALES, SCALE_IDS, STRING_NAMES, degreeOrdinal, pcName, type ScaleId } from '../music/theory';
import { importProgress, looksLikeProgress, toSyncDoc } from '../sync/merge';
import { sync } from '../sync/sync';
import { useProgress } from './hooks';
import { MasteryMap, PositionGrid, type MapView } from './MasteryMap';

const secs = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`);
const shortDay = (day: string) => {
  const [, m, d] = day.split('-');
  return `${Number(d)}/${Number(m)}`;
};

const FILTERS: { id: NoteFilter; label: string }[] = [
  { id: 'all', label: 'All notes' },
  { id: 'naturals', label: 'Naturals' },
  { id: 'accidentals', label: 'Sharps and flats' },
];

export function Progress() {
  const data = useProgress();
  const [mode, setMode] = useState<Mode>(data.settings.mode);
  const [view, setView] = useState<MapView>('status');
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [scaleId, setScaleId] = useState<ScaleId>(data.settings.scaleId);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportFile = () => {
    const file = { app: 'fretsense', exported: new Date().toISOString(), ...toSyncDoc(progressStore.get()) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `fretsense-progress-${dayKey(Date.now())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupNote(`Saved ${file.events.length} answers to your downloads folder.`);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!looksLikeProgress(parsed)) throw new Error('not a backup');
      const before = progressStore.get().events.length;
      progressStore.set(importProgress(progressStore.get(), parsed, Date.now()));
      sync.requestSync(0);
      setBackupNote(`Backup merged in: ${progressStore.get().events.length - before} answers added, nothing removed.`);
    } catch {
      setBackupNote('That file is not a Fretsense backup.');
    }
  };

  const now = Date.now();
  const points = pointsOf(data);
  const level = levelInfo(points.total);
  const streak = streakOf(data.days, now);
  const today = data.days[dayKey(now)]?.correct ?? 0;
  const practised = practiceMs(data);

  const inPositions = mode === 'positions';
  const all = eventsFor(data.events, mode, inPositions ? 'all' : filter).filter(
    (e) => !inPositions || parsePositionKey(e.k).scaleId === scaleId,
  );
  const overall = bucketOf(all);

  return (
    <main className="page-body">
      <section className="tiles">
        <div className="tile">
          <span className="stat-label">Streak</span>
          <b>
            {streak} {streak === 1 ? 'day' : 'days'}
          </b>
          <span className="muted small">days with {DAILY_GOAL} correct notes</span>
        </div>
        <div className="tile">
          <span className="stat-label">Today</span>
          <b className={today >= DAILY_GOAL ? 'good' : ''}>
            {today} / {DAILY_GOAL}
          </b>
          <span className="muted small">correct first try</span>
        </div>
        <div className="tile">
          <span className="stat-label">Practised</span>
          <b>{practised >= 3600000 ? `${(practised / 3600000).toFixed(1)} h` : `${Math.floor(practised / 60000)} min`}</b>
          <span className="muted small">{data.events.length} notes answered</span>
        </div>
        <div className="tile">
          <span className="stat-label">Level {level.level}</span>
          <b>{points.total} points</b>
          <span className="muted small" title="One point per minute practised, one per Solid item and two per Instant item in every exercise">
            {points.time} time + {points.knowledge} status · {level.need - level.into} to level {level.level + 1}
          </span>
        </div>
      </section>

      <section className="panel">
        <h2>Stamina</h2>
        <p className="muted small">Correct first-try notes per day over the last two weeks, all exercises. The line is the daily goal.</p>
        <ActivityChart data={data} now={now} />
      </section>

      <section className="panel">
        <div className="tabs" role="tablist" aria-label="Exercise">
          {MODE_ORDER.map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'tab tab-on' : 'tab'} onClick={() => setMode(m)}>
              {MODE_TITLES[m]}
            </button>
          ))}
        </div>

        <div className="filters">
          <div className="chips" role="group" aria-label="Colour the map by">
            <button className={view === 'status' ? 'chip chip-on' : 'chip'} aria-pressed={view === 'status'} onClick={() => setView('status')}>
              Status
            </button>
            <button className={view === 'time' ? 'chip chip-on' : 'chip'} aria-pressed={view === 'time'} onClick={() => setView('time')}>
              Average time
            </button>
          </div>
          {inPositions ? (
            <select value={scaleId} onChange={(e) => setScaleId(e.target.value as ScaleId)} aria-label="Scale">
              {SCALE_IDS.map((id) => (
                <option key={id} value={id}>
                  {SCALES[id].name}
                </option>
              ))}
            </select>
          ) : (
            <div className="chips" role="group" aria-label="Notes included in the timing charts">
              {FILTERS.map((f) => (
                <button key={f.id} className={filter === f.id ? 'chip chip-on' : 'chip'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {inPositions ? <PositionGrid data={data} scaleId={scaleId} view={view} /> : <MasteryMap data={data} mode={mode} view={view} />}
      </section>

      {all.length === 0 ? (
        <section className="panel">
          <p className="muted">
            No answers logged for {MODE_TITLES[mode]}
            {!inPositions && filter !== 'all' ? ' with this note filter' : ''} yet. Timing per string, note, fret and day appears here after a round.
          </p>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>Over time</h2>
            <p className="muted small">
              {MODE_TITLES[mode]}, one point per practice day. Overall: {secs(overall.avgMs)} average,{' '}
              {Math.round((overall.ok / overall.n) * 100)}% first try over {overall.n} answers.
            </p>
            <div className="two-col">
              <DayChart title="Average time, first-try answers" points={dailySeries(all)} value={(p) => (p.avgMs === null ? null : p.avgMs / 1000)} format={(v) => `${v.toFixed(1)} s`} />
              <DayChart title="Right on the first try" points={dailySeries(all)} value={(p) => (p.n ? (p.ok / p.n) * 100 : null)} format={(v) => `${Math.round(v)}%`} max={100} />
            </div>
          </section>

          <section className="panel">
            <h2>Average time</h2>
            <p className="muted small">First-try answers only. Longer bars are where the time goes.</p>
            {inPositions ? (
              <div className="two-col">
                <Bars
                  title="Per position"
                  rows={[0, 1, 2, 3, 4].map((p) => ({ label: `Position ${p + 1}`, bucket: groupBy(all, (e) => parsePositionKey(e.k).position).get(p) }))}
                />
                <Bars
                  title="Per degree"
                  rows={SCALES[scaleId].degrees.map((d) => ({ label: degreeOrdinal(d.label), bucket: groupBy(all, (e) => parsePositionKey(e.k).degree).get(d.label) }))}
                />
              </div>
            ) : (
              <div className="three-col">
                <Bars
                  title="Per string"
                  rows={[5, 4, 3, 2, 1, 0].map((s) => ({ label: STRING_NAMES[s], bucket: groupBy(all, (e) => Number(e.k.split(':')[0])).get(s) }))}
                />
                <Bars
                  title="Per note"
                  rows={Array.from({ length: 12 }, (_, pc) => ({ label: pcName(pc, 'sharp'), bucket: groupBy(all, (e) => e.pc).get(pc) })).filter((r) => r.bucket)}
                />
                <Bars
                  title="Per fret"
                  rows={Array.from({ length: 13 }, (_, f) => ({ label: f === 0 ? 'open' : String(f), bucket: groupBy(all, (e) => (e.f >= 0 ? e.f : null)).get(f) })).filter((r) => r.bucket)}
                />
              </div>
            )}
          </section>
        </>
      )}

      <section className="panel">
        <h2>Backup</h2>
        <p className="muted small">
          Save all progress to a file, or merge a saved file into this browser. Works without an account, and is a way to move progress between browsers by hand.
        </p>
        <div className="start-row">
          <button onClick={exportFile}>Export to file</button>
          <button className="ghost" onClick={() => fileInput.current?.click()}>
            Import from file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {backupNote && (
            <span className="muted small" role="status">
              {backupNote}
            </span>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Reset</h2>
        <div className="start-row">
          <button
            className="ghost danger"
            onClick={() => {
              if (confirm(`Erase the ${MODE_TITLES[mode]} statistics? This cannot be undone.`)) progressStore.reset(mode);
              sync.requestSync(0);
            }}
          >
            Reset {MODE_TITLES[mode]}
          </button>
          <button
            className="ghost danger"
            onClick={() => {
              if (confirm('Erase all progress, including XP and streak? This cannot be undone.')) progressStore.reset();
              sync.requestSync(0);
            }}
          >
            Reset everything
          </button>
        </div>
      </section>
    </main>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: string; bucket: Bucket | undefined }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.bucket?.avgMs ?? 0));
  return (
    <div className="bars">
      <h3>{title}</h3>
      {rows.map(({ label, bucket }) => (
        <div
          key={label}
          className="bars-row"
          title={bucket ? `${label}: ${secs(bucket.avgMs)} average, ${bucket.ok} of ${bucket.n} right on the first try` : `${label}: not practised yet`}
        >
          <span className="bars-label">{label}</span>
          <div className="bars-track">{bucket?.avgMs != null && <div className="bars-fill" style={{ width: `${(bucket.avgMs / max) * 100}%` }} />}</div>
          <span className="bars-value">{bucket ? secs(bucket.avgMs) : '–'}</span>
        </div>
      ))}
    </div>
  );
}

interface DayChartProps {
  title: string;
  points: DayPoint[];
  value: (p: DayPoint) => number | null;
  format: (v: number) => string;
  max?: number;
}

/** A single series over practice days. Days without practice are skipped, not drawn as gaps. */
function DayChart({ title, points, value, format, max }: DayChartProps) {
  const shown = points.slice(-30).flatMap((p) => {
    const v = value(p);
    return v === null ? [] : [{ day: p.day, v, n: p.n }];
  });
  const W = 460;
  const H = 170;
  const L = 44;
  const R = 52;
  const T = 12;
  const B = 26;
  const top = max ?? Math.max(1, ...shown.map((p) => p.v)) * 1.15;
  const x = (i: number) => (shown.length === 1 ? L + (W - L - R) / 2 : L + (i / (shown.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = [0, top / 2, top];
  const last = shown[shown.length - 1];
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      {shown.length === 0 ? (
        <p className="muted small">No first-try answers yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${shown.map((p) => `${shortDay(p.day)} ${format(p.v)}`).join(', ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">
                {format(t)}
              </text>
            </g>
          ))}
          <polyline points={shown.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} className="chart-line" />
          {shown.map((p, i) => (
            <g key={p.day}>
              <circle cx={x(i)} cy={y(p.v)} r={4} className="chart-dot" />
              <circle cx={x(i)} cy={y(p.v)} r={12} className="chart-hit">
                <title>{`${shortDay(p.day)}: ${format(p.v)} over ${p.n} answers`}</title>
              </circle>
            </g>
          ))}
          <text x={x(shown.length - 1) + 9} y={y(last.v) + 4} className="chart-value">
            {format(last.v)}
          </text>
          <text x={x(0)} y={H - 6} textAnchor={shown.length === 1 ? 'middle' : 'start'} className="chart-tick">
            {shortDay(shown[0].day)}
          </text>
          {shown.length > 1 && (
            <text x={x(shown.length - 1)} y={H - 6} textAnchor="end" className="chart-tick">
              {shortDay(last.day)}
            </text>
          )}
        </svg>
      )}
    </figure>
  );
}

function ActivityChart({ data, now }: { data: ProgressData; now: number }) {
  const days = lastDays(now, 14);
  const values = days.map((day) => data.days[day]?.correct ?? 0);
  const W = 940;
  const H = 150;
  const L = 34;
  const T = 10;
  const B = 24;
  const top = Math.max(DAILY_GOAL * 1.25, ...values) * 1.05;
  const slot = (W - L) / days.length;
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="activity" role="img" aria-label={`Correct notes per day: ${days.map((d, i) => `${shortDay(d)} ${values[i]}`).join(', ')}`}>
      <line x1={L} x2={W} y1={y(0)} y2={y(0)} className="chart-grid" />
      <line x1={L} x2={W} y1={y(DAILY_GOAL)} y2={y(DAILY_GOAL)} className="chart-goal" />
      <text x={L - 6} y={y(DAILY_GOAL) + 4} textAnchor="end" className="chart-tick">
        {DAILY_GOAL}
      </text>
      <text x={L - 6} y={y(0) + 4} textAnchor="end" className="chart-tick">
        0
      </text>
      {days.map((day, i) => {
        const v = values[i];
        const bx = L + i * slot + slot * 0.22;
        const bw = slot * 0.56;
        return (
          <g key={day}>
            {v > 0 && <path d={barPath(bx, y(v), bw, y(0) - y(v))} className={v >= DAILY_GOAL ? 'activity-bar activity-met' : 'activity-bar'} />}
            {v > 0 && (
              <text x={bx + bw / 2} y={y(v) - 5} textAnchor="middle" className="chart-tick">
                {v}
              </text>
            )}
            <text x={bx + bw / 2} y={H - 6} textAnchor="middle" className="chart-tick">
              {shortDay(day)}
            </text>
            <rect x={L + i * slot} y={T} width={slot} height={H - T - B} className="chart-hit">
              <title>{`${shortDay(day)}: ${v} correct of ${data.days[day]?.answers ?? 0} answers`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

/** Bar with rounded top corners, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
