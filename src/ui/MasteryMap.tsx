import { MASTERY_LABELS, itemKey, levelOf, masterySummary, type ProgressData } from '../game/progress';
import { STRING_NAMES, fretMidi, pcName, pcOf } from '../music/theory';
import { Fretboard } from './Fretboard';

export const MASTERY_COLORS = [
  { fill: '#232730', text: '#7f8798' },
  { fill: '#8f3d3d', text: '#ffe6e3' },
  { fill: '#a96f27', text: '#fff2de' },
  { fill: '#3c8a59', text: '#e8fff1' },
  { fill: '#f2c94c', text: '#2b2305' },
];

/** The whole neck, coloured by how well each note is known. The main progress display. */
export function MasteryMap({ data }: { data: ProgressData }) {
  const summary = masterySummary(data);
  const percent = Math.round((summary.solid / summary.total) * 100);
  return (
    <div className="mastery">
      <div className="mastery-head">
        <div>
          <h2>Your fretboard</h2>
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
      <Fretboard
        label="Fretboard coloured by how well you know each note"
        cell={(s, f) => {
          const pc = pcOf(fretMidi(s, f));
          const level = levelOf(data.items[itemKey(s, pc)]);
          return { ...MASTERY_COLORS[level], label: pcName(pc, 'sharp'), shape: 'pill' };
        }}
      />
      <div className="legend">
        {MASTERY_LABELS.map((name, level) => (
          <span key={name} className="legend-item">
            <i style={{ background: MASTERY_COLORS[level].fill }} />
            {name}
            <b>{summary.counts[level]}</b>
          </span>
        ))}
      </div>
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
    </div>
  );
}
