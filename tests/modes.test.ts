import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJsonTree, runJsonPath } from '../src/modes/json-tree.js';
import { runJsonGraph } from '../src/modes/json-graph.js';
import { runXml } from '../src/modes/xml.js';
import { runYaml } from '../src/modes/yaml.js';
import { runCsv } from '../src/modes/csv.js';
import { runConvert, sniffFormat } from '../src/modes/convert.js';
import { runCss } from '../src/modes/css.js';
import { runMinify, sniffMinifyKind } from '../src/modes/minify.js';
import { parseJsonWithSpans } from '../src/modes/json.js';
import { pathKey } from '../src/modes/json-parse.js';
import { MODES, getMode } from '../src/modes/index.js';
import type { TreeData } from '../src/views/json-tree.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true) => ({ pretty, options });

test('every registered mode has a sample that runs without error', async () => {
  const ids = new Set<string>();
  for (const m of MODES) {
    assert.ok(!ids.has(m.id), `duplicate mode id ${m.id}`);
    ids.add(m.id);
    const r = await m.run(m.sample, { ...ctx(m.sampleOptions ?? {}), ...(m.inputs === 2 ? { inputB: m.sampleB ?? '' } : {}) });
    assert.equal(r.error, undefined, `${m.id} sample failed: ${r.error?.message}`);
    assert.ok(r.output.length > 0 || r.view, `${m.id} produced nothing`);
    // Generators (uuid, lorem) produce output for empty input by design.
    if (!['uuid', 'lorem'].includes(m.id)) assert.equal((await m.run('', ctx())).output, '', `${m.id} empty input`);
  }
  assert.equal(getMode('nope').id, 'json');
  assert.equal(MODES[0]!.id, 'auto', 'Auto detect is the first registered tool');
  assert.equal(MODES[0]!.category, 'Start');
});

test('auto mode formats JSON and never errors on other input', async () => {
  const auto = getMode('auto');
  const ok = await auto.run('{"a":1}', ctx());
  assert.equal(ok.output, '{\n  "a": 1\n}');
  const other = await auto.run('hello world, not json', ctx());
  assert.equal(other.error, undefined);
  assert.equal(other.output, '');
  assert.equal(other.status, 'Not recognised yet');
  assert.deepEqual(other.notes, ['Pick a tool from the sidebar or the chips below.']);
});

test('parseJsonWithSpans records source offsets per path', () => {
  const text = '{"a": [10, {"b": "x"}], "c": null}';
  const { spans } = parseJsonWithSpans(text);
  const span = (segs: (string | number)[]) => {
    const s = spans.get(pathKey(segs))!;
    return text.slice(s[0], s[1]);
  };
  assert.equal(span([]), text);
  assert.equal(span(['a']), '[10, {"b": "x"}]');
  assert.equal(span(['a', 0]), '10');
  assert.equal(span(['a', 1, 'b']), '"x"');
  assert.equal(span(['c']), 'null');
});

test('tree mode returns a json-tree view with the value and spans', () => {
  const r = runJsonTree('{"a":[1,2]}', ctx());
  assert.equal(r.view?.kind, 'json-tree');
  const d = r.view!.data as TreeData;
  assert.deepEqual(d.value, { a: [1, 2] });
  assert.ok(d.spans.size >= 4);
  assert.match(r.status!, /object · 1 key/);
  assert.ok(runJsonTree('{oops', ctx()).error);
});

test('path mode runs live JSONPath queries and reports bad ones', () => {
  const doc = '{"items":[{"n":"a","p":5},{"n":"b","p":15}]}';
  const r = runJsonPath(doc, ctx({ query: '$.items[?(@.p > 10)].n' }));
  const d = r.view!.data as TreeData;
  assert.equal(d.path!.matches.length, 1);
  assert.deepEqual(d.path!.matches[0]!.path, ['items', 1, 'n']);
  assert.equal(r.output, '[\n  "b"\n]');
  assert.match(r.status!, /^1 match/);
  const bad = runJsonPath(doc, ctx({ query: '$.items[' }));
  assert.ok((bad.view!.data as TreeData).path!.queryError);
  assert.equal(bad.error, undefined, 'a bad query is not an input error');
  const none = runJsonPath(doc, ctx());
  assert.equal((none.view!.data as TreeData).path!.matches.length, 0);
});

