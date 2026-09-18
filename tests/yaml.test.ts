import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, stringifyYaml, YamlParseError } from '../src/lib/yaml.js';

/** Assert that parsing throws a YamlParseError matching the given fields. */
function assertYamlError(
  input: string,
  expected: { message?: RegExp; line?: number; col?: number; hint?: RegExp },
): YamlParseError {
  let caught: unknown;
  try {
    parseYaml(input);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof YamlParseError, `expected YamlParseError for ${JSON.stringify(input)}, got ${String(caught)}`);
  if (expected.message) assert.match(caught.message, expected.message);
  if (expected.line !== undefined) assert.equal(caught.line, expected.line, `line for ${JSON.stringify(input)}`);
  if (expected.col !== undefined) assert.equal(caught.col, expected.col, `col for ${JSON.stringify(input)}`);
  if (expected.hint) assert.match(caught.hint ?? '', expected.hint);
  return caught;
}

const roundTrip = (v: unknown, indent?: number): void => {
  const y = stringifyYaml(v, indent === undefined ? {} : { indent });
  assert.deepEqual(parseYaml(y), v, `round trip failed for:\n${y}`);
};

/* ---------------- parsing: structure ---------------- */

test('block mapping with nesting', () => {
  const y = `
name: c64
server:
  host: localhost
  port: 8080
  tls:
    enabled: false
`;
  assert.deepEqual(parseYaml(y), {
    name: 'c64',
    server: { host: 'localhost', port: 8080, tls: { enabled: false } },
  });
});

test('block sequences, nested sequences and compact `- - x`', () => {
  assert.deepEqual(parseYaml('- a\n- b\n-   c'), ['a', 'b', 'c']);
  assert.deepEqual(parseYaml('- - 1\n  - 2\n- - 3'), [[1, 2], [3]]);
  assert.deepEqual(parseYaml('-\n  - x\n  - y\n- z'), [['x', 'y'], 'z']);
});

test('compact sequence of mappings', () => {
  const y = `
- name: a
  tags: [x, y]
  meta:
    n: 1
- name: b
-   name: c
    deep: true
`;
  assert.deepEqual(parseYaml(y), [
    { name: 'a', tags: ['x', 'y'], meta: { n: 1 } },
    { name: 'b' },
    { name: 'c', deep: true },
  ]);
});

test('`key:` followed by a list at the same or deeper indentation', () => {
  assert.deepEqual(parseYaml('items:\n- 1\n- 2\nnext: 3'), { items: [1, 2], next: 3 });
  assert.deepEqual(parseYaml('items:\n  - 1\n  - 2\nnext: 3'), { items: [1, 2], next: 3 });
  assert.deepEqual(parseYaml('- a:\n  - 1\n  b: 2'), [{ a: [1], b: 2 }]);
});

test('empty values are null', () => {
  assert.deepEqual(parseYaml('a:\nb: ~\nc: null\nd:   # comment\n'), { a: null, b: null, c: null, d: null });
  assert.deepEqual(parseYaml('- \n-\n- x'), [null, null, 'x']);
  assert.equal(parseYaml(''), null);
  assert.equal(parseYaml('# only a comment\n\n'), null);
  assert.equal(parseYaml('---\n'), null);
});

test('flow collections', () => {
  assert.deepEqual(parseYaml('{a: 1, b: [1, 2], c: {d: "x"}}'), { a: 1, b: [1, 2], c: { d: 'x' } });
  assert.deepEqual(parseYaml('k: [ ]'), { k: [] });
  assert.deepEqual(parseYaml('k: {}'), { k: {} });
  assert.deepEqual(parseYaml('[1, 2, ]'), [1, 2]); // trailing comma
  assert.deepEqual(parseYaml('{a, b: }'), { a: null, b: null });
  assert.deepEqual(parseYaml('[a: 1, b]'), [{ a: 1 }, 'b']);
  assert.deepEqual(parseYaml('{"a":1,"b":[true,null]}'), { a: 1, b: [true, null] }); // JSON is YAML
  assert.deepEqual(parseYaml('list: [\n  one,   # first\n  two words,\n  3\n]\nafter: x'), {
    list: ['one', 'two words', 3],
    after: 'x',
  });
  assert.deepEqual(parseYaml('[http://x.io/a, a:b]'), ['http://x.io/a', 'a:b']);
});

