import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusParts, plural, facts } from '../src/views/ui.js';
import { groupCode } from '../src/views/totp.js';

test('statusParts splits "Verdict — fact, fact" per the status grammar', () => {
  assert.deepEqual(statusParts('Valid JSON — object, 6 keys, 408 B'), { verdict: 'Valid JSON', facts: ['object', '6 keys', '408 B'] });
  assert.deepEqual(statusParts('Hashed — 43 bytes, hex'), { verdict: 'Hashed', facts: ['43 bytes', 'hex'] });
  assert.deepEqual(statusParts('Running…'), { verdict: 'Running…', facts: [] });
  assert.deepEqual(statusParts('  Empty —  '), { verdict: 'Empty', facts: [] });
});

test('plural uses the singular for exactly one and locale-formats counts', () => {
  assert.equal(plural(1, 'match', 'matches'), '1 match');
  assert.equal(plural(0, 'match', 'matches'), '0 matches');
  assert.equal(plural(1200, 'byte'), '1,200 bytes');
  assert.equal(plural(2, 'error'), '2 errors');
});

test('facts joins with commas, never a middle dot, and drops empties', () => {
  assert.equal(facts('line 3', null, 'alpha 0.50', false, ''), 'line 3, alpha 0.50');
  assert.equal(facts(), '');
  assert.ok(!facts('a', 'b').includes('·'));
});

test('groupCode splits 6- and 8-digit codes and leaves others alone', () => {
  assert.equal(groupCode('123456'), '123 456');
  assert.equal(groupCode('12345678'), '1234 5678');
  assert.equal(groupCode('1234567'), '1234567');
});
