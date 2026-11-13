import { isNatural } from '../music/theory';
import { dayKey, type AnswerEvent, type Mode } from './progress';

// Everything the Progress view shows is derived from the answer log.

export type NoteFilter = 'all' | 'naturals' | 'accidentals';

export interface Bucket {
  /** Answers. */
  n: number;
  /** First-try answers. */
  ok: number;
  /** Average time of first-try answers in ms, or null if there were none. */
  avgMs: number | null;
}

export function eventsFor(events: AnswerEvent[], mode: Mode, filter: NoteFilter = 'all'): AnswerEvent[] {
  return events.filter((e) => {
    if (e.m !== mode) return false;
    if (filter === 'naturals') return isNatural(e.pc);
    if (filter === 'accidentals') return !isNatural(e.pc);
    return true;
  });
}

export function bucketOf(events: AnswerEvent[]): Bucket {
  let ok = 0;
  let sum = 0;
  for (const e of events) {
    if (e.ok) {
      ok++;
      sum += e.ms;
    }
  }
  return { n: events.length, ok, avgMs: ok ? sum / ok : null };
}

/** Group events by a key; events for which the key function returns null are left out. */
export function groupBy<K>(events: AnswerEvent[], keyOf: (e: AnswerEvent) => K | null): Map<K, Bucket> {
  const groups = new Map<K, AnswerEvent[]>();
  for (const e of events) {
    const key = keyOf(e);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out = new Map<K, Bucket>();
  for (const [key, list] of groups) out.set(key, bucketOf(list));
  return out;
}

export interface DayPoint extends Bucket {
  day: string;
}

/** One point per day that has answers, oldest first. */
export function dailySeries(events: AnswerEvent[]): DayPoint[] {
  const byDay = groupBy(events, (e) => dayKey(e.t));
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, bucket]) => ({ day, ...bucket }));
}

/** Parts of a positions-mode item key: "major:2:♭3". */
export function parsePositionKey(key: string): { scaleId: string; position: number; degree: string } {
  const [scaleId, position, degree] = key.split(':');
  return { scaleId, position: Number(position), degree };
}

/** The last `count` calendar days ending today, oldest first. */
export function lastDays(now: number, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (count - 1));
  for (let i = 0; i < count; i++) {
    days.push(dayKey(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
