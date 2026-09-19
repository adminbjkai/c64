import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToml, parseTomlWithInfo, stringifyToml, looksLikeToml, TomlParseError } from '../src/lib/toml.js';
import { runToml, tomlMode, detectTomlDirection } from '../src/modes/toml.js';
import { runConvert, sniffFormat } from '../src/modes/convert.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });

function fails(text: string, re: RegExp): TomlParseError {
  try {
    parseToml(text);
  } catch (e) {
    assert.ok(e instanceof TomlParseError, 'TomlParseError');
    assert.match(e.message, re);
    assert.equal(typeof e.line, 'number');
    assert.equal(typeof e.col, 'number');
    assert.ok(e.hint && e.hint.length > 0, 'hint');
    return e;
  }
  assert.fail(`expected ${text} to fail`);
}

// --- keys ---------------------------------------------------------------

test('bare, quoted and dotted keys', () => {
  assert.deepEqual(parseToml('key = 1\nbare_key = 2\nbare-key = 3\n1234 = 4'), { key: 1, bare_key: 2, 'bare-key': 3, '1234': 4 });
  assert.deepEqual(parseToml('"127.0.0.1" = "a"\n"character encoding" = "b"\n\'quoted "value"\' = "c"\n"" = "blank"'), { '127.0.0.1': 'a', 'character encoding': 'b', 'quoted "value"': 'c', '': 'blank' });
  assert.deepEqual(parseToml('physical.color = "orange"\nphysical.shape = "round"\nsite."google.com" = true\nfruit . flavor = "banana"'), {
    physical: { color: 'orange', shape: 'round' },
    site: { 'google.com': true },
    fruit: { flavor: 'banana' },
  });
});

test('duplicate keys and invalid keys are errors with positions', () => {
  const e = fails('name = "Tom"\nname = "Pradyun"', /Duplicate key "name"/);
  assert.equal(e.line, 2);
  assert.equal(e.col, 1);
  fails('spelling = "favorite"\n"spelling" = "favourite"', /Duplicate key/);
  fails('a.b = 1\na.b.c = 2', /is not a table/);
  fails('key = # INVALID', /Expected a value/);
  fails('first = "Tom" last = "Preston-Werner"', /Unexpected "l" after value/);
  fails('= "no key"', /Invalid character "="/);
});

// --- strings ------------------------------------------------------------

test('basic strings with escapes', () => {
  const v = parseToml('str = "I\'m a string. \\"You can quote me\\". Name\\tJos\\u00E9\\nLocation\\tSF. \\U0001F600"') as { str: string };
  assert.equal(v.str, 'I\'m a string. "You can quote me". Name\tJosé\nLocation\tSF. 😀');
  fails('s = "bad \\x escape"', /Invalid escape sequence \\x/);
  fails('s = "unterminated', /Unterminated string/);
});

test('multi-line basic strings: leading newline trimmed, line-ending backslash', () => {
  const v = parseToml('str1 = """\nRoses are red\nViolets are blue"""\nstr2 = """\nThe quick brown \\\n\n\n  fox jumps over \\\n    the lazy dog."""\nstr3 = """Here are two quotation marks: "". Simple enough."""\nstr4 = """Here are three quotation marks: ""\\"."""\nstr5 = """"This," she said, "is just a pointless statement.""""') as Record<string, string>;
  assert.equal(v['str1'], 'Roses are red\nViolets are blue');
  assert.equal(v['str2'], 'The quick brown fox jumps over the lazy dog.');
  assert.equal(v['str3'], 'Here are two quotation marks: "". Simple enough.');
  assert.equal(v['str4'], 'Here are three quotation marks: """.');
  assert.equal(v['str5'], '"This," she said, "is just a pointless statement."');
});

test('literal and multi-line literal strings', () => {
  const v = parseToml("winpath = 'C:\\Users\\nodejs\\templates'\nquoted = 'Tom \"Dubs\" Preston-Werner'\nregex2 = '''I [dw]on't need \\d{2} apples'''\nlines = '''\nThe first newline is\ntrimmed in raw strings.\n'''\nquot15 = '''Here are fifteen quotation marks: \"\"\"\"\"\"\"\"\"\"\"\"\"\"\"'''") as Record<string, string>;
  assert.equal(v['winpath'], 'C:\\Users\\nodejs\\templates');
  assert.equal(v['quoted'], 'Tom "Dubs" Preston-Werner');
  assert.equal(v['regex2'], "I [dw]on't need \\d{2} apples");
  assert.equal(v['lines'], 'The first newline is\ntrimmed in raw strings.\n');
  assert.equal(v['quot15'], 'Here are fifteen quotation marks: """""""""""""""');
  fails("s = 'no\nnewlines'", /Unterminated literal string/);
});

