/**
 * Unix Time ↔ Date mode: each line is a unix timestamp (s/ms/µs/ns by
 * magnitude), an ISO-8601 / Date.parse-able string, or `now` / `today`.
 * "now" is taken from ctx.options.now (ms) when present so tests are stable.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';

export interface TimestampRow {
  label: string;
  value: string;
}

export interface TimestampCard {
  input: string;
  /** How the input was interpreted. */
  kind: 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds' | 'date' | 'now';
  ms: number;
  rows: TimestampRow[];
}

export interface TimestampData {
  cards: TimestampCard[];
  timezone: string;
}

export type TimestampOutput = 'all' | 'seconds' | 'milliseconds' | 'iso';

/** "3 days ago" / "in 2 hours" / "just now" relative to `now`. */
export function humanizeRelative(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 1000) return 'just now';
  const units: [number, string][] = [
    [365.25 * 86_400_000, 'year'],
    [30.4375 * 86_400_000, 'month'],
    [7 * 86_400_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1000, 'second'],
  ];
  for (const [unit, name] of units) {
    if (abs >= unit) {
      const n = Math.round(abs / unit);
      const s = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff < 0 ? `${s} ago` : `in ${s}`;
    }
  }
  return 'just now';
}

/** ISO-8601 week number (weeks start Monday; week 1 contains Jan 4). */
export function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

export function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
}

export class TimestampError extends Error {
  constructor(message: string, public line: number, public hint: string) {
    super(message);
  }
}

/** Interprets one line. Throws TimestampError. */
export function parseTimestamp(raw: string, now: number, line = 1): { ms: number; kind: TimestampCard['kind'] } {
  const s = raw.trim();
  const lower = s.toLowerCase();
  if (lower === 'now') return { ms: now, kind: 'now' };
  if (lower === 'today') {
    const d = new Date(now);
    return { ms: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), kind: 'now' };
  }
  const numeric = s.replace(/[_,]/g, '');
  if (/^[-+]?\d+(\.\d+)?$/.test(numeric)) {
    const n = Number(numeric);
    const abs = Math.abs(n);
    let kind: TimestampCard['kind'];
    let ms: number;
    if (abs < 1e11) { kind = 'seconds'; ms = n * 1000; }
    else if (abs < 1e14) { kind = 'milliseconds'; ms = n; }
    else if (abs < 1e17) { kind = 'microseconds'; ms = n / 1000; }
    else { kind = 'nanoseconds'; ms = n / 1e6; }
    ms = Math.round(ms);
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) throw new TimestampError(`${s} is outside the representable date range.`, line, 'JavaScript dates cover ±100 million days around 1970.');
    return { ms, kind };
  }
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) {
    throw new TimestampError(`Cannot interpret "${s}" as a timestamp or date.`, line, 'Use a unix time (seconds, ms, µs or ns), an ISO-8601 date like 2024-03-01T12:00:00Z, or the word "now".');
  }
  return { ms: parsed, kind: 'date' };
}

function localFormat(ms: number, timezone: string): string {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short',
  });
  return f.format(new Date(ms));
}

export function buildCard(input: string, ms: number, kind: TimestampCard['kind'], now: number, timezone: string): TimestampCard {
  const d = new Date(ms);
  const w = isoWeek(d);
  const rows: TimestampRow[] = [
    { label: 'Unix seconds', value: String(Math.floor(ms / 1000)) },
    { label: 'Unix milliseconds', value: String(ms) },
    { label: 'ISO-8601 (UTC)', value: d.toISOString() },
    { label: 'RFC 2822', value: d.toUTCString() },
    { label: `Local (${timezone})`, value: localFormat(ms, timezone) },
    { label: 'Relative', value: humanizeRelative(ms, now) },
    { label: 'Day of week', value: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) },
    { label: 'ISO week', value: `${w.year}-W${String(w.week).padStart(2, '0')}` },
    { label: 'Day of year', value: String(dayOfYear(d)) },
    { label: 'Unix day', value: String(Math.floor(ms / 86_400_000)) },
  ];
  return { input, kind, ms, rows };
}

export function runTimestamp(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const now = typeof ctx.options['now'] === 'number' && Number.isFinite(ctx.options['now']) ? (ctx.options['now'] as number) : Date.now();
  const outOpt = ctx.options['output'];
  const output: TimestampOutput = outOpt === 'seconds' || outOpt === 'milliseconds' || outOpt === 'iso' ? outOpt : 'all';
  const notes: string[] = [];
  let timezone = typeof ctx.options['timezone'] === 'string' && ctx.options['timezone'].trim() !== '' ? ctx.options['timezone'].trim() : 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    notes.push(`Unknown timezone "${timezone}" — showing UTC instead. Use an IANA name such as Europe/Berlin or America/New_York.`);
    timezone = 'UTC';
  }

  const cards: TimestampCard[] = [];
  const lines = input.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (raw.trim() === '') continue;
    try {
      const { ms, kind } = parseTimestamp(raw, now, i + 1);
      cards.push(buildCard(raw.trim(), ms, kind, now, timezone));
    } catch (e) {
      if (e instanceof TimestampError) return { output: '', error: { message: e.message, line: e.line, col: 1, hint: e.hint }, status: `Invalid timestamp · line ${e.line}` };
      return { output: '', error: { message: (e as Error).message }, status: 'Invalid timestamp' };
    }
  }

  let text: string;
  if (output === 'seconds') text = cards.map((c) => String(Math.floor(c.ms / 1000))).join('\n');
  else if (output === 'milliseconds') text = cards.map((c) => String(c.ms)).join('\n');
  else if (output === 'iso') text = cards.map((c) => new Date(c.ms).toISOString()).join('\n');
  else {
    const width = Math.max(...cards.flatMap((c) => c.rows.map((r) => r.label.length)));
    text = cards.map((c) => [`# ${c.input} (${c.kind})`, ...c.rows.map((r) => `${r.label.padEnd(width)}  ${r.value}`)].join('\n')).join('\n\n');
  }
  return {
    output: text,
    view: output === 'all' ? { kind: 'timestamp', data: { cards, timezone } satisfies TimestampData } : undefined,
    notes: notes.length ? notes : undefined,
    status: `${cards.length} timestamp${cards.length === 1 ? '' : 's'} · tz ${timezone}`,
  };
}

export const timestampMode: ToolMode = {
  id: 'timestamp',
  label: 'Unix Time ↔ Date',
  description: 'Convert unix timestamps (s, ms, µs, ns) and dates to every common form, with relative time.',
  category: 'Developer',
  icon: 'clock',
  keywords: ['epoch', 'unix', 'date', 'iso', 'time', 'timestamp', 'timezone', 'rfc2822'],
  emptyHint: 'One per line: a unix timestamp (1700000000, 1700000000000), an ISO date, or "now".',
  sample: '1700000000\n1700000000000\n2024-02-29T12:34:56Z\nnow',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'output',
      label: 'Output',
      default: 'all',
      options: [
        { value: 'all', label: 'All' },
        { value: 'seconds', label: 'Unix seconds' },
        { value: 'milliseconds', label: 'Unix ms' },
        { value: 'iso', label: 'ISO-8601' },
      ],
    },
    { kind: 'text', key: 'timezone', label: 'Timezone', placeholder: 'UTC, Europe/Berlin…', default: 'UTC' },
  ],
  run: runTimestamp,
};
