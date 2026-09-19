import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSibling,
  removePane,
  resizeSeam,
  sanitize,
  createPane,
  allPanes,
  paneCount,
  findParent,
  clonePane,
  defaultPaneState,
  MIN_FRACTION,
  type LayoutNode,
  type SplitNode,
} from '../src/layout.js';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Every split has ≥2 children, sizes match and sum to 1, no same-dir nesting. */
function assertInvariants(node: LayoutNode): void {
  if (node.type === 'pane') return;
  assert.ok(node.children.length >= 2, 'split has ≥ 2 children');
  assert.equal(node.sizes.length, node.children.length, 'sizes match children');
  assert.ok(Math.abs(sum(node.sizes) - 1) < 1e-9, 'sizes sum to 1');
  for (const c of node.children) {
    if (c.type === 'split') assert.notEqual(c.dir, node.dir, 'no same-direction nesting');
    assertInvariants(c);
  }
}

test('add right on a lone pane creates a row split', () => {
  const a = createPane();
  const root = addSibling(a, a.id, 'row') as SplitNode;
  assert.equal(root.type, 'split');
  assert.equal(root.dir, 'row');
  assert.equal(root.children[0], a);
  assert.deepEqual(root.sizes, [0.5, 0.5]);
  assertInvariants(root);
});

test('add along the same axis joins the existing split, splitting the target share', () => {
  const a = createPane();
  let root = addSibling(a, a.id, 'row');
  const b = allPanes(root)[1]!;
  root = addSibling(root, a.id, 'row'); // insert after a, before b
  const split = root as SplitNode;
  assert.equal(split.children.length, 3);
  assert.equal(split.children[2], b);
  assert.deepEqual(split.sizes, [0.25, 0.25, 0.5]);
  assertInvariants(root);
});

test('add below inside a row wraps the target in a column split (mixed tiling)', () => {
  const a = createPane();
  let root = addSibling(a, a.id, 'row');
  root = addSibling(root, a.id, 'col');
  const row = root as SplitNode;
  assert.equal(row.dir, 'row');
  const wrapper = row.children[0] as SplitNode;
  assert.equal(wrapper.type, 'split');
  assert.equal(wrapper.dir, 'col');
  assert.equal(wrapper.children[0], a);
  assert.equal(paneCount(root), 3);
  assertInvariants(root);
});

test('the last pane cannot be removed', () => {
  const a = createPane();
  assert.equal(removePane(a, a.id), a);
});

test('removing a pane gives its space to the previous sibling and collapses lone splits', () => {
  const a = createPane();
  let root = addSibling(a, a.id, 'row');
  const b = allPanes(root)[1]!;
  root = addSibling(root, b.id, 'col');
  const c = allPanes(root)[2]!;
  // row[a, col[b, c]] → remove c → row[a, b]
  root = removePane(root, c.id);
  const row = root as SplitNode;
  assert.equal(row.children.length, 2);
  assert.equal(row.children[1], b);
  assertInvariants(root);
  // remove a → b alone as root
  root = removePane(root, a.id);
  assert.equal(root, b);
});

test('removing the middle of three siblings hands its share to the previous one', () => {
  const a = createPane();
  let root = addSibling(a, a.id, 'row');
  root = addSibling(root, a.id, 'row');
  const [, mid] = allPanes(root);
  root = removePane(root, mid!.id);
  assert.deepEqual((root as SplitNode).sizes, [0.5, 0.5]);
  assertInvariants(root);
});

test('collapse merges a same-direction grandchild into its grandparent', () => {
  // row[a, col[b, row[c, d]]] → remove b → row[a, c, d] with scaled sizes
  const a = createPane();
  let root = addSibling(a, a.id, 'row');
  const b = allPanes(root)[1]!;
  root = addSibling(root, b.id, 'col');
  const c = allPanes(root)[2]!;
  root = addSibling(root, c.id, 'row');
  root = removePane(root, b.id);
  const row = root as SplitNode;
  assert.equal(row.children.length, 3);
  assert.ok(row.children.every((ch) => ch.type === 'pane'));
  assert.deepEqual(row.sizes, [0.5, 0.25, 0.25]);
  assertInvariants(root);
});

test('resizeSeam redistributes between neighbours and clamps at MIN_FRACTION', () => {
  const a = createPane();
  const root = addSibling(a, a.id, 'row') as SplitNode;
  resizeSeam(root, 0, 0.2);
  assert.deepEqual(root.sizes.map((x) => +x.toFixed(6)), [0.7, 0.3]);
  resizeSeam(root, 0, -5);
  assert.ok(Math.abs(root.sizes[0]! - MIN_FRACTION) < 1e-9);
  assert.ok(Math.abs(sum(root.sizes) - 1) < 1e-9);
});

test('sanitize repairs bad sizes and drops garbage, returns null for junk', () => {
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({ type: 'nope' }), null);
  const fixed = sanitize({
    type: 'split',
    id: 's1',
    dir: 'row',
    sizes: [1, 'x'],
    children: [
      { type: 'pane', id: 'p1', state: { mode: 'json', input: 'x', seam: 7, pretty: false } },
      { type: 'pane', id: 'p2' },
      { garbage: true },
    ],
  }) as SplitNode;
  assert.equal(fixed.children.length, 2);
  assert.deepEqual(fixed.sizes, [0.5, 0.5]);
  const p1 = fixed.children[0]!;
  assert.equal(p1.type, 'pane');
  if (p1.type === 'pane') {
    assert.equal(p1.state.seam, 1); // clamped
    assert.equal(p1.state.pretty, false);
    assert.equal(p1.state.input, 'x');
  }
  assertInvariants(fixed);
  // single surviving child collapses to that child
  const lone = sanitize({ type: 'split', id: 's', dir: 'col', children: [{ type: 'pane', id: 'p' }] });
  assert.equal(lone?.type, 'pane');
});

test('new panes start in Auto detect; clones keep their tool and drop the detected flag only when told', () => {
  assert.equal(defaultPaneState().mode, 'auto');
  assert.equal(createPane({ mode: 'jwt' }).state.mode, 'jwt');
  const a = createPane({ mode: 'json', input: 'x', detected: true });
  assert.equal(clonePane(a).state.mode, 'json');
  assert.equal(clonePane(a).state.detected, true);
  assert.ok(!('fresh' in defaultPaneState()));
});

test('sanitize keeps detected and maps legacy fresh panes to Auto', () => {
  const p = (state: Record<string, unknown>) => (sanitize({ type: 'pane', id: 'p', state }) as { state: { mode: string; detected?: boolean; fresh?: unknown } }).state;
  assert.equal(p({ detected: true, mode: 'json', input: '{}' }).detected, true);
  assert.equal(p({ detected: 'yes', mode: 'json' }).detected, undefined);
  // legacy: an untouched fresh pane becomes Auto; anything set up keeps its tool
  assert.equal(p({ fresh: true, mode: 'json', input: '' }).mode, 'auto');
  assert.equal(p({ fresh: true, mode: 'jwt', input: '' }).mode, 'auto');
  assert.equal(p({ fresh: true, mode: 'json', input: '{}' }).mode, 'json');
  assert.equal(p({ fresh: false, mode: 'json', input: '' }).mode, 'json');
  assert.equal(p({ mode: 'jwt', input: '' }).mode, 'jwt');
  assert.equal(p({}).mode, 'json');
  assert.ok(!('fresh' in p({ fresh: true })));
});

test('findParent locates the immediate split', () => {
  const a = createPane();
  const root = addSibling(a, a.id, 'col');
  assert.equal(findParent(root, a.id), root);
  assert.equal(findParent(a, a.id), null);
});
