import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBaseN, baseNMode, parseNumber } from '../src/modes/base-n.js';
import type { BaseNData } from '../src/modes/base-n.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });

test('auto-detects prefixes and separators', () => {
  assert.equal(parseNumber('0xff', 'auto').value, 255n);
  assert.equal(parseNumber('0b1111_1111', 'auto').value, 255n);
  assert.equal(parseNumber('0o377', 'auto').value, 255n);
  assert.equal(parseNumber('1_000_000', 'auto').value, 1000000n);
  assert.equal(parseNumber('-0x10', 'auto').value, -16n);
  assert.equal(parseNumber('ff', 'auto').radix, 16);
});

test('all-bases table view and tab-separated text', () => {
  const r = runBaseN('255', ctx());
  assert.equal(r.view?.kind, 'basen');
  const d = r.view!.data as BaseNData;
  assert.equal(d.rows.length, 1);
  assert.deepEqual([d.rows[0]!.dec, d.rows[0]!.hex, d.rows[0]!.oct, d.rows[0]!.bin, d.rows[0]!.base36], ['255', 'ff', '377', '11111111', '73']);
  assert.equal(r.output.split('\n')[1], '255\t255\tff\t377\t11111111');
});

test('single target base and explicit source base', () => {
  assert.equal(runBaseN('255', ctx({ to: '2' })).output, '11111111');
  assert.equal(runBaseN('11111111', ctx({ from: '2', to: '10' })).output, '255');
  assert.equal(runBaseN('777', ctx({ from: '8', to: '16' })).output, '1ff');
  assert.equal(runBaseN('zz', ctx({ from: '36', to: '10' })).output, '1295');
  assert.equal(runBaseN('255', ctx({ to: '16', uppercase: true })).output, 'FF');
});

test('BigInt handles huge and negative values', () => {
  const r = runBaseN('-18446744073709551616', ctx({ to: '16' }));
  assert.equal(r.output, '-10000000000000000');
  const big = runBaseN('0x' + 'f'.repeat(64), ctx({ to: '10' }));
  assert.equal(big.output, (2n ** 256n - 1n).toString());
});

test('invalid digit reports line/col and hint', () => {
  const r = runBaseN('255\n0x12g4', ctx());
  assert.equal(r.error!.message, "'g' is not a hexadecimal digit.");
  assert.equal(r.error!.line, 2);
  assert.equal(r.error!.col, 5);
  assert.ok(r.error!.hint);
  const dec = runBaseN('12a', ctx({ from: '10' }));
  assert.match(dec.error!.message, /'a' is not a decimal digit/);
  const conflict = runBaseN('0xff', ctx({ from: '2' }));
  assert.match(conflict.error!.message, /Prefix/);
});

test('empty input, blank lines skipped, sample runs', () => {
  assert.deepEqual(runBaseN('', ctx()), { output: '', status: '' });
  assert.deepEqual(runBaseN('  \n\n', ctx()), { output: '', status: '' });
  const r = runBaseN('1\n\n2\n', ctx());
  assert.equal((r.view!.data as BaseNData).rows.length, 2);
  const s = runBaseN(baseNMode.sample, ctx());
  assert.equal(s.error, undefined);
  assert.match(s.status!, /5 numbers/);
});
