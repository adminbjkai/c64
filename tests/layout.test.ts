import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSibling,
  removePane,
  movePane,
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

/* ------------------------------------------------------------- movePane */

/** row[a, b, c] with equal thirds. */
function threeInARow() {
  const a = createPane();
  let root = addSibling(a, a.id, 'row');
  const b = allPanes(root)[1]!;
  root = addSibling(root, b.id, 'row');
  const c = allPanes(root)[2]!;
  (root as SplitNode).sizes = [1 / 3, 1 / 3, 1 / 3];
  return { root, a, b, c };
}

test('movePane: onto its own neighbour along the same axis reorders siblings', () => {
  const { root: r0, a, b, c } = threeInARow();
  // c onto a's left edge → row[c, a, b]
  const root = movePane(r0, c.id, a.id, 'left');
  assert.deepEqual(allPanes(root).map((p) => p.id), [c.id, a.id, b.id]);
  const row = root as SplitNode;
  // c gave its third to b, then took half of a's third
  assert.deepEqual(row.sizes.map((x) => +x.toFixed(6)), [+(1 / 6).toFixed(6), +(1 / 6).toFixed(6), +(2 / 3).toFixed(6)]);
  assertInvariants(root);
});

test('movePane: right edge inserts after the target', () => {
  const { root: r0, a, b, c } = threeInARow();
  const root = movePane(r0, a.id, c.id, 'right');
  assert.deepEqual(allPanes(root).map((p) => p.id), [b.id, c.id, a.id]);
  assertInvariants(root);
});

test('movePane: onto a cross-axis edge wraps the target in a new split', () => {
  const { root: r0, a, b, c } = threeInARow();
  // c below a → row[col[a, c], b]
  const root = movePane(r0, c.id, a.id, 'bottom') as SplitNode;
  assert.equal(root.dir, 'row');
  assert.equal(root.children.length, 2);
  const wrap = root.children[0] as SplitNode;
  assert.equal(wrap.type, 'split');
  assert.equal(wrap.dir, 'col');
  assert.deepEqual(wrap.children.map((n) => n.id), [a.id, c.id]);
  assert.deepEqual(wrap.sizes, [0.5, 0.5]);
  assert.equal(root.children[1], b);
  assertInvariants(root);
  // top puts it before
  const root2 = movePane(root, c.id, a.id, 'top') as SplitNode;
  assert.deepEqual((root2.children[0] as SplitNode).children.map((n) => n.id), [c.id, a.id]);
  assertInvariants(root2);
});

test('movePane: into a different subtree collapses the emptied split', () => {
  // row[a, col[b, c]] → move a to the right of c → col[b, row[c, a]]
  const a = createPane();
  let root = addSibling(a, a.id, 'row');
  const b = allPanes(root)[1]!;
  root = addSibling(root, b.id, 'col');
  const c = allPanes(root)[2]!;
  root = movePane(root, a.id, c.id, 'right');
  const col = root as SplitNode;
  assert.equal(col.type, 'split');
  assert.equal(col.dir, 'col');
  assert.equal(col.children[0], b);
  const row = col.children[1] as SplitNode;
  assert.equal(row.dir, 'row');
  assert.deepEqual(row.children.map((n) => n.id), [c.id, a.id]);
  assert.equal(paneCount(root), 3);
  assertInvariants(root);
});

test('movePane: onto the root-level target of a two-pane board flips the axis', () => {
  const a = createPane();
  const r0 = addSibling(a, a.id, 'row');
  const b = allPanes(r0)[1]!;
  const root = movePane(r0, b.id, a.id, 'top') as SplitNode;
  assert.equal(root.dir, 'col');
  assert.deepEqual(root.children.map((n) => n.id), [b.id, a.id]);
  assert.deepEqual(root.sizes, [0.5, 0.5]);
  assertInvariants(root);
});

test('movePane: no-ops for self, unknown ids and a lone root pane', () => {
  const lone = createPane();
  const other = createPane();
  assert.equal(movePane(lone, lone.id, other.id, 'left'), lone);
  const { root, a, b } = threeInARow();
  assert.equal(movePane(root, a.id, a.id, 'left'), root);
  assert.equal(movePane(root, 'nope', a.id, 'left'), root);
  assert.equal(movePane(root, a.id, 'nope', 'left'), root);
  assert.deepEqual(allPanes(root).map((p) => p.id).slice(0, 2), [a.id, b.id]);
  assertInvariants(root);
});

test('movePane: invariants hold across a random walk of moves', () => {
  let root: LayoutNode = createPane();
  for (let i = 0; i < 5; i++) root = addSibling(root, allPanes(root)[i % allPanes(root).length]!.id, i % 2 ? 'col' : 'row');
  const edges = ['left', 'right', 'top', 'bottom'] as const;
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
  for (let i = 0; i < 200; i++) {
    const panes = allPanes(root);
    const from = panes[rnd(panes.length)]!;
    const to = panes[rnd(panes.length)]!;
    root = movePane(root, from.id, to.id, edges[rnd(4)]!);
    assert.equal(paneCount(root), 6);
    assertInvariants(root);
  }
});

test('sanitize keeps a valid viewAs and drops junk', () => {
  const p = (state: Record<string, unknown>) => (sanitize({ type: 'pane', id: 'p', state }) as { state: { viewAs?: string } }).state;
  assert.equal(p({ viewAs: 'tree' }).viewAs, 'tree');
  assert.equal(p({ viewAs: 'table' }).viewAs, 'table');
  assert.equal(p({ viewAs: 'text' }).viewAs, undefined);
  assert.equal(p({ viewAs: 'x' }).viewAs, undefined);
});