test('graph mode builds cards with spans', () => {
  const r = runJsonGraph('{"a":{"b":1},"c":[1,2]}', ctx());
  assert.equal(r.view?.kind, 'json-graph');
  const { graph } = r.view!.data as { graph: { nodes: unknown[] } };
  assert.equal(graph.nodes.length, 3);
  assert.match(r.status!, /3 cards/);
});

test('xml mode formats, minifies and reports errors', () => {
  const r = runXml('<a><b x="1">t</b></a>', ctx());
  assert.equal(r.output, '<a>\n  <b x="1">t</b>\n</a>');
  assert.equal(runXml('<a> <b/> </a>', ctx({}, false)).output, '<a><b/></a>');
  const bad = runXml('<a><b></a>', ctx());
  assert.ok(bad.error?.line);
  assert.match(bad.status!, /Invalid XML/);
});

test('yaml mode validates; Raw shows JSON', () => {
  const r = runYaml('a: 1\nb:\n  - x\n  - y\n', ctx());
  assert.equal(r.output, 'a: 1\nb:\n  - x\n  - y');
  assert.equal(runYaml('a: 1', ctx({}, false)).output, '{\n  "a": 1\n}');
  assert.ok(runYaml('a: [1, 2', ctx()).error);
});

test('csv mode detects delimiter, previews table, warns on ragged rows', () => {
  const r = runCsv('a;b\n1;2\n3', ctx());
  assert.equal(r.view?.kind, 'table');
  assert.match(r.status!, /semicolon-separated · 2 rows · 2 columns/);
  assert.ok(r.notes?.some((n) => /Row 3/.test(n)));
  const noHeader = runCsv('1,2\n3,4', ctx({ header: false }, false));
  assert.equal(noHeader.view, undefined);
  assert.equal(noHeader.output, '1,2\n3,4');
});

test('convert mode: JSON→YAML, JSON→CSV, XML→JSON, YAML→JSON, CSV→JSON typed', () => {
  assert.equal(runConvert('{"a":1,"b":[1]}', ctx({ to: 'yaml' })).output, 'a: 1\nb:\n  - 1');
  assert.equal(runConvert('[{"a":1,"b":"x"},{"a":2}]', ctx({ to: 'csv' })).output, 'a,b\n1,x\n2,');
  assert.equal(runConvert('<r><n>1</n><n>2</n></r>', ctx({ to: 'json' })).output, '{\n  "r": {\n    "n": [\n      "1",\n      "2"\n    ]\n  }\n}');
  assert.equal(runConvert('a: 1', ctx({ from: 'yaml', to: 'json' })).output, '{\n  "a": 1\n}');
  assert.equal(runConvert('a,b\n1,true', ctx({ from: 'csv', to: 'json', typedCells: true })).output, '[\n  {\n    "a": 1,\n    "b": true\n  }\n]');
  const bad = runConvert('{"a":1}', ctx({ to: 'csv' }));
  assert.match(bad.error!.message, /Cannot emit CSV/);
  assert.equal(sniffFormat('a,b\n1,2'), 'csv');
  assert.equal(sniffFormat('a: 1'), 'yaml');
  assert.equal(sniffFormat('<a/>'), 'xml');
  assert.equal(runConvert('{"a":{"b":1}}', ctx({ to: 'xml' })).output, '<a>\n  <b>1</b>\n</a>');
});

test('css mode beautifies and minifies', () => {
  const r = runCss('a{color:red;margin:0}', ctx());
  assert.equal(r.output, 'a {\n  color: red;\n  margin: 0;\n}');
  assert.equal(runCss('a {\n  color: red;\n}', ctx({}, false)).output, 'a{color:red}');
  assert.ok(runCss('a { color: red', ctx()).error?.line);
});

test('generic minify/prettify sniffs the language', () => {
  assert.equal(sniffMinifyKind('{"a":1}'), 'json');
  assert.equal(sniffMinifyKind('<a/>'), 'xml');
  assert.equal(sniffMinifyKind('a{b:c}'), 'css');
  assert.equal(runMinify('{ "a" : 1 }', ctx({}, false)).output, '{"a":1}');
  assert.equal(runMinify('<a> <b/> </a>', ctx()).output, '<a>\n  <b/>\n</a>');
  assert.equal(runMinify('a{b:c}', ctx({ kind: 'css' })).output, 'a {\n  b: c;\n}');
});