/* ---------------- parsing: scalars ---------------- */

test('core schema scalar typing', () => {
  const cases: [string, unknown][] = [
    ['null', null], ['Null', null], ['NULL', null], ['~', null],
    ['true', true], ['True', true], ['FALSE', false],
    ['0', 0], ['-19', -19], ['+12', 12], ['007', 7], ['0o17', 15], ['0x1F', 31], ['0xff', 255],
    ['1.5', 1.5], ['-.5', -0.5], ['1e3', 1000], ['6.02E+23', 6.02e23], ['1.', 1],
    ['.inf', Infinity], ['-.Inf', -Infinity], ['+.INF', Infinity],
    ['yes', 'yes'], ['no', 'no'], ['on', 'on'], ['nULL', 'nULL'], ['0b101', '0b101'],
    ['1_000', '1_000'], ['0x', '0x'], ['1.2.3', '1.2.3'], ['.', '.'], ['-x', '-x'],
    ['12:30', '12:30'], ['2024-01-01', '2024-01-01'], ['hello world', 'hello world'],
  ];
  for (const [src, want] of cases) {
    assert.deepEqual(parseYaml(`v: ${src}`), { v: want }, src);
  }
  assert.ok(Number.isNaN((parseYaml('v: .nan') as { v: number }).v));
  assert.ok(Number.isNaN((parseYaml('v: .NaN') as { v: number }).v));
  assert.ok(Object.is(parseYaml('-0'), -0));
});

test('keys are always strings; quoted keys supported', () => {
  assert.deepEqual(parseYaml('1: a\ntrue: b\nnull: c\n"quoted key": d\n\'it\'\'s\': e\n"a: b" : f'), {
    '1': 'a',
    true: 'b',
    null: 'c',
    'quoted key': 'd',
    "it's": 'e',
    'a: b': 'f',
  });
  const proto = parseYaml('__proto__: 1') as Record<string, unknown>;
  assert.ok(Object.prototype.hasOwnProperty.call(proto, '__proto__'));
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
});

test('plain scalars: inner punctuation, multi-line folding', () => {
  assert.deepEqual(parseYaml('url: http://example.com:8080/a#frag\nq: what? yes!\nd: -x'), {
    url: 'http://example.com:8080/a#frag',
    q: 'what? yes!',
    d: '-x',
  });
  assert.deepEqual(parseYaml('text: one\n  two\n\n  three\nnext: 1'), { text: 'one two\nthree', next: 1 });
  assert.deepEqual(parseYaml('- a\n  b'), ['a b']);
});

test('single- and double-quoted scalars', () => {
  assert.equal(parseYaml(`'it''s "fine" \\n'`), 'it\'s "fine" \\n');
  assert.equal(parseYaml('"tab\\tnl\\nq\\"bs\\\\ sl\\/ \\x41\\u00e9\\U0001F600 \\0\\e"'), 'tab\tnl\nq"bs\\ sl/ Aé😀 \0\x1b');
  assert.equal(parseYaml('"line one\n  line two\n\n  para"'), 'line one line two\npara');
  assert.equal(parseYaml('"joined\\\n   here"'), 'joinedhere');
  assert.equal(parseYaml("'a\n\n\n  b'"), 'a\n\nb');
  assert.deepEqual(parseYaml('a: "123"\nb: \'true\'\nc: ""'), { a: '123', b: 'true', c: '' });
  assert.deepEqual(parseYaml('a: "# not a comment" # comment'), { a: '# not a comment' });
});

