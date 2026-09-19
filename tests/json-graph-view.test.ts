import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/lib/graph-layout.js';
import { matchNodes, visibleIds, descendantCount, collapseFromDepth, ancestorsOf, describeNode, prettyRaw, nodeDepths } from '../src/views/json-graph.js';

const sample = { order: { id: 'A-1042', customer: { name: 'Ada', tags: ['vip', 'newsletter'] } }, items: [{ sku: 'K-1' }, { sku: 'M-2' }], paid: true };
const g = buildGraph(sample);
const byLabel = (label: string) => g.nodes.find((n) => n.edgeLabel === label)!;

test('matchNodes: case-insensitive over titles, keys and values, BFS order', () => {
  assert.deepEqual(matchNodes(g, 'ada'), [byLabel('customer').id]);
  assert.deepEqual(matchNodes(g, 'SKU').length, 2);
  assert.deepEqual(matchNodes(g, 'items'), [byLabel('items').id]); // title "items [2]"
  assert.deepEqual(matchNodes(g, 'paid'), [0]);
  assert.deepEqual(matchNodes(g, '   '), []);
  assert.deepEqual(matchNodes(g, 'nope'), []);
});

test('visibleIds hides every descendant of a collapsed card, root always visible', () => {
  const all = visibleIds(g, new Set());
  assert.equal(all.size, g.nodes.length);
  const order = byLabel('order');
  const vis = visibleIds(g, new Set([order.id]));
  assert.ok(vis.has(0) && vis.has(order.id) && vis.has(byLabel('items').id));
  assert.ok(!vis.has(byLabel('customer').id) && !vis.has(byLabel('tags').id));
  assert.equal(vis.size, g.nodes.length - descendantCount(g, order.id));
  // collapsing the root leaves only the root
  assert.deepEqual([...visibleIds(g, new Set([0]))], [0]);
});

test('descendantCount / ancestorsOf / nodeDepths', () => {
  assert.equal(descendantCount(g, 0), g.nodes.length - 1);
  assert.equal(descendantCount(g, byLabel('order').id), 2);
  assert.equal(descendantCount(g, byLabel('tags').id), 0);
  assert.deepEqual(ancestorsOf(g, byLabel('tags').id), [byLabel('customer').id, byLabel('order').id, 0]);
  const d = nodeDepths(g);
  assert.equal(d[byLabel('tags').id], 3);
  assert.equal(d[0], 0);
});

test('collapseFromDepth picks containers with children at or below a depth', () => {
  const c1 = collapseFromDepth(g, 1);
  assert.ok(!c1.has(0));
  assert.ok(c1.has(byLabel('order').id) && c1.has(byLabel('items').id) && c1.has(byLabel('customer').id));
  assert.ok(!c1.has(byLabel('tags').id)); // no child cards
  const c2 = collapseFromDepth(g, 2);
  assert.deepEqual([...c2], [byLabel('customer').id]);
  assert.equal(visibleIds(g, c1).size, 3); // $, order, items
});

test('describeNode and prettyRaw', () => {
  assert.equal(describeNode(g.nodes[0]!), 'object, 3 keys');
  assert.equal(describeNode(byLabel('items')), 'array, 2 items');
  assert.equal(describeNode(buildGraph('x').nodes[0]!), 'string');
  assert.equal(describeNode(buildGraph(4).nodes[0]!), 'number');
  assert.equal(prettyRaw('{"a":[1,2]}'), '{\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.equal(prettyRaw('{broken'), '{broken');
});
