import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTimestamp, timestampMode, humanizeRelative, isoWeek, parseTimestamp } from '../src/modes/timestamp.js';
import type { TimestampData } from '../src/modes/timestamp.js';

const NOW = Date.UTC(2024, 2, 15, 12, 0, 0); // 2024-03-15T12:00:00Z
const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options: { now: NOW, ...options } });
const row = (d: TimestampData, i: number, label: string) => d.cards[i]!.rows.find((r) => r.label.startsWith(label))!.value;

test('magnitude detection: s / ms / µs / ns', () => {
  assert.deepEqual(parseTimestamp('1700000000', NOW), { ms: 1700000000000, kind: 'seconds' });
  assert.deepEqual(parseTimestamp('1700000000000', NOW), { ms: 1700000000000, kind: 'milliseconds' });
  assert.deepEqual(parseTimestamp('1700000000000000', NOW), { ms: 1700000000000, kind: 'microseconds' });
  assert.deepEqual(parseTimestamp('1700000000000000000', NOW), { ms: 1700000000000, kind: 'nanoseconds' });
  assert.deepEqual(parseTimestamp('2023-11-14T22:13:20Z', NOW), { ms: 1700000000000, kind: 'date' });
  assert.deepEqual(parseTimestamp('now', NOW), { ms: NOW, kind: 'now' });
  assert.equal(parseTimestamp('today', NOW).ms, Date.UTC(2024, 2, 15));
});

test('full card rows for a known timestamp', () => {
  const r = runTimestamp('1700000000', ctx());
  assert.equal(r.view?.kind, 'timestamp');
  const d = r.view!.data as TimestampData;
  assert.equal(row(d, 0, 'Unix seconds'), '1700000000');
  assert.equal(row(d, 0, 'Unix milliseconds'), '1700000000000');
  assert.equal(row(d, 0, 'ISO-8601'), '2023-11-14T22:13:20.000Z');
  assert.equal(row(d, 0, 'RFC 2822'), 'Tue, 14 Nov 2023 22:13:20 GMT');
  assert.equal(row(d, 0, 'Day of week'), 'Tuesday');
  assert.equal(row(d, 0, 'ISO week'), '2023-W46');
  assert.equal(row(d, 0, 'Day of year'), '318');
  assert.equal(row(d, 0, 'Unix day'), '19675');
  assert.equal(row(d, 0, 'Relative'), '4 months ago');
  assert.match(r.output, /^# 1700000000 \(seconds\)/);
});

test('relative humanizer uses the reference now', () => {
  assert.equal(humanizeRelative(NOW, NOW), 'just now');
  assert.equal(humanizeRelative(NOW - 3 * 86_400_000, NOW), '3 days ago');
  assert.equal(humanizeRelative(NOW + 2 * 3_600_000, NOW), 'in 2 hours');
  assert.equal(humanizeRelative(NOW - 90_000, NOW), '2 minutes ago');
  assert.equal(humanizeRelative(NOW + 400 * 86_400_000, NOW), 'in 1 year');
  const r = runTimestamp('now', ctx());
  assert.equal(row(r.view!.data as TimestampData, 0, 'Relative'), 'just now');
  assert.equal(row(r.view!.data as TimestampData, 0, 'Unix milliseconds'), String(NOW));
});

test('ISO week edge cases', () => {
  assert.deepEqual(isoWeek(new Date(Date.UTC(2021, 0, 1))), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek(new Date(Date.UTC(2024, 11, 30))), { year: 2025, week: 1 });
});

test('timezone control and fallback', () => {
  const berlin = runTimestamp('1700000000', ctx({ timezone: 'Europe/Berlin' }));
  const local = row(berlin.view!.data as TimestampData, 0, 'Local (Europe/Berlin)');
  assert.match(local, /23:13:20/);
  const bad = runTimestamp('1700000000', ctx({ timezone: 'Mars/Olympus' }));
  assert.ok(bad.notes?.some((n) => /Unknown timezone/.test(n)));
  assert.match(bad.status!, /tz UTC/);
});

test('output control narrows to one line per input', () => {
  const input = '1700000000\n2024-02-29T12:34:56Z';
  assert.equal(runTimestamp(input, ctx({ output: 'seconds' })).output, '1700000000\n1709210096');
  assert.equal(runTimestamp(input, ctx({ output: 'milliseconds' })).output, '1700000000000\n1709210096000');
  assert.equal(runTimestamp(input, ctx({ output: 'iso' })).output, '2023-11-14T22:13:20.000Z\n2024-02-29T12:34:56.000Z');
  assert.equal(runTimestamp(input, ctx({ output: 'iso' })).view, undefined);
});

test('invalid line reports the line number with a hint', () => {
  const r = runTimestamp('1700000000\nyesterday-ish', ctx());
  assert.equal(r.error!.line, 2);
  assert.match(r.error!.message, /yesterday-ish/);
  assert.ok(r.error!.hint);
});

test('empty input and sample', () => {
  assert.deepEqual(runTimestamp('', ctx()), { output: '', status: '' });
  const s = runTimestamp(timestampMode.sample, ctx());
  assert.equal(s.error, undefined);
  assert.match(s.status!, /4 timestamps/);
});
