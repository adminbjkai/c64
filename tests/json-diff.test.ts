import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignValues,
  applyJsonPatch,
  applyMergePatch,
  deepEqual,
  diffValues,
  escapeToken,
  formatChanges,
  joinPointer,
  normalize,
  parsePointer,
  stableHash,
  summarize,
  toJsonPatch,
  toMergePatch,
  type DiffOptions,
} from '../src/lib/structural-diff.js';
import { runJsonDiff, jsonDiffMode } from '../src/modes/json-diff.js';
import type { StructDiffData } from '../src/views/struct-diff.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true, inputB = '') => ({ pretty, options, inputB });
const ops = (cs: ReturnType<typeof diffValues>) => cs.map((c) => `${c.op} ${c.path}${c.from ? ' <- ' + c.from : ''}`);

/** applyJsonPatch(a, patch(diff(a, b))) must reproduce b. */
function roundTrip(a: unknown, b: unknown, opts: DiffOptions = {}): ReturnType<typeof diffValues> {
  const changes = diffValues(a, b, opts);
  const result = applyJsonPatch(normalize(a, opts), toJsonPatch(changes));
  assert.deepEqual(result, normalize(b, opts), `round trip failed for ${JSON.stringify(a)} → ${JSON.stringify(b)} (${JSON.stringify(opts)}): ${ops(changes).join('; ')}`);
  // With test ops too.
  assert.deepEqual(applyJsonPatch(normalize(a, opts), toJsonPatch(changes, { test: true })), normalize(b, opts));
  return changes;
}

test('pointers: escaping and parsing round-trip', () => {
  assert.equal(escapeToken('a/b~c'), 'a~1b~0c');
  assert.equal(joinPointer(['a/b', 'm~n', 0]), '/a~1b/m~0n/0');
  assert.deepEqual(parsePointer('/a~1b/m~0n/0'), ['a/b', 'm~n', '0']);
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/'), ['']);
  assert.throws(() => parsePointer('a'), /must start with/);
  const cs = diffValues({ 'a/b': { '~': 1 } }, { 'a/b': { '~': 2 } });
  assert.equal(cs[0]!.path, '/a~1b/~0');
});

test('deepEqual and stableHash ignore key order', () => {
  assert.ok(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!deepEqual([1, 2], [2, 1]));
  assert.equal(stableHash({ b: 1, a: [null, 'x'] }), stableHash({ a: [null, 'x'], b: 1 }));
});

test('normalize: trim, case, numeric strings, ignorePaths with wildcards', () => {
  assert.deepEqual(normalize({ b: ' X ', a: '12' }, { trimStrings: true, caseInsensitive: true, numericStrings: true }), { a: 12, b: 'x' });
  const v = { items: [{ id: 1, updatedAt: 'a' }, { id: 2, updatedAt: 'b' }], meta: { updatedAt: 'c', keep: 1 } };
  assert.deepEqual(normalize(v, { ignorePaths: ['/items/*/updatedAt', '/meta/updatedAt'] }), { items: [{ id: 1 }, { id: 2 }], meta: { keep: 1 } });
  // Ignored array items keep their slot as null so indices do not shift.
  assert.deepEqual(normalize([1, 2, 3], { ignorePaths: ['/1'] }), [1, null, 3]);
  assert.deepEqual(normalize({ b: 1, a: 2 }, { sortKeys: false }), { b: 1, a: 2 });
  assert.deepEqual(Object.keys(normalize({ b: 1, a: 2 }) as object), ['a', 'b']);
});

test('diffValues: objects — add, remove, value change, type change, nested', () => {
  const cs = diffValues({ a: 1, b: 'x', c: { d: [1] }, e: null }, { a: 2, c: { d: [1], f: true }, e: 'null', g: 0 });
  assert.deepEqual(ops(cs), ['replace /a', 'remove /b', 'add /c/f', 'replace /e', 'add /g']);
  assert.equal(cs.find((c) => c.path === '/a')!.kind, 'value');
  assert.equal(cs.find((c) => c.path === '/e')!.kind, 'type');
  assert.deepEqual(summarize(cs), { added: 2, removed: 1, changed: 1, typeChanges: 1, moved: 0 });
  assert.deepEqual(diffValues({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), []);
  assert.equal(diffValues(1, 'x')[0]!.path, '');
});

test('diffValues: index mode — extra items removed from the end, added in order', () => {
  const cs = roundTrip({ a: [1, 2, 3, 4] }, { a: [1, 9] }, { arrays: 'index' });
  assert.deepEqual(ops(cs), ['remove /a/3', 'remove /a/2', 'replace /a/1']);
  const cs2 = roundTrip([1], [1, 2, 3], { arrays: 'index' });
  assert.deepEqual(ops(cs2), ['add /1', 'add /2']);
  roundTrip({ a: [{ x: 1 }, { x: 2 }] }, { a: [{ x: 1, y: 1 }, { x: 3 }] });
});

test('diffValues: lcs mode — insertion at the front is one add, similar items recurse', () => {
  const cs = roundTrip([1, 2, 3], [0, 1, 2, 3], { arrays: 'lcs' });
  assert.deepEqual(ops(cs), ['add /0']);
  const cs2 = roundTrip([{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }], [{ id: 1, v: 'a' }, { id: 2, v: 'B' }, { id: 3, v: 'c' }], { arrays: 'lcs' });
  assert.deepEqual(ops(cs2), ['replace /1/v']);
  const cs3 = roundTrip(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'd'], { arrays: 'lcs' });
  assert.deepEqual(ops(cs3), ['replace /1', 'replace /2']);
  roundTrip(['a', 'b'], ['a', 'x', 'y', 'z', 'b'], { arrays: 'lcs' });
  roundTrip(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], { arrays: 'lcs' });
});

