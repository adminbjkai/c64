import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDelimiter,
  parseCsv,
  stringifyCsv,
  csvToJson,
  jsonToCsv,
  coerceCell,
  CsvParseError,
} from '../src/lib/csv.js';

// --- detectDelimiter ---------------------------------------------------

test('detectDelimiter: comma', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n4,5,6\n'), ',');
});

test('detectDelimiter: tab', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6\n'), '\t');
});

test('detectDelimiter: semicolon', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n4;5;6\n'), ';');
});

test('detectDelimiter: pipe', () => {
  assert.equal(detectDelimiter('a|b|c\n1|2|3\n4|5|6\n'), '|');
});

test('detectDelimiter: defaults to comma on empty/ambiguous input', () => {
  assert.equal(detectDelimiter(''), ',');
  assert.equal(detectDelimiter('single'), ',');
});

// --- parseCsv: basics ----------------------------------------------------

test('parseCsv: header true by default, splits header from rows', () => {
  const t = parseCsv('a,b\n1,2\n3,4\n');
  assert.deepEqual(t.header, ['a', 'b']);
  assert.deepEqual(t.rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
  assert.deepEqual(t.warnings, []);
});

test('parseCsv: header false keeps all rows, header null', () => {
  const t = parseCsv('1,2\n3,4\n', { header: false });
  assert.equal(t.header, null);
  assert.deepEqual(t.rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('parseCsv: empty input with header true -> header null, rows []', () => {
  const t = parseCsv('');
  assert.equal(t.header, null);
  assert.deepEqual(t.rows, []);
  assert.deepEqual(t.warnings, []);
});

test('parseCsv: trailing newline is ignored (no phantom empty row)', () => {
  const t = parseCsv('a,b\n1,2\n', { header: false });
  assert.deepEqual(t.rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('parseCsv: CRLF and lone CR line endings both work', () => {
  const crlf = parseCsv('a,b\r\n1,2\r\n', { header: false });
  assert.deepEqual(crlf.rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
  const cr = parseCsv('a,b\r1,2\r', { header: false });
  assert.deepEqual(cr.rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

// --- quoting ---------------------------------------------------------------

test('parseCsv: quoted fields with "" escapes', () => {
  const t = parseCsv('a,b\n"he said ""hi""","x,y"\n');
  assert.deepEqual(t.rows, [['he said "hi"', 'x,y']]);
});

test('parseCsv: embedded newlines inside quotes', () => {
  const t = parseCsv('a,b\n"line1\nline2",2\n', { header: false });
  assert.deepEqual(t.rows, [
    ['a', 'b'],
    ['line1\nline2', '2'],
  ]);
});

test('parseCsv: delimiter inside quotes is not a field separator', () => {
  const t = parseCsv('a,b\n"1,2",3\n', { header: false });
  assert.deepEqual(t.rows[1], ['1,2', '3']);
});

test('parseCsv: stray quote mid unquoted field is tolerated with a warning', () => {
  const t = parseCsv('a,b\nfoo"bar,2\n', { header: false });
  assert.deepEqual(t.rows[1], ['foo"bar', '2']);
  assert.ok(t.warnings.some((w) => w.includes('unquoted field')));
});

test('parseCsv: unterminated quote throws CsvParseError with line/col and hint', () => {
  assert.throws(
    () => parseCsv('a,b\n"unterminated,2\n'),
    (err: unknown) => {
      assert.ok(err instanceof CsvParseError);
      assert.equal(typeof err.line, 'number');
      assert.equal(typeof err.col, 'number');
      assert.ok(err.hint && err.hint.length > 0);
      return true;
    },
  );
});

// --- ragged rows & empty lines ----------------------------------------------

test('parseCsv: ragged rows are kept and reported in warnings', () => {
  const t = parseCsv('a,b,c\n1,2,3\n4,5\n');
  assert.deepEqual(t.rows[1], ['4', '5']);
  assert.ok(t.warnings.some((w) => /Row 3 has 2 fields, expected 3/.test(w)));
});

test('parseCsv: empty lines are skipped and counted in warnings', () => {
  const t = parseCsv('a,b\n1,2\n\n\n3,4\n');
  assert.deepEqual(t.rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
  assert.ok(t.warnings.some((w) => /Skipped 2 empty lines/.test(w)));
});

// --- stringifyCsv ---------------------------------------------------------

test('stringifyCsv: quotes only fields that need it', () => {
  const out = stringifyCsv({
    header: ['a', 'b'],
    rows: [['plain', 'has,comma'], ['has"quote', ' leading space']],
  });
  assert.equal(out, 'a,b\nplain,"has,comma"\n"has""quote"," leading space"');
});

test('stringifyCsv: uses LF line endings and supports custom delimiter', () => {
  const out = stringifyCsv({ header: ['a', 'b'], rows: [['1', '2']] }, { delimiter: '\t' });
  assert.equal(out, 'a\tb\n1\t2');
  assert.ok(!out.includes('\r'));
});

test('round trip: parseCsv -> stringifyCsv -> parseCsv preserves data', () => {
  const original = 'name,note\n"Ann, B","she said ""hi""\nline2"\nBob,plain\n';
  const parsed = parseCsv(original);
  const rendered = stringifyCsv(parsed);
  const reparsed = parseCsv(rendered);
  assert.deepEqual(reparsed.header, parsed.header);
  assert.deepEqual(reparsed.rows, parsed.rows);
});

// --- csvToJson / jsonToCsv / coerceCell --------------------------------------

test('csvToJson: header present -> array of objects, values stay strings', () => {
  const t = parseCsv('a,b\n1,2\n3,4\n');
  assert.deepEqual(csvToJson(t), [
    { a: '1', b: '2' },
    { a: '3', b: '4' },
  ]);
});

test('csvToJson: no header -> array of arrays', () => {
  const t = parseCsv('1,2\n3,4\n', { header: false });
  assert.deepEqual(csvToJson(t), [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('coerceCell: coerces booleans and numbers, leaves empty string and other text alone', () => {
  assert.equal(coerceCell(''), '');
  assert.equal(coerceCell('true'), true);
  assert.equal(coerceCell('false'), false);
  assert.equal(coerceCell('42'), 42);
  assert.equal(coerceCell('-3.5'), -3.5);
  assert.equal(coerceCell('1e3'), 1000);
  assert.equal(coerceCell('hello'), 'hello');
  assert.equal(coerceCell('007'), '007'); // not a valid JSON number literal (leading zero)
});

test('jsonToCsv: array of objects -> header is union of keys, first-seen order', () => {
  const table = jsonToCsv([
    { a: 1, b: 2 },
    { b: 3, c: 4 },
  ]);
  assert.deepEqual(table.header, ['a', 'b', 'c']);
  assert.deepEqual(table.rows, [
    ['1', '2', ''],
    ['', '3', '4'],
  ]);
});

test('jsonToCsv: nested values are JSON.stringify-ed, null/undefined -> empty string', () => {
  const table = jsonToCsv([{ a: [1, 2], b: { x: 1 }, c: null, d: undefined }]);
  assert.deepEqual(table.header, ['a', 'b', 'c', 'd']);
  assert.deepEqual(table.rows[0], ['[1,2]', '{"x":1}', '', '']);
});

test('jsonToCsv: array of arrays -> no header', () => {
  const table = jsonToCsv([
    [1, 2],
    [3, 4],
  ]);
  assert.equal(table.header, null);
  assert.deepEqual(table.rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('jsonToCsv: array of primitives -> single "value" column', () => {
  const table = jsonToCsv(['x', 'y', 42]);
  assert.deepEqual(table.header, ['value']);
  assert.deepEqual(table.rows, [['x'], ['y'], ['42']]);
});

test('jsonToCsv: throws a friendly Error for non-array input', () => {
  assert.throws(() => jsonToCsv({ a: 1 } as unknown), /array/);
  assert.throws(() => jsonToCsv('nope' as unknown), /array/);
});
