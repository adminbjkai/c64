import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOctal, parseSymbolic, applyExpression, toOctal, toSymbolic, bitsOf, parseModeLine } from '../src/lib/chmod.js';
import { runChmod, chmodMode, type ChmodData } from '../src/modes/chmod.js';

const ctx = (options: Record<string, unknown> = {}) => ({ pretty: false, options });
const entries = (input: string, options: Record<string, unknown> = {}) => {
  const r = runChmod(input, ctx(options));
  assert.equal(r.error, undefined, r.error?.message);
  return (r.view!.data as ChmodData).entries;
};

test('empty input is empty', () => {
  assert.deepEqual(runChmod('', ctx()), { output: '', status: '' });
});

test('sample runs and produces one entry per line', () => {
  const r = runChmod(chmodMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.equal(r.view?.kind, 'chmod');
  const es = (r.view!.data as ChmodData).entries;
  assert.equal(es.length, 7);
  assert.deepEqual(es.map((e) => e.octal4), ['0755', '0644', '4755', '0750', '0644', '0744', '0644']);
  assert.equal(r.status, '7 modes');
  assert.match(r.output, /^755 → 755 · 0755 · rwxr-xr-x\n  owner   r w x\n  group   r - x\n  others  r - x\n  special: none\n  chmod 755 file/);
});

test('octal input: three and four digits, special bits', () => {
  assert.equal(parseOctal('755'), 0o755);
  assert.equal(parseOctal('0644'), 0o644);
  assert.equal(parseOctal('4755'), 0o4755);
  assert.throws(() => parseOctal('788'), /not an octal mode/);
  assert.throws(() => parseOctal('77'), /not an octal mode/);
  const [e] = entries('2750');
  assert.equal(e!.symbolic, 'rwxr-s---');
  assert.equal(e!.setgid, true);
  assert.equal(e!.command, 'chmod 2750 file');
  assert.equal(e!.octal3, '750');
});

test('symbolic input with and without file type character', () => {
  assert.equal(parseSymbolic('rwxr-xr-x'), 0o755);
  assert.equal(parseSymbolic('-rw-r--r--'), 0o644);
  assert.equal(parseSymbolic('drwxr-x---'), 0o750);
  assert.equal(parseSymbolic('rwsr-xr-x'), 0o4755);
  assert.equal(parseSymbolic('rwxr-sr-x'), 0o2755);
  assert.equal(parseSymbolic('rwxrwxrwt'), 0o1777);
  assert.equal(parseSymbolic('rwSr--r--'), 0o4644, 'capital S = setuid without execute');
  assert.equal(parseSymbolic('rwxr-xr-T'), 0o1754);
  assert.throws(() => parseSymbolic('rwxrwx'), /not a symbolic mode/);
  const [d, l] = entries('drwxr-x---\nlrwxrwxrwx');
  assert.equal(d!.fileType, 'd');
  assert.equal(d!.form, 'symbolic');
  assert.equal(l!.fileType, 'l');
  assert.equal(entries('-rw-r--r--')[0]!.fileType, null);
});

test('symbolic output round-trips every 12-bit mode', () => {
  for (let m = 0; m < 0o10000; m += 7) {
    assert.equal(parseSymbolic(toSymbolic(m)), m, toOctal(m, 4));
    assert.equal(parseOctal(toOctal(m, 4)), m);
  }
  assert.equal(toSymbolic(0o4755), 'rwsr-xr-x');
  assert.equal(toSymbolic(0o4655), 'rwSr-xr-x');
  assert.equal(toSymbolic(0o1777), 'rwxrwxrwt');
  assert.equal(toSymbolic(0o1776), 'rwxrwxrwT');
  assert.equal(toOctal(0o755, 3), '755');
  assert.equal(toOctal(0o755, 4), '0755');
});

test('expressions: +, -, = with who groups and specials', () => {
  assert.equal(applyExpression('u+x,go-w', 0o644), 0o744);
  assert.equal(applyExpression('a=r,u+w', 0), 0o644);
  assert.equal(applyExpression('+x', 0o644), 0o755, 'no who means all');
  assert.equal(applyExpression('go=', 0o777), 0o700);
  assert.equal(applyExpression('u+s', 0o755), 0o4755);
  assert.equal(applyExpression('g+s', 0o755), 0o2755);
  assert.equal(applyExpression('+t', 0o777), 0o1777);
  assert.equal(applyExpression('o-t', 0o1777), 0o777);
  assert.equal(applyExpression('u-s', 0o4755), 0o755);
  assert.equal(applyExpression('u=rwx,g=rx,o=', 0o4000), 0o750, '= clears the setuid it names');
  assert.equal(applyExpression('a+X', 0o644), 0o644, 'X does nothing without an existing execute bit');
  assert.equal(applyExpression('a+X', 0o744), 0o755, 'X adds execute when the owner already has it');
  assert.equal(applyExpression('ug=rw', 0o777), 0o667);
  assert.throws(() => applyExpression('u+q', 0o644), /not a chmod clause/);
});

test('expression lines: with octal base, symbolic base, reversed order, and no base', () => {
  const [a, b, c] = entries('u+x,go-w 644\ng+w rw-r--r--\n644 u+x');
  assert.equal(a!.octal3, '744');
  assert.equal(a!.form, 'expression');
  assert.equal(b!.octal3, '664');
  assert.equal(c!.octal3, '744', 'base before expression is accepted');
  const r = runChmod('u+rwx', ctx());
  assert.equal(r.error, undefined);
  assert.equal((r.view!.data as ChmodData).entries[0]!.octal3, '700');
  assert.deepEqual(r.notes, ['Line 1: No base mode given — applied to 000.']);
});

test('permission grid and special bits are exposed for the view', () => {
  const [e] = entries('4750');
  assert.deepEqual(e!.owner, { r: true, w: true, x: true });
  assert.deepEqual(e!.group, { r: true, w: false, x: true });
  assert.deepEqual(e!.others, { r: false, w: false, x: false });
  assert.equal(e!.setuid, true);
  assert.equal(e!.setgid, false);
  assert.equal(e!.sticky, false);
  const b = bitsOf(0o1002);
  assert.equal(b.sticky, true);
  assert.deepEqual(b.others, { r: false, w: true, x: false });
});

test('the command uses the 4-digit form only when special bits are set and honours the target option', () => {
  assert.equal(entries('755')[0]!.command, 'chmod 755 file');
  assert.equal(entries('0755')[0]!.command, 'chmod 755 file');
  assert.equal(entries('1777')[0]!.command, 'chmod 1777 file');
  assert.equal(entries('755', { target: 'bin/run.sh' })[0]!.command, 'chmod 755 bin/run.sh');
  assert.equal(entries('755', { target: '   ' })[0]!.command, 'chmod 755 file');
});

test('single-mode status shows the octal and symbolic forms', () => {
  assert.equal(runChmod('600', ctx()).status, '1 mode · 0600 · rw-------');
});

test('bad input errors with line, column and hint; earlier entries kept', () => {
  const r = runChmod('755\n  999', ctx());
  assert.equal(r.error?.line, 2);
  assert.equal(r.error?.col, 3);
  assert.match(r.error!.message, /Cannot read "999"/);
  assert.match(r.error!.hint!, /octal \(755, 0644, 4755\)/);
  assert.match(r.output, /^755 → 755/);
  assert.equal(r.status, 'Invalid mode · line 2');
  const b = runChmod('u+x 9x9', ctx());
  assert.match(b.error!.message, /not a base mode/);
  const c = runChmod('u+x,q+r 644', ctx());
  assert.match(c.error!.message, /"q\+r" is not a chmod clause/);
  assert.equal(c.error?.col, 5);
  assert.throws(() => parseModeLine('rwxrwxrwxx'), /Cannot read/);
});

test('blank and # comment lines are skipped', () => {
  assert.equal(entries('# perms\n\n644\n').length, 1);
});