test('literal block scalars with chomping', () => {
  const doc = (h: string) => `a: ${h}\n  line1\n    indented\n\n  line3\n\n\nb: end`;
  assert.deepEqual(parseYaml(doc('|')), { a: 'line1\n  indented\n\nline3\n', b: 'end' });
  assert.deepEqual(parseYaml(doc('|-')), { a: 'line1\n  indented\n\nline3', b: 'end' });
  assert.deepEqual(parseYaml(doc('|+')), { a: 'line1\n  indented\n\nline3\n\n\n', b: 'end' });
  // keep at end of input, and comments inside the block are content
  assert.deepEqual(parseYaml('a: |+\n  x\n  # not a comment\n\n'), { a: 'x\n# not a comment\n\n' });
  assert.deepEqual(parseYaml('- |\n  in list\n- |-\n  two'), ['in list\n', 'two']);
  assert.deepEqual(parseYaml('a: |2\n    two extra\nb: 1'), { a: '  two extra\n', b: 1 });
  assert.deepEqual(parseYaml('a: |\nb: 1'), { a: '', b: 1 });
  assert.equal(parseYaml('--- |\n  top\n'), 'top\n');
  assert.equal(parseYaml('|\n text\n'), 'text\n');
});

test('folded block scalars', () => {
  assert.deepEqual(parseYaml('a: >\n  one\n  two\n\n  three\n'), { a: 'one two\nthree\n' });
  assert.deepEqual(parseYaml('a: >-\n  one\n  two\n'), { a: 'one two' });
  assert.deepEqual(parseYaml('a: >\n  para\n    code\n  back\n'), { a: 'para\n  code\nback\n' });
  assert.deepEqual(parseYaml('a: >+ # keep\n  x\n\nb: 1'), { a: 'x\n\n', b: 1 });
});

test('comments everywhere', () => {
  const y = `# header
a: 1 # trailing
  # indented comment
b: x#not-a-comment
c:
  # before nested
  - 1 # item
# between
  - 2
d: 'q' # after quote
`;
  assert.deepEqual(parseYaml(y), { a: 1, b: 'x#not-a-comment', c: [1, 2], d: 'q' });
});

test('document markers', () => {
  assert.deepEqual(parseYaml('---\na: 1\n...\n# trailing comment\n'), { a: 1 });
  assert.deepEqual(parseYaml('# c\n--- # start\n- 1\n'), [1]);
  assert.deepEqual(parseYaml('--- [1, 2]'), [1, 2]);
  assert.equal(parseYaml('--- hello'), 'hello');
  assert.deepEqual(parseYaml('a: "--- not a marker"'), { a: '--- not a marker' });
});

test('CRLF line endings and BOM', () => {
  assert.deepEqual(parseYaml('\uFEFFa: 1\r\nb:\r\n  - x\r\nc: |\r\n  t\r\n'), { a: 1, b: ['x'], c: 't\n' });
});

/* ---------------- parsing: errors ---------------- */

test('error: multiple documents', () => {
  assertYamlError('a: 1\n---\nb: 2', { message: /^multiple documents are not supported$/, line: 2, col: 1 });
  assertYamlError('---\na: 1\n...\n---\nb: 2', { message: /multiple documents/, line: 4 });
  assertYamlError('a: 1\n...\nb: 2', { message: /after the document end/, line: 3 });
});

test('error: tabs used for indentation', () => {
  assertYamlError('a:\n\tb: 1', { message: /Tab/, line: 2, col: 1, hint: /YAML indentation must use spaces/ });
  assertYamlError('a:\n  \tb: 1', { line: 2, col: 3, hint: /YAML indentation must use spaces/ });
  // tabs inside values are fine
  assert.deepEqual(parseYaml('a: x\ty'), { a: 'x\ty' });
});

