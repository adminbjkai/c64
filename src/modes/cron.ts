/**
 * Cron Expression mode: plain-English description, per-field breakdown and
 * the next 10 run times in a chosen time zone.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseCron, describeCron, describeField, nextRuns, formatInZone, relativeTime, isValidTimeZone, CronError, type CronExpression } from '../lib/cron.js';

export interface CronRun {
  epoch: number;
  /** "2026-09-21 09:00:00 Mon" in the chosen zone. */
  local: string;
  iso: string;
  relative: string;
}

export interface CronData {
  expression: string;
  macro?: string;
  description: string;
  fields: { field: string; value: string; meaning: string }[];
  runs: CronRun[];
  timeZone: string;
  now: number;
  /** Set when the search found fewer runs than requested (e.g. Feb 30). */
  exhausted: boolean;
}

function fieldRows(expr: CronExpression): CronData['fields'] {
  return expr.fields.map((f) => ({ field: f.spec.label, value: f.raw, meaning: describeField(f) }));
}

export function runCron(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const tzOpt = ctx.options['timezone'];
  const timeZone = typeof tzOpt === 'string' && tzOpt.trim() ? tzOpt.trim() : 'UTC';
  if (!isValidTimeZone(timeZone)) {
    return { output: '', error: { message: `Unknown time zone "${timeZone}"`, hint: 'Use an IANA name such as UTC, Europe/London or America/New_York.' }, status: 'Invalid time zone' };
  }
  const now = typeof ctx.options['now'] === 'number' ? ctx.options['now'] : Date.now();
  let expr: CronExpression;
  try {
    expr = parseCron(input);
  } catch (e) {
    if (e instanceof CronError) {
      const line = input.split('\n').findIndex((l) => l.trim() !== '') + 1;
      return { output: '', error: { message: e.message, line: line || 1, col: e.col, hint: e.hint }, status: `Invalid cron expression · line ${line || 1}, col ${e.col}` };
    }
    return { output: '', error: { message: (e as Error).message }, status: 'Invalid cron expression' };
  }
  const description = describeCron(expr);
  const runs: CronRun[] = nextRuns(expr, { now, timeZone, count: 10 }).map((epoch) => ({
    epoch,
    local: formatInZone(epoch, timeZone),
    iso: new Date(epoch).toISOString(),
    relative: relativeTime(epoch, now),
  }));
  const fields = fieldRows(expr);
  const lines = [description];
  if (fields.length) {
    lines.push('', 'Fields:');
    const w = Math.max(...fields.map((f) => f.field.length));
    const vw = Math.max(...fields.map((f) => f.value.length));
    for (const f of fields) lines.push(`  ${f.field.padEnd(w)}  ${f.value.padEnd(vw)}  ${f.meaning}`);
  }
  if (expr.reboot) lines.push('', 'Runs once when the scheduler starts; no calendar schedule.');
  else {
    lines.push('', `Next ${runs.length} run${runs.length === 1 ? '' : 's'} (${timeZone}):`);
    for (const r of runs) lines.push(`  ${r.local}  (${r.relative})`);
    if (runs.length === 0) lines.push('  none in the next 5 years');
  }
  const data: CronData = { expression: expr.raw, macro: expr.macro, description, fields, runs, timeZone, now, exhausted: !expr.reboot && runs.length < 10 };
  const notes = !data.exhausted ? undefined : runs.length === 0 ? ['No run found in the next 5 years — the schedule may never match (e.g. 31 February).'] : [`Only ${runs.length} run${runs.length === 1 ? '' : 's'} found in the next 5 years.`];
  return {
    output: lines.join('\n'),
    notes,
    status: expr.reboot ? 'Valid · @reboot' : `Valid · ${expr.fields.length} fields · next ${runs[0] ? runs[0].relative : 'never'}`,
    view: { kind: 'cron', data },
  };
}

export const cronMode: ToolMode = {
  id: 'cron',
  label: 'Cron Expression',
  description: 'Explain a cron schedule in plain English and list its next run times in any time zone.',
  category: 'Developer',
  icon: 'calendar',
  keywords: ['crontab', 'schedule', 'scheduler', 'quartz', 'timer', 'next run'],
  emptyHint: 'Enter a cron expression such as "0 9 * * 1-5" or "@daily". Six fields add seconds, seven add a year.',
  sample: '30 5 * 3 MON-FRI',
  supportsPretty: false,
  controls: [{ kind: 'text', key: 'timezone', label: 'Time zone', placeholder: 'UTC', default: 'UTC' }],
  run: runCron,
};
