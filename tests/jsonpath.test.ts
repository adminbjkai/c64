import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryJsonPath, formatPath, JsonPathError } from '../src/lib/jsonpath.js';

const store = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'LOTR', isbn: '0-395', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
};

const values = (root: unknown, expr: string) => queryJsonPath(root, expr).map((m) => m.value);
const paths = (root: unknown, expr: string) => queryJsonPath(root, expr).map((m) => formatPath(m.path));

/** Assert that `expr` throws a JsonPathError at `col` (and has a hint when `hint` is true). */
function assertError(expr: string, col: number, hint = true) {
  assert.throws(
    () => queryJsonPath(store, expr),
    (e: unknown) => {
      assert.ok(e instanceof JsonPathError, `expected JsonPathError for ${expr}`);
      assert.equal(e.col, col, `col for ${expr}: ${e.message}`);
      assert.equal(e.line, 1);
      if (hint) assert.ok(e.hint && e.hint.length > 0, `hint for ${expr}`);
      return true;
    },
  );
}

test('root returns the whole document with an empty path', () => {
  assert.deepEqual(queryJsonPath(store, '$'), [{ path: [], value: store }]);
});

test('dot and bracket child access (both quote styles)', () => {
  assert.deepEqual(values(store, '$.store.bicycle.color'), ['red']);
  assert.deepEqual(values(store, "$['store']['bicycle']['color']"), ['red']);
  assert.deepEqual(values(store, '$["store"]["bicycle"].color'), ['red']);
  assert.deepEqual(values({ 'my key': 1 }, "$['my key']"), [1]);
  assert.deepEqual(values({ "it's": 2 }, "$['it\\'s']"), [2]);
});

test('missing members and type mismatches yield no matches', () => {
  assert.deepEqual(values(store, '$.nope'), []);
  assert.deepEqual(values(store, '$.store.book.title'), []);
  assert.deepEqual(values(store, '$.store.bicycle[0]'), []);
  assert.deepEqual(values(null, '$.a'), []);
});

test('array index, including negative indices and out-of-range', () => {
  assert.deepEqual(values(store, '$.store.book[0].title'), ['Sayings']);
  assert.deepEqual(values(store, '$.store.book[-1].title'), ['LOTR']);
  assert.deepEqual(values(store, '$.store.book[-4].title'), ['Sayings']);
  assert.deepEqual(values(store, '$.store.book[4]'), []);
  assert.deepEqual(values(store, '$.store.book[-5]'), []);
  assert.deepEqual(queryJsonPath(store, '$.store.book[-1]')[0]?.path, ['store', 'book', 3]);
});

test('wildcards: [*] and .* over arrays and objects', () => {
  assert.deepEqual(values(store, '$.store.book[*].price'), [8.95, 12.99, 8.99, 22.99]);
  assert.deepEqual(values(store, '$.store.bicycle.*'), ['red', 19.95]);
  assert.deepEqual(paths(store, '$.store[*]'), ['$.store.book', '$.store.bicycle']);
  assert.deepEqual(values(5, '$.*'), []);
});

test('recursive descent by name', () => {
  assert.deepEqual(values(store, '$..price'), [8.95, 12.99, 8.99, 22.99, 19.95]);
  assert.deepEqual(values(store, '$..author').length, 4);
  assert.deepEqual(values(store, '$..book[2].title'), ['Moby Dick']);
});

test('recursive descent on nested arrays is pre-order document order', () => {
  const doc = [[1, [2, 3]], 4];
  assert.deepEqual(values(doc, '$..[*]'), [[1, [2, 3]], 4, 1, [2, 3], 2, 3]);
  assert.deepEqual(paths(doc, '$..[0]'), ['$[0]', '$[0][0]', '$[0][1][0]']);
  assert.deepEqual(values({ a: { a: { a: 1 } } }, '$..a'), [{ a: { a: 1 } }, { a: 1 }, 1]);
  assert.deepEqual(values(doc, '$..*').length, 6);
});

test('unions of indices and names keep written order', () => {
  assert.deepEqual(values(store, '$.store.book[0,2].title'), ['Sayings', 'Moby Dick']);
  assert.deepEqual(values(store, '$.store.book[2,0].title'), ['Moby Dick', 'Sayings']);
  assert.deepEqual(values(store, "$.store.bicycle['price','color']"), [19.95, 'red']);
  assert.deepEqual(values([1, 2, 3], '$[0, -1]'), [1, 3]);
  assert.deepEqual(values([0, 1, 2, 3, 4], '$[0:2, 4]'), [0, 1, 4]);
});