test('error: anchors, aliases, tags, directives, complex keys', () => {
  assertYamlError('a: &anchor 1', { message: /Anchors/, line: 1, col: 4, hint: /not supported in this tool/ });
  assertYamlError('a: 1\nb: *anchor', { message: /Aliases/, line: 2, col: 4, hint: /not supported in this tool/ });
  assertYamlError('a: !!str 1', { message: /Tags/, line: 1, col: 4, hint: /not supported in this tool/ });
  assertYamlError('- !custom x', { message: /Tags/, line: 1, col: 3, hint: /not supported in this tool/ });
  assertYamlError('a: [1, *x]', { message: /Aliases/, line: 1, col: 8, hint: /not supported in this tool/ });
  assertYamlError('&a key: 1', { message: /Anchors/, line: 1, col: 1 });
  assertYamlError('%YAML 1.2\n---\na: 1', { message: /Directives/, hint: /not supported in this tool/ });
  assertYamlError('? complex\n: value', { message: /Complex/, hint: /not supported in this tool/ });
});

test('error: inconsistent indentation', () => {
  assertYamlError('a:\n    b: 1\n  c: 2', { message: /Inconsistent indentation/, line: 3, col: 3 });
  assertYamlError('a: 1\n  b: 2', { message: /Unexpected mapping entry/, line: 2, col: 3 });
  assertYamlError('- a\n  - b', { message: /Unexpected list item/, line: 2, col: 3 });
  assertYamlError('list:\n  - a\n   - b', { message: /Unexpected list item/, line: 3, col: 4 });
  assertYamlError('list:\n  - a:\n      b: 1\n     c: 2', { message: /Inconsistent indentation/, line: 4, col: 6 });
  assertYamlError('  a: 1\nb: 2', { message: /Inconsistent indentation/, line: 2, col: 1 });
  assertYamlError('a:\n  - x\n  b: 1', { message: /mapping entry inside a list/, line: 3, col: 3 });
  assertYamlError('- x\nb: 1', { message: /mapping entry inside a list/, line: 2, col: 1 });
  assertYamlError('a: 1\n- x', { message: /list item inside a mapping/, line: 2, col: 1 });
});

test('error: missing colon, bad mapping values', () => {
  assertYamlError('a: 1\nb\nc: 2', { message: /no `:`/, line: 2, col: 2, hint: /Add `:`/ });
  assertYamlError('a: 1\nb:2', { message: /no `:`/, line: 2, col: 2, hint: /space after the `:`/ });
  assertYamlError('a: b: c', { message: /Unexpected `:`/, line: 1, col: 5 });
  assertYamlError('a: - b', { message: /list cannot start/, line: 1, col: 4 });
  assertYamlError('a: 1\nb: 2\na: 3', { message: /Duplicate key "a"/, line: 3, col: 1 });
  assertYamlError('x:\n  - k: 1\n    k: 2', { message: /Duplicate key "k"/, line: 3, col: 5 });
  assertYamlError('{a: 1, a: 2}', { message: /Duplicate key/, line: 1, col: 8 });
});

test('error: unterminated quotes and unclosed flow collections', () => {
  assertYamlError('a: 1\nb: "open\nc: 2', { message: /Unterminated/, line: 2, col: 4, hint: /closing `"`/ });
  assertYamlError("k: 'open", { message: /Unterminated/, line: 1, col: 4, hint: /closing `'`/ });
  assertYamlError('"key: 1', { message: /Unterminated/, line: 1, col: 1 });
  assertYamlError('a: [1, 2', { message: /Unclosed `\[`/, line: 1, col: 4 });
  assertYamlError('a: {b: 1\nc: 2', { message: /Expected `,` or `}`/, line: 2, col: 2, hint: /line 1/ });
  assertYamlError('a: [1, 2}', { message: /Expected `,` or `\]`/, line: 1, col: 9 });
  assert.deepEqual(parseYaml('a: [1 2]'), { a: ['1 2'] }); // spaces alone don't separate items
});

test('error: misc invalid input', () => {
  assertYamlError('a: "x" y', { message: /after the value/, line: 1, col: 8 });
  assertYamlError('a: [1,,2]', { message: /Unexpected `,`/, line: 1, col: 7 });
  assertYamlError('a: |x\n  b', { message: /block scalar header/, line: 1, col: 5 });
  assertYamlError('a: "\\q"', { message: /Bad escape/, line: 1, col: 5 });
  assertYamlError('a: @x', { message: /cannot start with `@`/, line: 1, col: 4 });
  assertYamlError('a: [|]', { message: /Block scalars/ });
});

