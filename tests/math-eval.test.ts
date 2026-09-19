import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateLines, formatValue, tokenize } from '../src/lib/math.js';
import { runMathEval, mathEvalMode } from '../src/modes/math-eval.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });
const ev = (s: string) => evaluate(s);

test('precedence and associativity', () => {
  assert.equal(ev('1 + 2 * 3'), 7n);
  assert.equal(ev('(1 + 2) * 3'), 9n);
  assert.equal(ev('10 - 4 - 3'), 3n);
  assert.equal(ev('100 / 10 / 2'), 5n);
  assert.equal(ev('2 ^ 3 ^ 2'), 512n); // right-assoc: 2^(3^2)
  assert.equal(ev('-2 ^ 2'), -4n);
  assert.equal(ev('2 ^ -1'), 0.5);
  assert.equal(ev('7 % 3'), 1n);
  assert.equal(ev('2 * -3'), -6n);
  assert.equal(ev('+5'), 5n);
});

test('number literals: hex, binary, octal, underscores, exponent, decimals', () => {
  assert.equal(ev('0xff'), 255n);
  assert.equal(ev('0b1010'), 10n);
  assert.equal(ev('0o17'), 15n);
  assert.equal(ev('1_000_000 + 1'), 1000001n);
  assert.equal(ev('1e3'), 1000);
  assert.equal(ev('2.5e-1'), 0.25);
  assert.equal(ev('.5 + .25'), 0.75);
  assert.equal(ev('0xff + 0b1010 + 0o17'), 280n);
  assert.throws(() => ev('1__0'), /underscore/);
  assert.throws(() => ev('0x'), /Incomplete number/);
});

test('BigInt exactness for integer-only expressions', () => {
  assert.equal(ev('2^100'), 1267650600228229401496703205376n);
  assert.equal(ev('fact(30)'), 265252859812191058636308480000000n);
  assert.equal(ev('2^64 - 1'), 18446744073709551615n);
  assert.equal(ev('123456789 * 987654321'), 121932631112635269n);
  assert.equal(ev('2^100 % 7'), 2n);
  assert.equal(formatValue(ev('2^100')), '1267650600228229401496703205376');
});

test('float fallback: division, fractions, sqrt', () => {
  assert.equal(ev('10 / 4'), 2.5);
  assert.equal(ev('10 / 5'), 2n);
  assert.equal(ev('1.5 * 2'), 3);
  assert.equal(typeof ev('2 ^ 0.5'), 'number');
  assert.equal(ev('sqrt(16)'), 4);
  assert.equal(formatValue(ev('0.1 + 0.2')), '0.3');
  assert.equal(formatValue(ev('1 / 3')), '0.333333333333');
});