test('slices follow Python semantics', () => {
  const a = [0, 1, 2, 3, 4, 5];
  assert.deepEqual(values(a, '$[1:3]'), [1, 2]);
  assert.deepEqual(values(a, '$[:2]'), [0, 1]);
  assert.deepEqual(values(a, '$[4:]'), [4, 5]);
  assert.deepEqual(values(a, '$[:]'), a);
  assert.deepEqual(values(a, '$[::2]'), [0, 2, 4]);
  assert.deepEqual(values(a, '$[-2:]'), [4, 5]);
  assert.deepEqual(values(a, '$[::-1]'), [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(values(a, '$[4:1:-2]'), [4, 2]);
  assert.deepEqual(values(a, '$[-100:100]'), a);
  assert.deepEqual(values(a, '$[3:1]'), []);
  assert.deepEqual(paths(a, '$[1:3]'), ['$[1]', '$[2]']);
  assert.deepEqual(values({ x: 1 }, '$[0:1]'), []);
});

test('filter comparators: == != < <= > >=', () => {
  const titles = (f: string) => values(store, `$.store.book[?(${f})].title`);
  assert.deepEqual(titles('@.price < 9'), ['Sayings', 'Moby Dick']);
  assert.deepEqual(titles('@.price <= 8.99'), ['Sayings', 'Moby Dick']);
  assert.deepEqual(titles('@.price > 12.99'), ['LOTR']);
  assert.deepEqual(titles('@.price >= 12.99'), ['Sword', 'LOTR']);
  assert.deepEqual(titles("@.category == 'reference'"), ['Sayings']);
  assert.deepEqual(titles('@.category != "reference"'), ['Sword', 'Moby Dick', 'LOTR']);
  assert.deepEqual(titles("@.title < 'N'"), ['Moby Dick', 'LOTR']);
});

test('filter literals: true, false, null, negative and exponent numbers; literal on the left', () => {
  const doc = [{ v: true }, { v: false }, { v: null }, { v: -2 }, { v: 1000 }, { v: '1000' }];
  assert.deepEqual(values(doc, '$[?(@.v == true)]'), [{ v: true }]);
  assert.deepEqual(values(doc, '$[?(@.v == false)]'), [{ v: false }]);
  assert.deepEqual(values(doc, '$[?(@.v == null)]'), [{ v: null }]);
  assert.deepEqual(values(doc, '$[?(@.v == -2)]'), [{ v: -2 }]);
  assert.deepEqual(values(doc, '$[?(@.v == 1e3)]'), [{ v: 1000 }]);
  assert.deepEqual(values(doc, '$[?(0 > @.v)]'), [{ v: -2 }]);
});

test('mixed-type ordering comparisons are false; missing paths only match !=', () => {
  const doc = [{ v: '5' }, { v: 5 }, {}];
  assert.deepEqual(values(doc, '$[?(@.v < 10)]'), [{ v: 5 }]);
  assert.deepEqual(values(doc, '$[?(@.v == 5)]'), [{ v: 5 }]);
  assert.deepEqual(values(doc, '$[?(@.v != 5)]'), [{ v: '5' }, {}]);
  assert.deepEqual(values(doc, '$[?(@.w == @.x)]'), [{ v: '5' }, { v: 5 }, {}]);
});

test('filter existence checks and negation', () => {
  assert.deepEqual(values(store, '$.store.book[?(@.isbn)].title'), ['Moby Dick', 'LOTR']);
  assert.deepEqual(values(store, '$.store.book[?(!@.isbn)].title'), ['Sayings', 'Sword']);
  // Existence is about presence, not truthiness.
  assert.deepEqual(values([{ a: 0 }, { a: null }, {}], '$[?(@.a)]'), [{ a: 0 }, { a: null }]);
});

test('filter && and || with precedence (&& binds tighter)', () => {
  const titles = (f: string) => values(store, `$.store.book[?(${f})].title`);
  assert.deepEqual(titles("@.category == 'fiction' && @.price < 10"), ['Moby Dick']);
  assert.deepEqual(titles("@.price < 9 || @.author == 'Evelyn Waugh'"), ['Sayings', 'Sword', 'Moby Dick']);
  assert.deepEqual(titles("@.price > 20 || @.isbn && @.price < 9"), ['Moby Dick', 'LOTR']);
  assert.deepEqual(titles('@.isbn && @.price > 1 && @.price < 10'), ['Moby Dick']);
});

test('filter paths: nested dot/bracket, indices, bare @, $ root, and objects', () => {
  const doc = {
    limit: 2,
    items: [
      { meta: { 'x-y': [1, 2] }, n: 1 },
      { meta: { 'x-y': [5, 6] }, n: 2 },
      { meta: {}, n: 3 },
    ],
  };
  assert.deepEqual(values(doc, "$.items[?(@.meta['x-y'][1] > 3)].n"), [2]);
  assert.deepEqual(values(doc, '$.items[?(@.meta.x-y[0] == 1)].n'), [1]);
  assert.deepEqual(values(doc, '$.items[?(@.n <= $.limit)].n'), [1, 2]);
  assert.deepEqual(values([3, 7, 9], '$[?(@ > 5)]'), [7, 9]);
  assert.deepEqual(values({ a: 1, b: 5 }, '$[?(@ > 2)]'), [5]);
  assert.deepEqual(paths({ a: 1, b: 5 }, '$[?(@ > 2)]'), ['$.b']);
  // Filter without parentheses (RFC 9535 style) and whitespace tolerance.
  assert.deepEqual(values([3, 7, 9], '$[ ?@ > 5 ]'), [7, 9]);
});

test('recursive descent combined with a filter', () => {
  assert.deepEqual(values(store, '$..[?(@.price > 19)].title'), ['LOTR']);
  assert.deepEqual(values(store, '$..[?(@.color)].price'), [19.95]);
});

test('bare expressions are treated as $-prefixed', () => {
  assert.deepEqual(values(store, 'store.bicycle.color'), ['red']);
  assert.deepEqual(values(store, '.store.bicycle.color'), ['red']);
  assert.deepEqual(values(store, "['store'].bicycle.color"), ['red']);
  assert.deepEqual(values(store, '..color'), ['red']);
  assert.deepEqual(values(store, 'store.book[*].price').length, 4);
});

test('results carry full paths and are deterministic', () => {
  const a = queryJsonPath(store, '$..book[?(@.isbn)]');
  const b = queryJsonPath(store, '$..book[?(@.isbn)]');
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.map((m) => m.path),
    [
      ['store', 'book', 2],
      ['store', 'book', 3],
    ],
  );
});

test('formatPath dot style (default) with odd keys', () => {
  assert.equal(formatPath([]), '$');
  assert.equal(formatPath(['a', 'b', 0, 'c']), '$.a.b[0].c');
  assert.equal(formatPath(['my key']), '$["my key"]');
  assert.equal(formatPath(['x-y', '1abc', '', '$ok', '_ok']), '$["x-y"]["1abc"][""].$ok._ok');
  assert.equal(formatPath(['say "hi"']), '$["say \\"hi\\""]');
  assert.equal(formatPath(['a.b', 'line\nbreak']), '$["a.b"]["line\\nbreak"]');
});

test('formatPath bracket style escapes single quotes and backslashes', () => {
  assert.equal(formatPath(['a', 'b', 0, 'c'], 'bracket'), "$['a']['b'][0]['c']");
  assert.equal(formatPath(["it's"], 'bracket'), "$['it\\'s']");
  assert.equal(formatPath(['back\\slash'], 'bracket'), "$['back\\\\slash']");
  assert.equal(formatPath(['say "hi"', 'tab\t'], 'bracket'), `$['say "hi"']['tab\\t']`);
});

test('formatPath output round-trips through queryJsonPath', () => {
  const doc = { 'we ird': { "it's": [{ 'a"b': 42 }] }, 'back\\slash': { 'x.y': true } };
  for (const expr of ['$..*', '$..[*]']) {
    for (const m of queryJsonPath(doc, expr)) {
      for (const style of ['dot', 'bracket'] as const) {
        const again = queryJsonPath(doc, formatPath(m.path, style));
        assert.deepEqual(again, [m], `round-trip ${formatPath(m.path, style)}`);
      }
    }
  }
});

test('error: empty expression and trailing garbage', () => {
  assertError('', 1);
  assertError('   ', 4);
  assertError('$.a b', 5);
  assertError('$#', 2);
});

test('error: bad dot segments and dangling descent', () => {
  assertError('$.', 3);
  assertError('$..', 4);
  assertError('$.a.[0]', 5);
  assertError('$.store.#x', 9);
});

test('error: bracket problems', () => {
  assertError('$[', 2);
  assertError('$[0', 2);
  assertError('$[]', 3);
  assertError('$[foo]', 3);
  assertError('$[0 1]', 5);
  assertError("$['abc]", 3);
  assertError('$[1,]', 5);
  assertError('$[-]', 3);
  assertError('$[(@.length-1)]', 3);
});

test('error: slice problems', () => {
  assertError('$[::0]', 3);
  assertError('$[1:2:3:4]', 8);
});

test('error: filter problems', () => {
  assertError('$[?(@.a = 1)]', 9);
  assertError('$[?(@.a == )]', 12);
  assertError('$[?(@.a < 1]', 12);
  assertError('$[?(5)]', 5);
  assertError('$[?(@.a ~ 1)]', 9);
  assertError('$[?((@.a))]', 5);
  assertError('$[?(@..a)]', 6, false);
  assertError('$[?(@.a && )]', 12);
  assertError('$[?(!5)]', 6);
  assertError("$[?(@.a == 'x\\q')]", 14);
});

test('JsonPathError is an Error with message, name and location', () => {
  try {
    queryJsonPath({}, '$.a[');
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e instanceof JsonPathError);
    assert.equal(e.name, 'JsonPathError');
    assert.match(e.message, /Unclosed/);
    assert.equal(e.col, 4);
  }
});