/* ---------------- stringify ---------------- */

test('stringify: readable block output', () => {
  const v = { name: 'c64', port: 8080, ok: true, none: null, tags: ['a', 'b'], nested: { list: [{ x: 1, y: [1, 2] }, [3, 4]] }, e: {}, f: [] };
  assert.equal(
    stringifyYaml(v),
    [
      'name: c64',
      'port: 8080',
      'ok: true',
      'none: null',
      'tags:',
      '  - a',
      '  - b',
      'nested:',
      '  list:',
      '    - x: 1',
      '      y:',
      '        - 1',
      '        - 2',
      '    - - 3',
      '      - 4',
      'e: {}',
      'f: []',
    ].join('\n'),
  );
  assert.equal(stringifyYaml({ a: { b: [1] } }, { indent: 4 }), 'a:\n    b:\n        - 1');
  assert.equal(stringifyYaml([{ a: 1, b: 2 }], { indent: 4 }), '-   a: 1\n    b: 2');
  assert.equal(stringifyYaml(null), 'null');
  assert.equal(stringifyYaml({}), '{}');
  assert.equal(stringifyYaml([]), '[]');
  assert.equal(stringifyYaml('plain'), 'plain');
});

test('stringify: quotes strings only when needed', () => {
  const cases: [string, string][] = [
    ['hello world', 'hello world'],
    ['', '""'],
    ['true', '"true"'],
    ['null', '"null"'],
    ['~', '"~"'],
    ['123', '"123"'],
    ['1e3', '"1e3"'],
    ['0x1F', '"0x1F"'],
    ['.inf', '".inf"'],
    ['yes', '"yes"'],
    ['a: b', '"a: b"'],
    ['ends:', '"ends:"'],
    ['a #b', '"a #b"'],
    ['a#b', 'a#b'],
    [' lead', '" lead"'],
    ['trail ', '"trail "'],
    ['- item', '"- item"'],
    ['-x', '-x'],
    ['*star', '"*star"'],
    ['&amp', '"&amp"'],
    ['!bang', '"!bang"'],
    ['{x}', '"{x}"'],
    ['[x]', '"[x]"'],
    ['#x', '"#x"'],
    ["'q", '"\'q"'],
    ['"q', '"\\"q"'],
    ['@x', '"@x"'],
    ['---', '"---"'],
    ['...', '"..."'],
    ['http://x.io', 'http://x.io'],
    ['tab\there', '"tab\\there"'],
    ['cr\r\nlf', '"cr\\r\\nlf"'],
    ['12:30', '12:30'],
    ['café 😀', 'café 😀'],
  ];
  for (const [s, want] of cases) {
    assert.equal(stringifyYaml({ k: s }), `k: ${want}`, JSON.stringify(s));
    assert.deepEqual(parseYaml(stringifyYaml({ k: s })), { k: s });
    assert.deepEqual(parseYaml(stringifyYaml({ [s]: 1 })), { [s]: 1 }, `key ${JSON.stringify(s)}`);
  }
});

test('stringify: multi-line strings use block literals', () => {
  assert.equal(stringifyYaml({ a: 'x\ny' }), 'a: |-\n  x\n  y');
  assert.equal(stringifyYaml({ a: 'x\ny\n' }), 'a: |\n  x\n  y');
  assert.equal(stringifyYaml({ a: 'x\n\n' }), 'a: |+\n  x\n\n');
  assert.equal(stringifyYaml(['x\n\ny']), '- |-\n  x\n\n  y');
  assert.equal(stringifyYaml('top\nlevel\n'), '|\n  top\n  level');
  // leading spaces / whitespace-only lines / control chars fall back to double quotes
  assert.equal(stringifyYaml({ a: '  x\ny' }), 'a: "  x\\ny"');
  assert.equal(stringifyYaml({ a: 'x\n  \ny' }), 'a: "x\\n  \\ny"');
  assert.equal(stringifyYaml({ a: '\n' }), 'a: "\\n"');
  for (const s of ['x\ny', 'x\n', 'x\n\n\n', '\nx', 'a\n  b\n\n c\n', '# c\n- d: e\n', 'x\n\n', '  x\ny', 'a\u2028b\nc', '\n\n']) {
    roundTrip({ a: s, b: [s], c: { d: s } });
    roundTrip(s);
    roundTrip([s]);
  }
});