// --- numbers ------------------------------------------------------------

test('integers: decimal, underscores, hex / oct / bin', () => {
  assert.deepEqual(parseToml('int1 = +99\nint2 = 42\nint3 = 0\nint4 = -17\nint5 = 1_000\nint6 = 5_349_221\nhex1 = 0xDEADBEEF\nhex3 = 0xdead_beef\noct1 = 0o01234567\nbin1 = 0b11010110'), {
    int1: 99,
    int2: 42,
    int3: 0,
    int4: -17,
    int5: 1000,
    int6: 5349221,
    hex1: 0xdeadbeef,
    hex3: 0xdeadbeef,
    oct1: 0o1234567,
    bin1: 0b11010110,
  });
  fails('n = 007', /Leading zeros|Invalid number/);
  fails('n = 1__0', /Invalid number/);
});

test('floats: fraction, exponent, underscores, inf and nan', () => {
  const v = parseToml('flt1 = +1.0\nflt2 = 3.1415\nflt3 = -0.01\nflt4 = 5e+22\nflt5 = 1e06\nflt6 = -2E-2\nflt7 = 6.626e-34\nflt8 = 224_617.445_991_228\nsf1 = inf\nsf2 = +inf\nsf3 = -inf\nsf4 = nan') as Record<string, number>;
  assert.equal(v['flt1'], 1);
  assert.equal(v['flt2'], 3.1415);
  assert.equal(v['flt3'], -0.01);
  assert.equal(v['flt4'], 5e22);
  assert.equal(v['flt5'], 1e6);
  assert.equal(v['flt6'], -0.02);
  assert.equal(v['flt7'], 6.626e-34);
  assert.equal(v['flt8'], 224617.445991228);
  assert.equal(v['sf1'], Infinity);
  assert.equal(v['sf2'], Infinity);
  assert.equal(v['sf3'], -Infinity);
  assert.ok(Number.isNaN(v['sf4']));
  fails('f = 3.', /Invalid number/);
  fails('f = .7', /Invalid value/);
});

test('booleans and bare words', () => {
  assert.deepEqual(parseToml('a = true\nb = false'), { a: true, b: false });
  const e = fails('name = Tom', /Invalid value "Tom"/);
  assert.match(e.hint!, /Strings must be quoted/);
});

// --- dates --------------------------------------------------------------

test('date-times are emitted as ISO strings and counted', () => {
  const { value, dates } = parseTomlWithInfo('odt1 = 1979-05-27T07:32:00Z\nodt2 = 1979-05-27T00:32:00-07:00\nodt3 = 1979-05-27T00:32:00.999999-07:00\nodt4 = 1979-05-27 07:32:00Z\nldt1 = 1979-05-27T07:32:00\nld1 = 1979-05-27\nlt1 = 07:32:00\nlt2 = 00:32:00.999999');
  assert.deepEqual(value, {
    odt1: '1979-05-27T07:32:00Z',
    odt2: '1979-05-27T00:32:00-07:00',
    odt3: '1979-05-27T00:32:00.999999-07:00',
    odt4: '1979-05-27T07:32:00Z',
    ldt1: '1979-05-27T07:32:00',
    ld1: '1979-05-27',
    lt1: '07:32:00',
    lt2: '00:32:00.999999',
  });
  assert.equal(dates, 8);
});

// --- arrays and inline tables -------------------------------------------

