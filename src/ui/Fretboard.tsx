import { MAX_FRET, STRING_COUNT, STRING_LETTERS, STRING_NAMES, fretMidi, midiName } from '../music/theory';

export interface CellStyle {
  label?: string;
  fill: string;
  text?: string;
  shape?: 'pill' | 'dot';
  opacity?: number;
  stroke?: string;
}

interface Props {
  /** What to draw at a position, or null for nothing. */
  cell?: (string: number, fret: number) => CellStyle | null;
  highlightString?: number | null;
  onCellClick?: (string: number, fret: number) => void;
  label: string;
}

const W = 1000;
const LEFT = 40;
const OPEN_W = 56;
const RIGHT = 10;
const TOP = 26;
const ROW = 34;
const FRET_W = (W - LEFT - OPEN_W - RIGHT) / MAX_FRET;
const NUT_X = LEFT + OPEN_W;
const BOTTOM = TOP + (STRING_COUNT - 1) * ROW;
const H = BOTTOM + 46;
const INLAYS = [3, 5, 7, 9];

const fretX = (fret: number) => (fret === 0 ? LEFT + OPEN_W / 2 : NUT_X + (fret - 0.5) * FRET_W);
/** High E on top, low E at the bottom - the same way tab and chord diagrams are drawn. */
const stringY = (string: number) => TOP + (STRING_COUNT - 1 - string) * ROW;

export function Fretboard({ cell, highlightString = null, onCellClick, label }: Props) {
  const strings = Array.from({ length: STRING_COUNT }, (_, s) => s);
  const frets = Array.from({ length: MAX_FRET + 1 }, (_, f) => f);
  const midY = (TOP + BOTTOM) / 2;

  return (
    <svg className="fretboard" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect x={NUT_X} y={TOP - 15} width={W - RIGHT - NUT_X} height={BOTTOM - TOP + 30} rx={6} className="fb-board" />
      {INLAYS.map((f) => (
        <circle key={f} cx={fretX(f)} cy={midY} r={7} className="fb-inlay" />
      ))}
      <circle cx={fretX(12)} cy={midY - ROW} r={7} className="fb-inlay" />
      <circle cx={fretX(12)} cy={midY + ROW} r={7} className="fb-inlay" />
      {frets.slice(1).map((f) => (
        <line key={f} x1={NUT_X + f * FRET_W} x2={NUT_X + f * FRET_W} y1={TOP - 15} y2={BOTTOM + 15} className="fb-fret" />
      ))}
      <rect x={NUT_X - 3} y={TOP - 15} width={6} height={BOTTOM - TOP + 30} rx={2} className="fb-nut" />

      {strings.map((s) => {
        const active = highlightString === s;
        return (
          <g key={s}>
            <line
              x1={LEFT}
              x2={W - RIGHT}
              y1={stringY(s)}
              y2={stringY(s)}
              strokeWidth={(3.4 - s * 0.42) * (active ? 1.5 : 1)}
              className={active ? 'fb-string fb-string-active' : 'fb-string'}
            />
            <text x={LEFT - 14} y={stringY(s) + 5} textAnchor="middle" className={active ? 'fb-label fb-label-active' : 'fb-label'}>
              {STRING_LETTERS[s]}
            </text>
          </g>
        );
      })}

      {frets.map((f) => (
        <text
          key={f}
          x={fretX(f)}
          y={BOTTOM + 38}
          textAnchor="middle"
          className={INLAYS.includes(f) || f === 12 ? 'fb-num fb-num-mark' : 'fb-num'}
        >
          {f === 0 ? 'open' : f}
        </text>
      ))}

      {cell &&
        strings.map((s) =>
          frets.map((f) => {
            const style = cell(s, f);
            if (!style) return null;
            const x = fretX(f);
            const y = stringY(s);
            const pillW = Math.min(FRET_W, OPEN_W) - 8;
            return (
              <g key={`${s}-${f}`} opacity={style.opacity ?? 1}>
                {style.shape === 'dot' ? (
                  <circle cx={x} cy={y} r={14} fill={style.fill} stroke={style.stroke ?? 'none'} strokeWidth={2.5} />
                ) : (
                  <rect x={x - pillW / 2} y={y - 13} width={pillW} height={26} rx={8} fill={style.fill} stroke={style.stroke ?? 'none'} />
                )}
                {style.label && (
                  <text x={x} y={y + 4.5} textAnchor="middle" fill={style.text ?? '#fff'} className="fb-cell-text">
                    {style.label}
                  </text>
                )}
              </g>
            );
          }),
        )}

      {onCellClick &&
        strings.map((s) =>
          frets.map((f) => (
            <rect
              key={`hit-${s}-${f}`}
              x={f === 0 ? LEFT : NUT_X + (f - 1) * FRET_W}
              y={stringY(s) - ROW / 2}
              width={f === 0 ? OPEN_W : FRET_W}
              height={ROW}
              className="fb-hit"
              onClick={() => onCellClick(s, f)}
            >
              <title>{`${STRING_NAMES[s]} string, ${f === 0 ? 'open' : `fret ${f}`} (${midiName(fretMidi(s, f))})`}</title>
            </rect>
          )),
        )}
    </svg>
  );
}