test('stringify: numbers and special values', () => {
  assert.equal(stringifyYaml([1.5, -0, 1e21, 5e-7, NaN, Infinity, -Infinity]), '- 1.5\n- -0\n- 1e+21\n- 5e-7\n- .nan\n- .inf\n- -.inf');
  roundTrip([1.5, -0, 1e21, 5e-7, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, -1e-300]);
  assert.equal(stringifyYaml({ a: undefined, b: () => 1, c: 1 }), 'c: 1');
  assert.equal(stringifyYaml([undefined]), '- null');
  assert.equal(stringifyYaml({ d: new Date(0) }), 'd: 1970-01-01T00:00:00.000Z');
  const circ: Record<string, unknown> = {};
  circ.self = circ;
  assert.throws(() => stringifyYaml(circ), TypeError);
});

test('JSON round trip on a nested fixture', () => {
  const fixture = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'web', labels: { app: 'web', 'app.kubernetes.io/part-of': 'c64' }, annotations: {} },
    spec: {
      replicas: 3,
      ratio: 0.25,
      paused: false,
      selector: null,
      template: {
        containers: [
          {
            name: 'app',
            image: 'nginx:1.25',
            args: ['--port', '8080', '--verbose', ''],
            env: [{ name: 'MODE', value: 'on' }, { name: 'EMPTY', value: null }],
            script: '#!/bin/sh\nset -e\necho "hi: there"\n',
            ports: [[80, 443], [], [{}]],
          },
        ],
      },
    },
    weird: {
      '': 'empty key',
      ' spaced ': ' v ',
      'multi\nline key': 'x',
      'quote"s': "it's",
      '- dash': '-',
      '?': ':',
      '#': '# hash',
      '123': 123,
      true: 'true',
      unicode: '日本語 ✓ \u0000 \u001f \u007f \ufeff',
      escapes: 'back\\slash "q" \t tab',
      deep: [[[['x']]], { a: { b: { c: [null, true, -1.5e-9] } } }],
    },
  };
  roundTrip(fixture);
  roundTrip(fixture, 4);
  roundTrip(fixture, 1);
  roundTrip(JSON.parse(JSON.stringify(fixture)));
});

test('round trip: seeded random JSON values', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const alphabet = ['a', 'b', ' ', ':', '#', '-', '"', "'", '\n', '\t', '\\', '[', '{', '|', '>', '1', '.', 'é', '&', '*', '!', '~', '?', ','];
  const str = (): string => {
    const len = Math.floor(rnd() * 8);
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    return s;
  };
  const gen = (depth: number): unknown => {
    const r = rnd();
    if (depth > 3 || r < 0.35) {
      const t = Math.floor(rnd() * 6);
      if (t === 0) return null;
      if (t === 1) return rnd() < 0.5;
      if (t === 2) return Math.floor(rnd() * 2000) - 1000;
      if (t === 3) return (rnd() - 0.5) * 1e6;
      return str();
    }
    const size = Math.floor(rnd() * 4);
    if (r < 0.65) return Array.from({ length: size }, () => gen(depth + 1));
    const o: Record<string, unknown> = {};
    for (let i = 0; i < size; i++) o[str()] = gen(depth + 1);
    return o;
  };
  for (let i = 0; i < 400; i++) {
    const v = gen(0);
    roundTrip(v, 1 + (i % 4));
  }
});