test('arrays: mixed, nested, multi-line with comments and trailing comma', () => {
  const v = parseToml('integers = [ 1, 2, 3 ]\ncolors = [ "red", "yellow", "green" ]\nnested = [ [ 1, 2 ], ["a", "b", "c"] ]\nmixed = [ 0.1, 0.2, 0.5, 1, 2, 5 ]\nstrings = [ "all", \'strings\', """are the same""", \'\'\'type\'\'\' ]\ncontributors = [\n  "Foo Bar <foo@example.com>",\n  { name = "Baz Qux", email = "bazqux@example.com", url = "https://example.com/bazqux" }\n]\nintegers2 = [\n  1, 2, 3\n]\nintegers3 = [\n  1,\n  2, # this is ok\n]\nempty = []') as Record<string, unknown>;
  assert.deepEqual(v['integers'], [1, 2, 3]);
  assert.deepEqual(v['nested'], [[1, 2], ['a', 'b', 'c']]);
  assert.deepEqual(v['strings'], ['all', 'strings', 'are the same', 'type']);
  assert.deepEqual(v['contributors'], ['Foo Bar <foo@example.com>', { name: 'Baz Qux', email: 'bazqux@example.com', url: 'https://example.com/bazqux' }]);
  assert.deepEqual(v['integers2'], [1, 2, 3]);
  assert.deepEqual(v['integers3'], [1, 2]);
  assert.deepEqual(v['empty'], []);
  fails('a = [1 2]', /Expected "," or "\]"/);
  fails('a = [1, 2', /Unterminated array/);
});

test('inline tables', () => {
  assert.deepEqual(parseToml('name = { first = "Tom", last = "Preston-Werner" }\npoint = { x = 1, y = 2 }\nanimal = { type.name = "pug" }\nempty = {}'), {
    name: { first: 'Tom', last: 'Preston-Werner' },
    point: { x: 1, y: 2 },
    animal: { type: { name: 'pug' } },
    empty: {},
  });
  fails('t = { a = 1, }', /Trailing comma in inline table/);
  fails('t = { a = 1\n b = 2 }', /Unterminated inline table/);
  fails('[product]\ntype = { name = "Nail" }\ntype.edible = false', /Cannot add to inline table/);
});

// --- tables -------------------------------------------------------------

test('tables, nested headers, whitespace and quoted segments', () => {
  const v = parseToml('[table-1]\nkey1 = "some string"\nkey2 = 123\n\n[table-2]\nkey1 = "another string"\n\n[dog."tater.man"]\ntype.name = "pug"\n\n[ a . b . c ]\nd = 1\n\n[x.y.z.w]\n\n[x]\nq = 1') as Record<string, unknown>;
  assert.deepEqual(v['table-1'], { key1: 'some string', key2: 123 });
  assert.deepEqual(v['table-2'], { key1: 'another string' });
  assert.deepEqual(v['dog'], { 'tater.man': { type: { name: 'pug' } } });
  assert.deepEqual(v['a'], { b: { c: { d: 1 } } });
  assert.deepEqual(v['x'], { y: { z: { w: {} } }, q: 1 });
});

test('table redefinition rules', () => {
  fails('[fruit]\napple = "red"\n\n[fruit]\norange = "orange"', /already defined/);
  fails('[fruit]\napple = "red"\n\n[fruit.apple]\ntexture = "smooth"', /already defined as a value/);
  fails('[fruit]\napple.color = "red"\n\n[fruit.apple]\ntexture = "smooth"', /already defined/);
  // Defining sub-tables of a dotted-key table via more dotted keys is fine.
  assert.deepEqual(parseToml('[fruit]\napple.color = "red"\napple.taste.sweet = true'), { fruit: { apple: { color: 'red', taste: { sweet: true } } } });
  fails('[a]\nb = 1\n[a.b]\nc = 2', /already defined as a value/);
  fails('[unclosed', /Expected "\]"/);
});

test('arrays of tables, including nested sub-tables and sub-arrays', () => {
  const v = parseToml(`[[products]]
name = "Hammer"
sku = 738594937

[[products]]  # empty table within the array

[[products]]
name = "Nail"
sku = 284758393
color = "gray"

[[fruits]]
name = "apple"

[fruits.physical]
color = "red"
shape = "round"

[[fruits.varieties]]
name = "red delicious"

[[fruits.varieties]]
name = "granny smith"

[[fruits]]
name = "banana"

[[fruits.varieties]]
name = "plantain"
`) as Record<string, unknown>;
  assert.deepEqual(v['products'], [{ name: 'Hammer', sku: 738594937 }, {}, { name: 'Nail', sku: 284758393, color: 'gray' }]);
  assert.deepEqual(v['fruits'], [
    { name: 'apple', physical: { color: 'red', shape: 'round' }, varieties: [{ name: 'red delicious' }, { name: 'granny smith' }] },
    { name: 'banana', varieties: [{ name: 'plantain' }] },
  ]);
});