test('functions', () => {
  assert.equal(ev('abs(-5)'), 5n);
  assert.equal(ev('abs(-2.5)'), 2.5);
  assert.equal(ev('floor(2.7) + ceil(2.1) + trunc(-2.7)'), 3);
  assert.equal(ev('round(2.567, 2)'), 2.57);
  assert.equal(ev('round(2.5)'), 3);
  assert.equal(ev('sign(-3)'), -1n);
  assert.equal(ev('min(3, 1, 2)'), 1n);
  assert.equal(ev('max(3, 1, 2)'), 3n);
  assert.equal(ev('sum(1, 2, 3, 4)'), 10n);
  assert.equal(ev('avg(1, 2, 3, 4)'), 2.5);
  assert.equal(ev('pow(2, 10)'), 1024n);
  assert.equal(ev('exp(0)'), 1);
  assert.equal(ev('log(e)'), 1);
  assert.equal(ev('log2(1024)'), 10);
  assert.equal(ev('log10(1000)'), 3);
  assert.equal(ev('sin(0) + cos(0)'), 1);
  assert.ok(Math.abs((ev('tan(pi / 4)') as number) - 1) < 1e-12);
  assert.ok(Math.abs((ev('asin(1) + acos(1) + atan(0)') as number) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs((ev('atan2(1, 1)') as number) - Math.PI / 4) < 1e-12);
  assert.equal(ev('hypot(3, 4)'), 5);
  assert.equal(ev('gcd(1071, 462)'), 21n);
  assert.equal(ev('lcm(4, 6)'), 12n);
  assert.equal(ev('fact(5)'), 120n);
  assert.equal(ev('cbrt(27)'), 3);
});

test('constants and variables', () => {
  assert.ok(Math.abs((ev('pi') as number) - Math.PI) < 1e-15);
  assert.ok(Math.abs((ev('2 * pi') as number) - 2 * Math.PI) < 1e-15);
  const rs = evaluateLines('x = 5\ny = x * 2\nx + y');
  assert.equal(rs.length, 3);
  assert.equal(rs[0]!.name, 'x');
  assert.equal(rs[0]!.value, 5n);
  assert.equal(rs[1]!.value, 10n);
  assert.equal(rs[2]!.value, 15n);
});

test('ans refers to the previous result', () => {
  const rs = evaluateLines('10\nans * 2\nans + 1');
  assert.deepEqual(rs.map((r) => r.value), [10n, 20n, 21n]);
  const r = evaluateLines('ans');
  assert.match(r[0]!.error!.message, /Unknown variable "ans"/);
});

test('percent', () => {
  assert.equal(ev('200 * 15%'), 30);
  assert.equal(ev('50%'), 0.5);
  assert.equal(ev('10 % 3'), 1n); // modulo when an operand follows
  assert.equal(ev('(10 % 4) * 100%'), 2);
  assert.equal(evaluateLines('price = 199.99\ntax = price * 8.25%')[1]!.value, 199.99 * 0.0825);
});

test('errors carry column and hint; a bad line does not stop the others', () => {
  const rs = evaluateLines('1 + 2\n2 +\nfoo * 2\n3 * 4\n(1 + 2\n5 / 0\n1 $ 2\n  2 2');
  assert.equal(rs[0]!.value, 3n);
  assert.match(rs[1]!.error!.message, /ends with an operator/);
  assert.equal(rs[1]!.error!.col, 4);
  assert.match(rs[2]!.error!.message, /Unknown variable "foo"/);
  assert.equal(rs[2]!.error!.col, 1);
  assert.match(rs[2]!.error!.hint!, /Define it on an earlier line/);
  assert.equal(rs[3]!.value, 12n);
  assert.match(rs[4]!.error!.message, /Unmatched "\("/);
  assert.equal(rs[4]!.error!.col, 1);
  assert.match(rs[5]!.error!.message, /Division by zero/);
  assert.match(rs[6]!.error!.message, /Unexpected character '\$'/);
  assert.equal(rs[6]!.error!.col, 3);
  assert.match(rs[7]!.error!.message, /Unexpected number "2"/);
  assert.equal(rs[7]!.error!.col, 5); // leading whitespace counted
  assert.match(rs[7]!.error!.hint!, /forget an operator/);
});

test('more error paths: unknown function, wrong arity, reserved names, bare function name', () => {
  assert.throws(() => ev('nope(1)'), /Unknown function nope\(\)/);
  assert.throws(() => ev('sqrt(1, 2)'), /takes 1 argument/);
  assert.throws(() => ev('gcd(1)'), /at least 2/);
  assert.throws(() => ev('sqrt'), /is a function/);
  assert.throws(() => ev('1 +* 2'), /Missing operand before "\*"/);
  assert.throws(() => ev('1 2'), /Unexpected number/);
  assert.throws(() => ev('2 (3)'), (e: unknown) => /Unexpected "\("/.test((e as Error).message) && /Implicit multiplication/.test((e as { hint: string }).hint));
  assert.throws(() => ev('1 + 2)'), /Unmatched "\)"/);
  assert.throws(() => ev('fact(-1)'), /non-negative integer/);
  assert.throws(() => ev('2 ^ 1000000 ^ 2'), /too large/);
  assert.match(evaluateLines('pi = 3')[0]!.error!.message, /reserved/);
  assert.match(evaluateLines('1 = 2')[0]!.error!.message, /Unexpected character '='/);
});

test('tokenizer distinguishes modulo from percent and accepts unicode operators', () => {
  assert.deepEqual(tokenize('10 % 3').map((t) => t.type), ['num', 'op', 'num']);
  assert.deepEqual(tokenize('10% * 3').map((t) => t.type), ['num', 'percent', 'op', 'num']);
  assert.equal(ev('6 × 7 ÷ 2 − 1'), 20n);
});

test('formats: auto, fixed2, scientific, hex, binary', () => {
  assert.equal(formatValue(255n, 'hex'), '0xff');
  assert.equal(formatValue(-255n, 'hex'), '-0xff');
  assert.equal(formatValue(10n, 'binary'), '0b1010');
  assert.equal(formatValue(255, 'hex'), '0xff');
  assert.equal(formatValue(2.5, 'hex'), '2.5');
  assert.equal(formatValue(2.5, 'fixed2'), '2.50');
  assert.equal(formatValue(7n, 'fixed2'), '7.00');
  assert.equal(formatValue(123456n, 'scientific'), '1.234560e+5');
  assert.equal(formatValue(1e21, 'auto'), '1e+21');
  assert.equal(runMathEval('255', ctx({ format: 'hex' })).output, '255 = 0xff');
  assert.equal(runMathEval('255', ctx({ format: 'binary' }, false)).output, '0b11111111');
  assert.equal(runMathEval('1/3', ctx({ format: 'fixed2' }, false)).output, '0.33');
  assert.equal(runMathEval('1/3', ctx({ format: 'nope' }, false)).output, '0.333333333333');
});

test('mode: sample runs, Pretty vs Raw, total note, status', () => {
  const s = runMathEval(mathEvalMode.sample, ctx());
  assert.equal(s.error, undefined);
  assert.match(s.output, /^price = 199\.99\n/);
  assert.match(s.output, /\n2\^100 = 1267650600228229401496703205376\n/);
  assert.match(s.output, /\nfact\(25\) = 15511210043330985984000000\n/);
  assert.match(s.output, /\ngcd\(1071, 462\) = 21\n/);
  assert.match(s.output, /\n0xff \+ 0b1010 \+ 0o17 = 280\n/);
  assert.match(s.output, /\nhypot\(3, 4\) \+ sqrt\(16\) = 9\n/);
  assert.match(s.output, /\nmax\(1, 2, 3\) \* min\(4, 5\) = 12$/);
  assert.match(s.status!, /^10 expressions · auto$/);
  assert.match(s.notes![0]!, /^Total of all results: /);
  const raw = runMathEval('1 + 1\n2 * 3', ctx({}, false));
  assert.equal(raw.output, '2\n6');
  assert.deepEqual(raw.notes, ['Total of all results: 8 (exact)', 'Integer-only lines are computed exactly with BigInt.']);
  assert.equal(runMathEval('x = 2 + 2', ctx()).output, 'x = 4');
});

test('mode: empty input, comments only, and error reporting with line/col', () => {
  assert.deepEqual(runMathEval('', ctx()), { output: '', status: '' });
  assert.equal(runMathEval('# just a comment', ctx()).status, 'Only comments');
  const r = runMathEval('1 + 1\n2 +\n3 * 3', ctx());
  assert.equal(r.output, '1 + 1 = 2\n2 + = ✗ Expression ends with an operator.\n3 * 3 = 9');
  assert.equal(r.error?.line, 2);
  assert.equal(r.error?.col, 4);
  assert.match(r.status!, /^3 expressions · 1 error · auto$/);
  const raw = runMathEval('1 + 1\n2 +', ctx({}, false));
  assert.equal(raw.output, '2\n✗ Expression ends with an operator.');
});
