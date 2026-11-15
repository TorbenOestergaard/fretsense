import {
  MASTERY_LABELS,
  MODE_TITLES,
  itemKey,
  levelOf,
  masterySummary,
  positionKey,
  type ItemStat,
  type ProgressData,
} from '../game/progress';
import { SCALES, STRING_NAMES, degreeOrdinal, fretMidi, pcName, pcOf, type ScaleId } from '../music/theory';
import { Fretboard } from './Fretboard';

/**
 * Status colours, a traffic light: Shaky red, Learning orange, Solid yellow, Instant green.
 * `ink` is the same colour for text on the dark background (status names in lists).
 */
export const MASTERY_COLORS = [
  { fill: '#232730', text: '#7f8798', ink: '#929aab' },
  { fill: '#8f3d3d', text: '#ffe6e3', ink: '#ee7b70' },
  { fill: '#c4651c', text: '#fff2de', ink: '#f0944a' },
  { fill: '#e2c93a', text: '#2b2305', ink: '#ecd655' },
  { fill: '#3c9a5f', text: '#e8fff1', ink: '#5fc488' },
];

/** The app's accent (selected chips, answer and root dots). Kept apart from the status colours. */
export const ACCENT = { fill: '#a99bff', text: '#14103a' };

export type MapView = 'status' | 'time';

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** One hue, brighter the slower: the cells that stand out are the ones costing you time. */
export function timeColor(ms: number): { fill: string; text: string } {
  const u = Math.min(1, Math.max(0, (ms - 1500) / 6500));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * u);
  return { fill: `rgb(${mix(34, 122)}, ${mix(44, 184)}, ${mix(60, 255)})`, text: u > 0.55 ? '#06131f' : '#cfe2f7' };
}

function styleFor(stat: ItemStat | undefined, view: MapView, name: string) {
  if (view === 'time') {
    if (!stat || !stat.ms) return { fill: MASTERY_COLORS[0].fill, text: MASTERY_COLORS[0].text, label: name };
    return { ...timeColor(stat.ms), label: seconds(stat.ms) };
  }
  const { fill, text } = MASTERY_COLORS[levelOf(stat)];
  return { fill, text, label: name };
}

export function Legend({ counts, view }: { counts?: number[]; view: MapView }) {
  if (view === 'time') {
    return (
      <div className="legend">
        <span className="legend-item">
          Average time of first-try answers, in seconds
          <i className="legend-ramp" />
          fast → slow
        </span>
      </div>
    );
  }
  return (
    <div className="legend">
      {MASTERY_LABELS.map((name, level) => (
        <span key={name} className="legend-item">
          <i style={{ background: MASTERY_COLORS[level].fill }} />
          {name}
          {counts && <b>{counts[level]}</b>}
        </span>
      ))}
    </div>
  );
}

interface MapProps {
  data: ProgressData;
  mode: 'notes' | 'sweep';
  view?: MapView;
  /** Hide the heading when the surrounding view already has one. */
  bare?: boolean;
}

/** The whole neck, coloured by how well each note is known in one exercise. */
export function MasteryMap({ data, mode, view = 'status', bare = false }: MapProps) {
  const summary = masterySummary(data, mode);
  const percent = Math.round((summary.solid / summary.total) * 100);
  const stats = data.stats[mode];
  return (
    <div className="mastery">
      {!bare && (
        <div className="mastery-head">
          <div>
            <h2>Your fretboard · {MODE_TITLES[mode]}</h2>
            <p className="muted">
              {summary.solid} of {summary.total} notes solid or better
              {summary.counts[4] > 0 ? `, ${summary.counts[4]} instant` : ''}
            </p>
          </div>
          <div className="mastery-percent" aria-label={`${percent} percent of the neck is solid`}>
            {percent}
            <span>%</span>
          </div>
        </div>
      )}
      <Fretboard
        label={view === 'time' ? 'Fretboard showing the average answer time per note' : 'Fretboard coloured by how well you know each note'}
        cell={(s, f) => {
          const pc = pcOf(fretMidi(s, f));
          return { ...styleFor(stats[itemKey(s, pc)], view, pcName(pc, 'sharp')), shape: 'pill' };
        }}
      />
      <Legend counts={summary.counts} view={view} />
      {view === 'status' && (
        <div className="string-bars">
          {[5, 4, 3, 2, 1, 0].map((s) => (
            <div key={s} className="string-bar" title={`${STRING_NAMES[s]} string`}>
              <span>{STRING_NAMES[s]}</span>
              <div className="bar">
                <div style={{ width: `${(summary.perString[s].solid / 12) * 100}%` }} />
              </div>
              <b>{summary.perString[s].solid}/12</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface GridProps {
  data: ProgressData;
  scaleId: ScaleId;
  view?: MapView;
  bare?: boolean;
}

export function positionSummary(data: ProgressData, scaleId: ScaleId) {
  const degrees = SCALES[scaleId].degrees.map((d) => d.label);
  const counts = [0, 0, 0, 0, 0];
  for (let p = 0; p < 5; p++) for (const d of degrees) counts[levelOf(data.stats.positions[positionKey(scaleId, p, d)])]++;
  return { counts, solid: counts[3] + counts[4], total: degrees.length * 5 };
}

/** Five boxes by the degrees of the scale: how well each degree is known in each box, in any key. */
export function PositionGrid({ data, scaleId, view = 'status', bare = false }: GridProps) {
  const type = SCALES[scaleId];
  const degrees = type.degrees.map((d) => d.label);
  const summary = positionSummary(data, scaleId);
  const percent = Math.round((summary.solid / summary.total) * 100);
  return (
    <div className="mastery">
      {!bare && (
        <div className="mastery-head">
          <div>
            <h2>Your positions · {type.name}</h2>
            <p className="muted">
              {summary.solid} of {summary.total} degrees solid or better, counted across all keys
            </p>
          </div>
          <div className="mastery-percent" aria-label={`${percent} percent solid`}>
            {percent}
            <span>%</span>
          </div>
        </div>
      )}
      <div className="pos-grid" style={{ gridTemplateColumns: `auto repeat(${degrees.length}, minmax(0, 1fr))` }} role="table" aria-label="Status per position and degree">
        <span />
        {degrees.map((d) => (
          <span key={d} className="pos-head">
            {degreeOrdinal(d)}
          </span>
        ))}
        {[0, 1, 2, 3, 4].map((p) => [
          <span key={`h${p}`} className="pos-row">
            Position {p + 1}
          </span>,
          ...degrees.map((d) => {
            const stat = data.stats.positions[positionKey(scaleId, p, d)];
            const style = styleFor(stat, view, d);
            const title = `${degreeOrdinal(d)} in position ${p + 1}: ${MASTERY_LABELS[levelOf(stat)]}${stat?.ms ? `, ${seconds(stat.ms)} s on average` : ''}${stat ? `, ${stat.seen} answers` : ''}`;
            return (
              <span key={`${p}${d}`} className="pos-cell" style={{ background: style.fill, color: style.text }} title={title}>
                {style.label}
              </span>
            );
          }),
        ])}
      </div>
      <Legend counts={summary.counts} view={view} />
    </div>
  );
}
