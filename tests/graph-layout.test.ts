import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/lib/graph-layout.js';

test('containers become cards, primitives become rows, edges carry keys', () => {
  const g = buildGraph({ a: 1, b: { c: 'x' }, d: [1, { e: null }] });
  assert.equal(g.nodes.length, 4); // $, b, d, d[1]
  const root = g.nodes[0]!;
  assert.equal(root.title, '$ {3}');
  assert.deepEqual(root.rows.map((r) => r.key), ['a']);
  assert.deepEqual(root.children.map((c) => g.nodes[c]!.edgeLabel), ['b', 'd']);
  const d = g.nodes.find((n) => n.edgeLabel === 'd')!;
  assert.equal(d.kind, 'array');
  assert.equal(d.title, 'd [2]');
  assert.deepEqual(g.nodes.find((n) => n.parent === d.id)!.segs, ['d', 1]);
});

test('layout: parent centred over children, siblings do not overlap, levels stack', () => {
  const g = buildGraph({ x: { a: 1 }, y: { b: 2 }, z: { c: 3 } });
  const [root, ...kids] = g.nodes;
  const kidsSorted = [...kids].sort((p, q) => p.x - q.x);
  for (let i = 1; i < kidsSorted.length; i++) {
    assert.ok(kidsSorted[i]!.x >= kidsSorted[i - 1]!.x + kidsSorted[i - 1]!.width, 'siblings overlap');
  }
  const first = kidsSorted[0]!;
  const last = kidsSorted[kidsSorted.length - 1]!;
  const kidsCenter = (first.x + last.x + last.width) / 2;
  assert.ok(Math.abs(root!.x + root!.width / 2 - kidsCenter) < 0.01, 'root not centred');
  assert.ok(kids.every((k) => k.y > root!.y + root!.height));
  assert.ok(g.width >= last.x + last.width - 0.01 && g.height > 0);
});

test('primitive root is a single card', () => {
  const g = buildGraph('hello');
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0]!.kind, 'primitive');
  assert.equal(g.nodes[0]!.rows[0]!.value, '"hello"');
});

test('truncates huge documents breadth-first and caps rows per card', () => {
  const big = Array.from({ length: 100 }, (_, i) => ({ i, nested: { j: i } }));
  const g = buildGraph(big, { maxNodes: 50 });
  assert.equal(g.nodes.length, 50);
  assert.equal(g.truncated, true);
  const wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
  const w = buildGraph(wide, { maxRows: 5 });
  assert.equal(w.nodes[0]!.rows.length, 6);
  assert.equal(w.nodes[0]!.rows[5]!.cls, 'more');
});

test('cards with child cards reserve room for the collapse toggle', () => {
  // nodes[1] has a long title (so the title, not minWidth, sets its width) and one child card
  const doc = { abcdefghijklmnopqrst: { x: {} } };
  const without = buildGraph(doc, { toggleWidth: 0 }).nodes[1]!.width;
  const withToggle = buildGraph(doc, { toggleWidth: 100 }).nodes[1]!.width;
  assert.equal(withToggle, without + 100);
  // the same card without child cards gets no extra room
  const leaf = { abcdefghijklmnopqrst: {} };
  assert.equal(buildGraph(leaf, { toggleWidth: 0 }).nodes[1]!.width, buildGraph(leaf, { toggleWidth: 100 }).nodes[1]!.width);
});
