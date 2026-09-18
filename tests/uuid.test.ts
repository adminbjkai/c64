import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUuid, uuidMode, generateIds } from '../src/modes/uuid.js';
import type { UuidData } from '../src/modes/uuid.js';
import { decodeUuid, decodeUlid, uuidV7, ulid, findIds } from '../src/lib/uuid.js';

const NOW = 1710504000000; // 2024-03-15T12:00:00Z
const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options: { now: NOW, ...options } });
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('empty input generates ids with a note', () => {
  const r = runUuid('', ctx());
  const ids = r.output.split('\n');
  assert.equal(ids.length, 5);
  for (const id of ids) assert.match(id, V4);
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(r.notes, ['Generated locally — paste an id to decode it instead.']);
  assert.equal(r.view, undefined);
  assert.equal(runUuid('   \n', ctx({ count: '1' })).output.split('\n').length, 1);
});

test('uuid v7 embeds the reference time and decodes back to it', () => {
  const id = uuidV7(NOW);
  assert.match(id, V7);
  const info = decodeUuid(id);
  assert.equal(info.version, 7);
  assert.equal(info.timestampMs, NOW);
  assert.equal(info.timestamp, '2024-03-15T12:00:00.000Z');
  const r = runUuid('', ctx({ kind: 'uuid-v7', count: '10' }));
  for (const line of r.output.split('\n')) assert.ok(Math.abs(decodeUuid(line).timestampMs! - NOW) < 1000);
});

test('ulid is 26 Crockford chars and carries the timestamp', () => {
  const id = ulid(NOW);
  assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  const info = decodeUlid(id);
  assert.equal(info.valid, true);
  assert.equal(info.timestampMs, NOW);
  const known = decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  assert.equal(known.timestampMs, 1469922850259);
  assert.equal(known.timestamp, '2016-07-30T23:54:10.259Z');
  assert.match(decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAU').warnings[0]!, /'U'/);
});

test('nanoid, random hex/base64, password respect length and alphabet', () => {
  const [n] = generateIds('nanoid', 1, { now: NOW, length: 16, symbols: true, uppercase: false, hyphens: true });
  assert.match(n!, /^[A-Za-z0-9_-]{21}$/);
  const [hex] = generateIds('random-hex', 1, { now: NOW, length: 32, symbols: true, uppercase: true, hyphens: true });
  assert.match(hex!, /^[0-9A-F]{64}$/);
  const [b64] = generateIds('random-base64', 1, { now: NOW, length: 24, symbols: true, uppercase: false, hyphens: true });
  assert.equal(b64!.length, 32);
  const [pw] = generateIds('password', 1, { now: NOW, length: 64, symbols: false, uppercase: false, hyphens: true });
  assert.match(pw!, /^[A-Za-z0-9]{64}$/);
  const r = runUuid('', ctx({ kind: 'password', length: '8', count: '1' }));
  assert.equal(r.output.length, 8);
});

test('uppercase and hyphens toggles', () => {
  const r = runUuid('', ctx({ kind: 'uuid-v4', count: '1', uppercase: true, hyphens: false }));
  assert.match(r.output, /^[0-9A-F]{32}$/);
});

test('decodes a known v1 uuid: version 1, 1998 timestamp, node', () => {
  const info = decodeUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  assert.equal(info.valid, true);
  assert.equal(info.version, 1);
  assert.equal(info.variant, 'RFC 4122 / 9562');
  assert.match(info.timestamp!, /^1998-02-04T22:13:53/);
  assert.equal(info.fields.find((f) => f.label === 'Node')!.value, '00:c0:4f:d4:30:c8');
});

test('decodes v4, nil, non-hyphenated and invalid ids', () => {
  const v4 = decodeUuid('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(v4.version, 4);
  assert.equal(v4.timestamp, undefined);
  assert.equal(decodeUuid('00000000-0000-0000-0000-000000000000').versionName, 'nil UUID');
  assert.equal(decodeUuid('550e8400e29b41d4a716446655440000').version, 4);
  assert.equal(decodeUuid('550e8400-e29b-41d4-a716').valid, false);
});

test('run() decodes every id found in free text and renders a view', () => {
  const text = 'ids: 550e8400-e29b-41d4-a716-446655440000, then 01ARZ3NDEKTSV4RRFFQ69G5FAV and 6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert.equal(findIds(text).length, 3);
  const r = runUuid(text, ctx());
  assert.equal(r.view?.kind, 'uuid');
  const d = r.view!.data as UuidData;
  assert.deepEqual(d.ids.map((i) => i.kind), ['uuid', 'ulid', 'uuid']);
  assert.equal(r.status, 'Decoded 3 ids');
  assert.match(r.output, /Version {9}1 — time-based/);
  const none = runUuid('hello there', ctx());
  assert.match(none.error!.message, /No UUID or ULID/);
});

test('sample decodes without error', () => {
  const s = runUuid(uuidMode.sample, ctx());
  assert.equal(s.error, undefined);
  assert.equal((s.view!.data as UuidData).ids.length, 3);
});
