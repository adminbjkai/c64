import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, describeCron, nextRuns, relativeTime, CronError } from '../src/lib/cron.js';
import { runCron, cronMode, type CronData } from '../src/modes/cron.js';

// Friday 2026-09-18 12:00:00 UTC
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const ctx = (options: Record<string, unknown> = {}) => ({ pretty: true, options: { now: NOW, ...options } });
const describe = (e: string): string => describeCron(parseCron(e));

test('sample runs and returns a cron view', () => {
  const r = runCron(cronMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'cron');
  assert.equal((r.view?.data as CronData).description, 'At 05:30 on every day-of-week from Monday through Friday in March');
});

test('empty input returns empty output and status', () => {
  assert.deepEqual(runCron('\n', ctx()), { output: '', status: '' });
});

test('descriptions for common expressions', () => {
  assert.equal(describe('0 9 * * 1-5'), 'At 09:00 on every day-of-week from Monday through Friday');
  assert.equal(describe('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(describe('* * * * *'), 'Every minute');
  assert.equal(describe('0 0 1 1 *'), 'At 00:00 on day-of-month 1 in January');
  assert.equal(describe('5 4 * * sun'), 'At 04:05 on Sunday');
  assert.equal(describe('0 0,12 1 */2 *'), 'At 00:00 and 12:00 on day-of-month 1 in every 2nd month');
  assert.equal(describe('23 0-20/2 * * *'), 'At minute 23, every 2 hours from 0 through 20');
  assert.equal(describe('0 9-17 * * *'), 'At minute 0, between 09:00 and 17:59');
  assert.equal(describe('30 4 1,15 * 5'), 'At 04:30 on day-of-month 1 and 15 and on Friday');
  assert.equal(describe('0 22 * * MON,WED,FRI'), 'At 22:00 on Monday, Wednesday, and Friday');
  assert.equal(describe('15 14 1 * *'), 'At 14:15 on day-of-month 1');
});

test('descriptions for L, W and # extensions', () => {
  assert.equal(describe('0 0 L * *'), 'At 00:00 on the last day of the month');
  assert.equal(describe('0 0 L-2 * *'), 'At 00:00 2 days before the end of the month');
  assert.equal(describe('0 12 15W * *'), 'At 12:00 on the weekday nearest day 15 of the month');
  assert.equal(describe('0 9 * * 5L'), 'At 09:00 on the last Friday of the month');
  assert.equal(describe('0 9 * * MON#2'), 'At 09:00 on the second Monday of the month');
});

test('6- and 7-field expressions add seconds and year', () => {
  assert.equal(describe('0 30 9 * * *'), 'At 09:30');
  assert.equal(describe('15 30 9 * * *'), 'At 09:30:15');
  assert.equal(describe('*/10 * * * * *'), 'Every 10 seconds, every minute');
  assert.equal(describe('0 0 12 * * ? 2027'), 'At 12:00 in 2027');
  assert.equal(parseCron('0 0 12 * * ? 2027-2028').hasYear, true);
});

test('macros expand, @reboot has no runs', () => {
  assert.equal(describe('@daily'), 'At 00:00');
  assert.equal(describe('@hourly'), 'At minute 0');
  assert.equal(describe('@weekly'), 'At 00:00 on Sunday');
  assert.equal(describe('@monthly'), 'At 00:00 on day-of-month 1');
  assert.equal(describe('@yearly'), 'At 00:00 on day-of-month 1 in January');
  assert.equal(parseCron('@annually').macro, '@annually');
  const reboot = runCron('@reboot', ctx());
  assert.equal(reboot.error, undefined);
  assert.equal((reboot.view?.data as CronData).description, 'At system startup');
  assert.deepEqual((reboot.view?.data as CronData).runs, []);
});

test('next 10 runs for "0 9 * * 1-5" from a fixed now in UTC', () => {
  const runs = nextRuns(parseCron('0 9 * * 1-5'), { now: NOW, timeZone: 'UTC' });
  const expected = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) => `${d}T09:00:00.000Z`);
  assert.deepEqual(
    runs.map((t) => new Date(t).toISOString()),
    expected,
  );
  for (const t of runs) {
    const day = new Date(t).getUTCDay();
    assert.ok(day >= 1 && day <= 5);
  }
});