test('arrays of tables: invalid redefinitions', () => {
  fails('[fruit.physical]\ncolor = "red"\n\n[[fruit]]\nname = "apple"', /already defined as a table/);
  fails('fruits = []\n\n[[fruits]]', /Cannot append to static array/);
  fails('[[fruits]]\nname = "apple"\n\n[[fruits.varieties]]\nname = "red delicious"\n\n[fruits.varieties]\nname = "granny smith"', /already defined/);
});

test('comments, blank lines, CRLF and BOM', () => {
  assert.deepEqual(parseToml('\ufeff# top comment\r\n\r\nkey = "value" # inline\r\n\r\n[t] # table comment\r\nother = 1\r\n'), { key: 'value', t: { other: 1 } });
  assert.deepEqual(parseToml(''), {});
  assert.deepEqual(parseToml('# only a comment'), {});
});

test('error positions point at the offending line and column', () => {
  const e = fails('a = 1\nb = 2\nc = [1,\n  "x",\n  oops]', /Invalid value "oops"/);
  assert.equal(e.line, 5);
  assert.equal(e.col, 3);
  const e2 = fails('[a]\nx = 1\n\n[a]', /already defined/);
  assert.equal(e2.line, 4);
});

// --- emitter ------------------------------------------------------------

test('stringifyToml: simple keys, nested tables, arrays of tables, inline arrays', () => {
  const out = stringifyToml({
    title: 'T',
    n: 1,
    f: 1.5,
    ok: true,
    list: [1, 2],
    owner: { name: 'Tom', tags: ['a', 'b'] },
    servers: { alpha: { ip: '10.0.0.1' }, beta: { ip: '10.0.0.2' } },
    products: [{ name: 'Hammer' }, { name: 'Nail', color: 'gray' }],
  });
  assert.equal(
    out,
    [
      'title = "T"',
      'n = 1',
      'f = 1.5',
      'ok = true',
      'list = [1, 2]',
      '',
      '[owner]',
      'name = "Tom"',
      'tags = ["a", "b"]',
      '',
      '[servers.alpha]',
      'ip = "10.0.0.1"',
      '',
      '[servers.beta]',
      'ip = "10.0.0.2"',
      '',
      '[[products]]',
      'name = "Hammer"',
      '',
      '[[products]]',
      'name = "Nail"',
      'color = "gray"',
    ].join('\n'),
  );
});

test('stringifyToml: key quoting, string escaping, multi-line strings, special numbers, empty tables', () => {
  const out = stringifyToml({ 'a.b': 1, 'sp ace': 'x"y\\z', multi: 'l1\nl2', big: 1e21, inf: Infinity, nan: NaN, empty: {}, mixed: [1, { a: 1 }, [2]], whole: 2.0 });
  assert.equal(
    out,
    ['"a.b" = 1', '"sp ace" = "x\\"y\\\\z"', 'multi = """\nl1\nl2"""', 'big = 1e+21', 'inf = inf', 'nan = nan', 'mixed = [1, { a = 1 }, [2]]', 'whole = 2', '', '[empty]'].join('\n'),
  );
});

test('stringifyToml: nulls are skipped and reported; non-object root throws', () => {
  const skipped: string[] = [];
  assert.equal(stringifyToml({ a: null, b: { c: null, d: 1 }, e: [1, null] }, { skipped }), 'e = [1]\n\n[b]\nd = 1');
  assert.deepEqual(skipped, ['a', 'e[1]', 'b.c']);
  assert.throws(() => stringifyToml([1, 2]), /top level/);
  assert.throws(() => stringifyToml('x'), /top level/);
});

test('round trip: parse → stringify → parse is identity for the sample', () => {
  const first = parseToml(tomlMode.sample);
  const again = parseToml(stringifyToml(first));
  assert.deepEqual(again, first);
});

// --- mode ---------------------------------------------------------------

test('mode: sample runs TOML → JSON with a date note', () => {
  const r = runToml(tomlMode.sample, ctx());
  assert.equal(r.error, undefined);
  assert.match(r.status!, /^TOML → JSON · object · 5 keys/);
  assert.ok(r.notes?.some((n) => /date\/time value/.test(n)));
  assert.equal((JSON.parse(r.output) as { owner: { dob: string } }).owner.dob, '1979-05-27T07:32:00-08:00');
  assert.deepEqual(runToml('', ctx()), { output: '', status: '' });
});

