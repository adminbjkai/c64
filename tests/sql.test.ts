import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSql, minifySql, tokenizeSql, countStatements, SqlParseError } from '../src/lib/sql.js';
import { runSql, sqlMode } from '../src/modes/sql.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });

test('sample runs in both modes with a statement count', () => {
  const pretty = runSql(sqlMode.sample, ctx());
  assert.equal(pretty.error, undefined);
  assert.match(pretty.status ?? '', /^2 statements · /);
  const raw = runSql(sqlMode.sample, ctx({}, false));
  assert.equal(raw.error, undefined);
  assert.equal(raw.output.split('\n').length, 2);
});

test('empty input returns empty output and status', () => {
  assert.deepEqual(runSql('  ', ctx()), { output: '', status: '' });
});

test('basic select: clauses on their own lines, one select item per line, AND indented', () => {
  const out = formatSql("select a, b from t where x = 1 and y = 'z' order by a");
  assert.equal(out, "SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1\n  AND y = 'z'\nORDER BY\n  a");
});

test('lowercase keywords when uppercaseKeywords is false; identifiers untouched', () => {
  const out = runSql('SELECT Foo FROM Bar WHERE Baz IS NOT NULL', ctx({ uppercaseKeywords: false })).output;
  assert.equal(out, 'select\n  Foo\nfrom\n  Bar\nwhere\n  Baz is not null');
});

test('comma at start of line with commaStyle=start', () => {
  const out = runSql('select a, b, c from t', ctx({ commaStyle: 'start' })).output;
  assert.equal(out, 'SELECT\n  a\n  , b\n  , c\nFROM\n  t');
});

test('indent control honours 4 spaces and tab', () => {
  assert.equal(runSql('select a from t', ctx({ indent: '4' })).output, 'SELECT\n    a\nFROM\n    t');
  assert.equal(runSql('select a from t', ctx({ indent: 'tab' })).output, 'SELECT\n\ta\nFROM\n\tt');
});

test('joins and ON go on their own lines', () => {
  const out = formatSql('select * from a left outer join b on a.id = b.a_id inner join c on c.id = b.c_id');
  assert.equal(out, 'SELECT\n  *\nFROM\n  a\nLEFT OUTER JOIN b\n  ON a.id = b.a_id\nINNER JOIN c\n  ON c.id = b.c_id');
});

test('nested subquery in parentheses is indented and closed at the outer level', () => {
  const out = formatSql('select id from t where id in (select t_id from u where k > 2)');
  assert.equal(out, 'SELECT\n  id\nFROM\n  t\nWHERE\n  id IN (\n    SELECT\n      t_id\n    FROM\n      u\n    WHERE\n      k > 2\n  )');
});

test('function calls and IN lists stay inline; unary minus has no space', () => {
  const out = formatSql('select count(*), max(a) from t where b in (1, 2, 3) and c = -1');
  assert.equal(out, 'SELECT\n  count(*),\n  max(a)\nFROM\n  t\nWHERE\n  b IN (1, 2, 3)\n  AND c = -1');
});

test('string literals, quoted identifiers, backticks and $$ bodies are preserved verbatim', () => {
  const src = 'select "My Col", `tbl`.x, \'it\'\'s  a   string\', $fn$ raw $$ body $fn$ from t';
  const out = formatSql(src);
  assert.ok(out.includes('"My Col"'));
  assert.ok(out.includes('`tbl`.x'));
  assert.ok(out.includes("'it''s  a   string'"));
  assert.ok(out.includes('$fn$ raw $$ body $fn$'));
  const toks = tokenizeSql(src).filter((t) => t.type === 'string');
  assert.equal(toks.length, 4);
});

test('comments are preserved; line comments end the line', () => {
  const out = formatSql('select a -- first\n, b /* block */ from t');
  assert.equal(out, 'SELECT\n  a -- first\n  , b /* block */\nFROM\n  t');
});

test('multiple statements are separated by a blank line', () => {
  const out = formatSql('delete from t where id = 1; update t set a = 1, b = 2 where id = 2;');
  assert.equal(out, 'DELETE FROM t\nWHERE\n  id = 1;\n\nUPDATE t\nSET\n  a = 1,\n  b = 2\nWHERE\n  id = 2;');
});

test('CREATE TABLE column list is one column per line', () => {
  const out = formatSql('create table users (id serial primary key, name text not null)');
  assert.equal(out, 'CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n)');
});

test('CASE / WHEN / ELSE / END layout and BETWEEN … AND stays inline', () => {
  const out = formatSql("select case when x > 0 then 'p' else 'n' end as s from t where y between 1 and 5 and z = 1");
  assert.equal(out, "SELECT\n  CASE\n    WHEN x > 0 THEN 'p'\n    ELSE 'n'\n  END AS s\nFROM\n  t\nWHERE\n  y BETWEEN 1 AND 5\n  AND z = 1");
});

test('minify produces one single-spaced line per statement', () => {
  const out = minifySql('select   a,\n   b\nfrom t\nwhere x = 1; -- done\nselect 2;');
  assert.equal(out, 'SELECT a, b FROM t WHERE x = 1;\n/* done */ SELECT 2;');
});

test('countStatements ignores comments and counts a trailing statement', () => {
  assert.equal(countStatements('select 1; select 2'), 2);
  assert.equal(countStatements('select 1; -- c\n'), 1);
  assert.equal(countStatements('select 1;;'), 1);
});

test('unterminated string is an error with line/col', () => {
  const r = runSql("select 1;\nselect 'oops from t", ctx());
  assert.ok(r.error);
  assert.equal(r.error?.line, 2);
  assert.equal(r.error?.col, 8);
  assert.match(r.error?.hint ?? '', /closing '/);
  assert.throws(() => formatSql('/* never closed'), SqlParseError);
});

test('weird SQL never throws — best-effort output', () => {
  for (const src of ['select ((( from', ') ) )', 'wat wat wat', 'select case end end', 'select a from b where']) {
    const r = runSql(src, ctx());
    assert.equal(r.error, undefined, src);
    assert.ok(r.output.length > 0, src);
  }
});