test('diffValues: lcs mode detects moves and the patch still applies', () => {
  const cs = roundTrip([1, 2, 3, 4], [2, 3, 4, 1], { arrays: 'lcs' });
  assert.deepEqual(ops(cs), ['move /3 <- /0']);
  assert.equal(summarize(cs).moved, 1);
  assert.deepEqual(ops(roundTrip([1, 2, 3, 4, 5], [3, 1, 2, 5, 4], { arrays: 'lcs' })).length, 2);
  const cs2 = roundTrip(['a', 'b', 'c'], ['c', 'a', 'b'], { arrays: 'lcs' });
  assert.deepEqual(ops(cs2), ['move /0 <- /2']);
  roundTrip(['a', 'b', 'c', 'd'], ['d', 'c', 'x', 'a'], { arrays: 'lcs' });
  roundTrip([{ k: 1 }, { k: 2 }, { k: 3 }], [{ k: 3 }, { k: 9 }, { k: 1 }, { k: 2 }], { arrays: 'lcs' });
  // Moves off: same input is a remove + add.
  const noMove = roundTrip([1, 2, 3, 4], [2, 3, 4, 1], { arrays: 'lcs', detectMoves: false });
  assert.ok(noMove.every((c) => c.op !== 'move'));
  const patch = toJsonPatch(cs);
  assert.deepEqual(patch, [{ op: 'move', from: '/0', path: '/3' }]);
});

test('diffValues: key mode matches by id, recurses, reports reorders as moves', () => {
  const a = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 3, n: 'c' }];
  const b = [{ id: 3, n: 'c' }, { id: 1, n: 'A' }, { id: 4, n: 'd' }];
  const cs = roundTrip(a, b, { arrays: 'key', keyFields: ['id'] });
  assert.equal(cs.length, 4);
  assert.equal(ops(cs)[0], 'remove /1');
  assert.equal(summarize(cs).moved, 1);
  assert.ok(ops(cs).includes('replace /1/n') && ops(cs).includes('add /2'));
  // Compound key and items without the key field fall back to value identity.
  roundTrip([{ a: 1, b: 1, v: 1 }, { a: 1, b: 2, v: 2 }, 'x'], [{ a: 1, b: 2, v: 3 }, 'x', { a: 1, b: 1, v: 1 }], { arrays: 'key', keyFields: ['a', 'b'] });
});

test('diffValues: set mode ignores order and counts multiplicity', () => {
  assert.deepEqual(diffValues([1, 2, 3], [3, 1, 2], { arrays: 'set' }), []);
  const cs = diffValues({ t: ['a', 'b', 'b'] }, { t: ['b', 'c'] }, { arrays: 'set' });
  assert.deepEqual(ops(cs), ['remove /t/2', 'remove /t/0', 'add /t/1']);
  const applied = applyJsonPatch({ t: ['a', 'b', 'b'] }, toJsonPatch(cs)) as { t: string[] };
  assert.deepEqual([...applied.t].sort(), ['b', 'c']);
  assert.equal(alignValues([1, 2], [2, 1], { arrays: 'set' }).status, 'eq');
});

