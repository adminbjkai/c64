import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runYamlDiff, yamlDiffMode } from '../src/modes/yaml-diff.js';
import { applyJsonPatch } from '../src/lib/structural-diff.js';
import { parseYaml } from '../src/lib/yaml.js';
import type { StructDiffData } from '../src/views/struct-diff.js';

const ctx = (options: Record<string, unknown> = {}, pretty = true, inputB = '') => ({ pretty, options, inputB });
const ops = (d: StructDiffData) => d.changes.map((c) => `${c.op} ${c.path}`);

test('sample: value changes, a string→boolean type change, an added key and an array item', () => {
  const r = runYamlDiff(yamlDiffMode.sample, ctx({}, true, yamlDiffMode.sampleB!));
  assert.equal(r.error, undefined);
  const d = r.view!.data as StructDiffData;
  assert.deepEqual(ops(d), ['replace /env/DEBUG', 'replace /env/LOG_LEVEL', 'add /env/TRACE', 'replace /image', 'add /ports/2', 'replace /replicas']);
  assert.equal(d.changes.find((c) => c.path === '/env/DEBUG')!.kind, 'type');
  assert.equal(r.status, '3 changed · 2 added · 0 removed · 1 type change');
  assert.match(r.output, /^! \/env\/DEBUG: "false" → false \(string → boolean\)$/m);
  const raw = runYamlDiff(yamlDiffMode.sample, ctx({}, false, yamlDiffMode.sampleB!));
  assert.deepEqual(applyJsonPatch(parseYaml(yamlDiffMode.sample), JSON.parse(raw.output)), parseYaml(yamlDiffMode.sampleB!));
});

test('formatting, comments and quoting never count as changes', () => {
  const r = runYamlDiff('# one\na: 1\nb:\n  - x\n  - y\nc: "s"\n', ctx({}, true, "b: [x, y]\nc: 's'\na: 1 # same\n"));
  assert.equal(r.status, 'Identical');
  assert.equal(r.output, '');
});

test('controls: lcs arrays and ignorePaths', () => {
  const a = 'items:\n  - a\n  - b\n  - c\nmeta:\n  ts: 1\n';
  const b = 'items:\n  - z\n  - a\n  - b\n  - c\nmeta:\n  ts: 2\n';
  assert.equal((runYamlDiff(a, ctx({}, true, b)).view!.data as StructDiffData).changes.length, 5);
  const d = runYamlDiff(a, ctx({ arrays: 'lcs', ignorePaths: '/meta/ts' }, true, b)).view!.data as StructDiffData;
  assert.deepEqual(ops(d), ['add /items/0']);
});

test('empty input and parse errors attributed to a side', () => {
  assert.deepEqual(runYamlDiff('', ctx()), { output: '', status: '' });
  const bad = runYamlDiff('a: 1\n\tb: 2\n', ctx({}, true, 'a: 1'));
  assert.match(bad.error!.message, /^Original: /);
  assert.equal(bad.error!.line, 2);
  const badB = runYamlDiff('a: 1', ctx({}, true, 'a: [1, 2'));
  assert.match(badB.error!.message, /^Changed: /);
  assert.match(badB.status!, /Invalid YAML in Changed/);
});