test('mode: direction auto-detect, Pretty/Raw, explicit direction', () => {
  assert.equal(detectTomlDirection('{"a":1}'), 'toToml');
  assert.equal(detectTomlDirection('[1,2]'), 'toToml');
  assert.equal(detectTomlDirection('[table]\na = 1'), 'toJson');
  assert.equal(detectTomlDirection('[[items]]'), 'toJson');
  assert.equal(detectTomlDirection('a = 1'), 'toJson');
  assert.equal(runToml('a = 1', ctx({}, false)).output, '{"a":1}');
  assert.equal(runToml('a = 1', ctx()).output, '{\n  "a": 1\n}');
  const j = runToml('{"a":{"b":1},"c":null}', ctx());
  assert.equal(j.output, '[a]\nb = 1');
  assert.ok(j.notes?.some((n) => /Skipped 1 null value.*c/.test(n)));
  assert.match(j.status!, /^JSON → TOML/);
  assert.equal(runToml('[1,2]', ctx({ direction: 'toJson' })).error !== undefined, true);
  assert.match(runToml('[1]', ctx({ direction: 'toToml' })).error!.message, /Cannot emit TOML/);
});

test('mode: TOML errors carry line/col and hint', () => {
  const r = runToml('[a]\nx = oops', ctx());
  assert.equal(r.error?.line, 2);
  assert.equal(r.error?.col, 5);
  assert.ok(r.error?.hint);
  assert.equal(r.status, 'Invalid TOML · line 2, col 5');
});

// --- convert integration --------------------------------------------------

test('convert: sniffFormat recognises TOML without breaking the other formats', () => {
  assert.equal(looksLikeToml('[table]\nkey = 1'), true);
  assert.equal(looksLikeToml('# c\nkey = "v"'), true);
  assert.equal(looksLikeToml('a: 1'), false);
  assert.equal(sniffFormat('[owner]\nname = "x"'), 'toml');
  assert.equal(sniffFormat('title = "x"\n[owner]'), 'toml');
  assert.equal(sniffFormat('ports = [1, 2]'), 'toml');
  assert.equal(sniffFormat('[{"a":1}]'), 'json');
  assert.equal(sniffFormat('{"a":1}'), 'json');
  assert.equal(sniffFormat('a,b\n1,2'), 'csv');
  assert.equal(sniffFormat('a: 1'), 'yaml');
  assert.equal(sniffFormat('<a/>'), 'xml');
});

test('convert: TOML ↔ JSON / YAML / XML / CSV', () => {
  assert.equal(runConvert('[owner]\nname = "Tom"\nports = [1, 2]', ctx({ to: 'json' })).output, '{\n  "owner": {\n    "name": "Tom",\n    "ports": [\n      1,\n      2\n    ]\n  }\n}');
  assert.equal(runConvert('{"a":1,"b":{"c":"x"}}', ctx({ to: 'toml' })).output, 'a = 1\n\n[b]\nc = "x"');
  assert.equal(runConvert('a: 1\nb:\n  c: x', ctx({ from: 'yaml', to: 'toml' })).output, 'a = 1\n\n[b]\nc = "x"');
  assert.equal(runConvert('[owner]\nname = "Tom"', ctx({ to: 'yaml' })).output, 'owner:\n  name: Tom');
  assert.equal(runConvert('[owner]\nname = "Tom"', ctx({ to: 'xml' })).output, '<owner>\n  <name>Tom</name>\n</owner>');
  assert.equal(runConvert('[[rows]]\na = 1\n[[rows]]\na = 2', ctx({ to: 'json' })).output, '{\n  "rows": [\n    {\n      "a": 1\n    },\n    {\n      "a": 2\n    }\n  ]\n}');
  assert.equal(runConvert('a,b\n1,2', ctx({ from: 'csv', to: 'toml' })).error?.message, 'Cannot emit TOML: TOML documents must be an object at the top level (got array)');
  const r = runConvert('[a]\nb = 1', ctx({ to: 'json' }));
  assert.ok(r.notes?.some((n) => /Detected TOML input/.test(n)));
  assert.match(r.status!, /^TOML → JSON/);
  const bad = runConvert('a = oops', ctx({ from: 'toml', to: 'json' }));
  assert.equal(bad.error?.line, 1);
  assert.match(bad.status!, /^Invalid TOML/);
});