test('applyJsonPatch: RFC 6902 appendix examples and error attribution', () => {
  assert.deepEqual(applyJsonPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux' }]), { foo: 'bar', baz: 'qux' });
  assert.deepEqual(applyJsonPatch({ foo: ['bar', 'baz'] }, [{ op: 'add', path: '/foo/1', value: 'qux' }]), { foo: ['bar', 'qux', 'baz'] });
  assert.deepEqual(applyJsonPatch({ foo: ['bar'] }, [{ op: 'add', path: '/foo/-', value: 'x' }]), { foo: ['bar', 'x'] });
  assert.deepEqual(applyJsonPatch({ baz: 'qux', foo: 'bar' }, [{ op: 'remove', path: '/baz' }]), { foo: 'bar' });
  assert.deepEqual(applyJsonPatch({ foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } }, [{ op: 'move', from: '/foo/waldo', path: '/qux/thud' }]), {
    foo: { bar: 'baz' },
    qux: { corge: 'grault', thud: 'fred' },
  });
  assert.deepEqual(applyJsonPatch({ foo: ['all', 'grass', 'cows', 'eat'] }, [{ op: 'move', from: '/foo/1', path: '/foo/3' }]), { foo: ['all', 'cows', 'eat', 'grass'] });
  assert.deepEqual(applyJsonPatch({ a: { b: 1 } }, [{ op: 'copy', from: '/a', path: '/c' }, { op: 'test', path: '/c/b', value: 1 }]), { a: { b: 1 }, c: { b: 1 } });
  assert.deepEqual(applyJsonPatch({ '/': 1, 'm~n': 2 }, [{ op: 'replace', path: '/~1', value: 9 }, { op: 'remove', path: '/m~0n' }]), { '/': 9 });
  assert.deepEqual(applyJsonPatch({ a: 1 }, [{ op: 'replace', path: '', value: [1] }]), [1]);
  // The source document is not mutated.
  const src = { a: [1] };
  applyJsonPatch(src, [{ op: 'add', path: '/a/-', value: 2 }]);
  assert.deepEqual(src, { a: [1] });
  const fails = (doc: unknown, patch: unknown, index: number, re: RegExp) => {
    try {
      applyJsonPatch(doc, patch);
      assert.fail('expected throw');
    } catch (e) {
      const err = e as { index: number; message: string };
      assert.equal(err.index, index, err.message);
      assert.match(err.message, re);
    }
  };
  fails({ a: 1 }, [{ op: 'add', path: '/b', value: 1 }, { op: 'remove', path: '/zzz' }], 1, /does not exist/);
  fails({ a: [1] }, [{ op: 'add', path: '/a/5', value: 1 }], 0, /out of range/);
  fails({ a: [1] }, [{ op: 'add', path: '/a/01', value: 1 }], 0, /not an array index/);
  fails({ a: 1 }, [{ op: 'test', path: '/a', value: 2 }], 0, /expected 2/);
  fails({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b' }], 0, /own child/);
  fails({ a: 1 }, [{ op: 'frob', path: '/a' }], 0, /unknown op/);
  fails({ a: 1 }, { op: 'add' }, -1, /must be an array/);
});

test('merge patch: RFC 7386 examples', () => {
  const doc = { a: 'b', c: { d: 'e', f: 'g' } };
  assert.deepEqual(applyMergePatch(doc, { a: 'z', c: { f: null } }), { a: 'z', c: { d: 'e' } });
  assert.deepEqual(doc, { a: 'b', c: { d: 'e', f: 'g' } }); // untouched
  assert.deepEqual(applyMergePatch({ a: [1, 2] }, { a: [3] }), { a: [3] });
  assert.deepEqual(applyMergePatch({ a: 'b' }, { a: { b: 'c' } }), { a: { b: 'c' } });
  assert.deepEqual(applyMergePatch({ a: 'b' }, ['x']), ['x']);
  assert.deepEqual(applyMergePatch({ e: null }, { a: 1 }), { e: null, a: 1 });
  assert.deepEqual(applyMergePatch([1, 2], { a: 'b' }), { a: 'b' });
  assert.deepEqual(applyMergePatch({}, { a: { bb: { ccc: null } } }), { a: { bb: {} } });
  const a = { title: 'Goodbye!', author: { givenName: 'John', familyName: 'Doe' }, tags: ['example', 'sample'], content: 'This will be unchanged' };
  const b = { title: 'Hello!', author: { givenName: 'John' }, tags: ['example'], content: 'This will be unchanged', phoneNumber: '+01-123-456-7890' };
  const patch = toMergePatch(a, b);
  assert.deepEqual(patch, { title: 'Hello!', phoneNumber: '+01-123-456-7890', author: { familyName: null }, tags: ['example'] });
  assert.deepEqual(applyMergePatch(a, patch), b);
  assert.deepEqual(toMergePatch({ a: 1 }, { a: 1 }), {});
});

test('formatChanges produces one readable line per change', () => {
  const cs = diffValues({ a: 1, d: 2, e: '1', arr: [1, 2] }, { a: 2, c: { x: 1 }, e: 1, arr: [2, 1] }, { arrays: 'lcs' });
  const text = formatChanges(cs);
  assert.match(text, /^~ \/a: 1 → 2$/m);
  assert.match(text, /^\+ \/c: \{"x":1\}$/m);
  assert.match(text, /^- \/d: 2$/m);
  assert.match(text, /^! \/e: "1" → 1 \(string → number\)$/m);
  assert.match(text, /^> \/arr\/[01] ← \/arr\/[01]$/m);
});

test('alignValues: tree with statuses and change counts, equal subtrees are leaves', () => {
  const t = alignValues({ a: 1, b: { c: [1, 2] }, d: 'x', e: 1 }, { a: 2, b: { c: [1, 2] }, e: '1', f: null });
  assert.equal(t.status, 'chg');
  assert.equal(t.changes, 4);
  const by = Object.fromEntries(t.children!.map((n) => [n.key, n]));
  assert.equal(by['a']!.status, 'chg');
  assert.equal(by['b']!.status, 'eq');
  assert.equal(by['b']!.children, undefined);
  assert.equal(by['d']!.status, 'del');
  assert.equal(by['e']!.status, 'type');
  assert.equal(by['f']!.status, 'add');
  const arr = alignValues([1, 2, 3, 4], [2, 3, 4, 1], { arrays: 'lcs' });
  const moved = arr.children!.find((n) => n.status === 'move')!;
  assert.equal(moved.path, '/3');
  assert.equal(moved.from, '/0');
  assert.equal(arr.children!.filter((n) => n.status === 'eq').length, 3);
});

test('mode: sample shows add, remove, change, type change and an array change', () => {
  const r = runJsonDiff(jsonDiffMode.sample, ctx({}, true, jsonDiffMode.sampleB!));
  assert.equal(r.error, undefined);
  const d = r.view!.data as StructDiffData;
  assert.equal(r.view!.kind, 'struct-diff');
  assert.ok(d.summary.added >= 1 && d.summary.removed >= 1 && d.summary.changed >= 1 && d.summary.typeChanges >= 1);
  assert.ok(d.changes.some((c) => c.path.startsWith('/tags/')));
  assert.match(r.status!, /^\d+ changed · \d+ added · \d+ removed/);
  assert.match(r.output, /^~ \/name: "Widget" → "Widget Pro"$/m);
  assert.equal(d.onlyChanges, true);
  // Raw = JSON Patch that applies.
  const raw = runJsonDiff(jsonDiffMode.sample, ctx({}, false, jsonDiffMode.sampleB!));
  const patch = JSON.parse(raw.output);
  assert.deepEqual(applyJsonPatch(JSON.parse(jsonDiffMode.sample), patch), JSON.parse(jsonDiffMode.sampleB!));
  assert.equal(typeof jsonDiffMode.outputLanguage === 'function' ? jsonDiffMode.outputLanguage(ctx({}, false)) : null, 'json');
});

test('mode: controls are honoured (arrays, keyFields, ignoreCase, trim, numericStrings, ignorePaths, onlyChanges)', () => {
  const a = '{"items":[{"id":1,"n":"a","t":1},{"id":2,"n":"b","t":2}],"s":" Hello ","v":"5"}';
  const b = '{"items":[{"id":2,"n":"b","t":3},{"id":1,"n":"a","t":4}],"s":"hello","v":5}';
  const strict = runJsonDiff(a, ctx({}, true, b));
  assert.ok(summarize((strict.view!.data as StructDiffData).changes).changed >= 4);
  const lenient = runJsonDiff(a, ctx({ arrays: 'key', keyFields: 'id', ignoreCase: true, trimStrings: true, numericStrings: true, ignorePaths: '/items/*/t', onlyChanges: false }, true, b));
  const d = lenient.view!.data as StructDiffData;
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0]!.op, 'move');
  assert.equal(d.onlyChanges, false);
  assert.match(lenient.status!, /1 moved/);
  const same = runJsonDiff('{"a":1}', ctx({}, true, '{"a": 1 }'));
  assert.equal(same.status, 'Identical');
  assert.ok(same.notes!.some((n) => /identical/i.test(n)));
});

test('mode: empty input, one-sided input and parse errors are attributed to a side', () => {
  assert.deepEqual(runJsonDiff('', ctx()), { output: '', status: '' });
  assert.match(runJsonDiff('{}', ctx({}, true, ''))!.error!.message, /^Changed: nothing/);
  assert.match(runJsonDiff('', ctx({}, true, '{}'))!.error!.message, /^Original: nothing/);
  const bad = runJsonDiff('{"a": [1, 2}', ctx({}, true, '{}'));
  assert.match(bad.error!.message, /^Original: /);
  assert.equal(bad.error!.line, 1);
  assert.ok(bad.error!.col! > 1);
  const badB = runJsonDiff('{}', ctx({}, true, '{\n  "a": tru\n}'));
  assert.match(badB.error!.message, /^Changed: /);
  assert.equal(badB.error!.line, 2);
  assert.match(badB.status!, /Changed/);
});