test('next runs respect the time zone control', () => {
  const r = runCron('0 9 * * 1-5', ctx({ timezone: 'America/New_York' }));
  const data = r.view?.data as CronData;
  assert.equal(data.runs[0]?.local, '2026-09-18 09:00:00 Fri');
  assert.equal(data.runs[0]?.iso, '2026-09-18T13:00:00.000Z');
  assert.equal(data.runs[0]?.relative, 'in 1 h');
  assert.equal(data.timeZone, 'America/New_York');
});

test('runs strictly after now; seconds field steps by second; L/W/# match the right days', () => {
  const s = nextRuns(parseCron('*/10 * * * * *'), { now: NOW, count: 3 }).map((t) => new Date(t).toISOString());
  assert.deepEqual(s, ['2026-09-18T12:00:10.000Z', '2026-09-18T12:00:20.000Z', '2026-09-18T12:00:30.000Z']);
  const last = nextRuns(parseCron('0 0 L * *'), { now: NOW, count: 2 }).map((t) => new Date(t).toISOString().slice(0, 10));
  assert.deepEqual(last, ['2026-09-30', '2026-10-31']);
  const lastFri = nextRuns(parseCron('0 9 * * 5L'), { now: NOW, count: 2 }).map((t) => new Date(t).toISOString().slice(0, 10));
  assert.deepEqual(lastFri, ['2026-09-25', '2026-10-30']);
  const secondMon = nextRuns(parseCron('0 9 * * MON#2'), { now: NOW, count: 1 }).map((t) => new Date(t).toISOString().slice(0, 10));
  assert.deepEqual(secondMon, ['2026-10-12']);
  const nearest = nextRuns(parseCron('0 12 15W * *'), { now: NOW, count: 2 }).map((t) => new Date(t).toISOString().slice(0, 10));
  assert.deepEqual(nearest, ['2026-10-15', '2026-11-16']);
});

test('impossible schedule yields no runs and a note; sparse schedules stay fast', () => {
  const r = runCron('0 0 31 2 *', ctx());
  assert.equal(r.error, undefined);
  assert.deepEqual((r.view?.data as CronData).runs, []);
  assert.ok(r.notes?.[0]?.includes('No run found'));
  const t0 = Date.now();
  nextRuns(parseCron('0 0 29 2 *'), { now: NOW });
  assert.ok(Date.now() - t0 < 2000);
});

test('invalid fields report the field column and a hint', () => {
  const r = runCron('0 25 * * *', ctx());
  assert.equal(r.error?.line, 1);
  assert.equal(r.error?.col, 3);
  assert.match(r.error?.message ?? '', /Hours field: 25 is out of range 0-23/);
  const bad = runCron('0 9 * * mon-fry', ctx());
  assert.equal(bad.error?.col, 9);
  assert.match(bad.error?.hint ?? '', /SUN-SAT/);
  assert.throws(() => parseCron('* * * *'), (e: unknown) => e instanceof CronError && /5, 6 or 7 fields/.test(e.message));
  assert.throws(() => parseCron('0 9 * * 1-5\n0 1 * * *'), (e: unknown) => e instanceof CronError && /one cron expression/i.test(e.message));
  assert.throws(() => parseCron('@fortnightly'), CronError);
  assert.throws(() => parseCron('0 9 * * 1#6'), CronError);
  assert.throws(() => parseCron('0 L * * *'), (e: unknown) => e instanceof CronError && e.field === 1 && /only allowed/.test(e.hint ?? ''));
  assert.equal(parseCron('0 9 L * *').fields[2]?.items[0]?.type, 'last');
  assert.equal(runCron('0 9 * * *', ctx({ timezone: 'Mars/Olympus' })).error?.message, 'Unknown time zone "Mars/Olympus"');
});

test('text output includes description, field table and run list', () => {
  const r = runCron('0 9 * * 1-5', ctx());
  const lines = r.output.split('\n');
  assert.equal(lines[0], 'At 09:00 on every day-of-week from Monday through Friday');
  assert.ok(lines.includes('Fields:'));
  assert.ok(lines.some((l) => /Day of week\s+1-5\s+on every day-of-week from Monday through Friday/.test(l)));
  assert.ok(lines.includes('Next 10 runs (UTC):'));
  assert.match(r.status ?? '', /^Valid · 5 fields · next in 2 d 21 h$/);
  assert.equal(relativeTime(NOW + 90 * 60000, NOW), 'in 1 h 30 min');
  assert.equal(relativeTime(NOW + 30000, NOW), 'in under a minute');
});
