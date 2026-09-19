/**
 * Layout model — the tiling tree behind the board.
 *
 * The board is a binary-ish tree: a `SplitNode` lays its children out in a
 * row (left→right) or a column (top→bottom); a `PaneNode` is a leaf holding
 * one tool instance. Sibling sizes are fractions that sum to 1.
 *
 * This module is pure and DOM-free so it can be unit-tested with `node --test`
 * and so the renderer stays a thin projection of this state.
 *
 * Invariants maintained by every operation here:
 *   - A split always has ≥ 2 children (a split with one child is collapsed).
 *   - Nested splits never share their parent's direction (they get merged).
 *   - There is always at least one pane (the last pane cannot be removed).
 *   - `sizes.length === children.length` and sizes sum to 1 (± float noise).
 */

export type Direction = 'row' | 'col';

export interface PaneState {
  /** Tool mode id, e.g. "json". Modes are registered in src/modes. */
  mode: string;
  input: string;
  /** Second text for two-input (compare) tools. */
  inputB?: string;
  /** Fraction of the pane's height given to the input editor (0–1). */
  seam: number;
  /** Raw (literal/minified) vs Pretty (formatted/structured) output. */
  pretty: boolean;
  /** Input above output (stacked) or input beside output (side). */
  layout: 'stacked' | 'side';
  /** Per-mode options (indent, sort keys, …). Free-form, owned by the mode. */
  options: Record<string, unknown>;
  /** Optional user-given name shown in the pane header and the palette. */
  title?: string;
  /** When set, this pane's input mirrors the output of that pane (a pipe). */
  sourceId?: string;
  /** Soft-wrap long lines in the editor and text output. */
  wrap?: boolean;
  /**
   * True when the current tool was chosen by Auto detect rather than by the
   * user. The pane then shows a "Detected … · change" chip. Any manual tool
   * choice clears it; Clear returns the pane to `auto`.
   */
  detected?: boolean;
  /** How a JSON-valued result is shown: as text, a collapsible tree or a table. */
  viewAs?: 'text' | 'tree' | 'table';
}

/** Side of a target pane a dragged pane is dropped on. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface PaneNode {
  type: 'pane';
  id: string;
  state: PaneState;
}

export interface SplitNode {
  type: 'split';
  id: string;
  dir: Direction;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;

/** Smallest fraction a sibling can be dragged down to. Keeps panes grabbable. */
export const MIN_FRACTION = 0.08;

let counter = 0;
/** Short, unique-enough ids. Time prefix keeps them unique across reloads. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function defaultPaneState(overrides: Partial<PaneState> = {}): PaneState {
  return { mode: 'auto', input: '', seam: 0.5, pretty: true, layout: 'stacked', options: {}, ...overrides };
}

export function createPane(state: Partial<PaneState> = {}): PaneNode {
  return { type: 'pane', id: newId('p'), state: defaultPaneState(state) };
}

/* ---------------------------------------------------------------- lookup */

export function findPane(root: LayoutNode, id: string): PaneNode | null {
  if (root.type === 'pane') return root.id === id ? root : null;
  for (const c of root.children) {
    const hit = findPane(c, id);
    if (hit) return hit;
  }
  return null;
}

export function findParent(root: LayoutNode, id: string): SplitNode | null {
  if (root.type === 'pane') return null;
  for (const c of root.children) {
    if (c.id === id) return root;
    const deeper = findParent(c, id);
    if (deeper) return deeper;
  }
  return null;
}

export function allPanes(root: LayoutNode, out: PaneNode[] = []): PaneNode[] {
  if (root.type === 'pane') out.push(root);
  else root.children.forEach((c) => allPanes(c, out));
  return out;
}

export function paneCount(root: LayoutNode): number {
  return allPanes(root).length;
}

/** Deep copy of a subtree (states included) with fresh ids — for duplicating. */
export function clonePane(node: PaneNode): PaneNode {
  return createPane({ ...node.state, options: { ...node.state.options } });
}

/* ------------------------------------------------------------ mutations */
// Mutations return the (possibly new) root. They mutate in place for speed
// and simplicity — the board owns the tree and re-renders after each call.

/**
 * Insert `fresh` immediately after pane `targetId`, along `dir`.
 * Add Right = 'row', Add Below = 'col'. The target gives up half its space.
 */
export function addSibling(
  root: LayoutNode,
  targetId: string,
  dir: Direction,
  fresh: PaneNode = createPane(),
): LayoutNode {
  return insertBeside(root, targetId, dir, fresh, false);
}

/** Shared by addSibling and movePane: put `fresh` before or after `targetId` along `dir`. */
function insertBeside(root: LayoutNode, targetId: string, dir: Direction, fresh: LayoutNode, before: boolean): LayoutNode {
  const parent = findParent(root, targetId);
  const target = parent ? parent.children.find((c) => c.id === targetId) : root;
  if (!target) return root;

  if (parent && parent.dir === dir) {
    // Same axis: become one more sibling, splitting the target's share.
    const i = parent.children.indexOf(target);
    const share = parent.sizes[i] ?? 0;
    parent.children.splice(before ? i : i + 1, 0, fresh);
    parent.sizes.splice(i, 1, share / 2, share / 2);
    return root;
  }

  // Different axis (or the target is the root): wrap target in a new split.
  const wrapper: SplitNode = {
    type: 'split',
    id: newId('s'),
    dir,
    children: before ? [fresh, target] : [target, fresh],
    sizes: [0.5, 0.5],
  };
  if (!parent) return wrapper;
  parent.children[parent.children.indexOf(target)] = wrapper;
  return root;
}

/**
 * Move pane `paneId` so it sits on `edge` of pane `targetId` (drag-to-reorder).
 * The pane is detached first (its space goes to its old neighbour, lone
 * splits collapse), then inserted beside the target: right/bottom = after
 * along the row/column, left/top = before. It takes half the target's share.
 * Returns root unchanged when either pane is missing or they are the same.
 */
export function movePane(root: LayoutNode, paneId: string, targetId: string, edge: Edge): LayoutNode {
  if (paneId === targetId) return root;
  const node = findPane(root, paneId);
  if (!node || !findPane(root, targetId)) return root;
  if (!findParent(root, paneId)) return root; // lone root pane: nowhere to go
  root = removePane(root, paneId);
  const dir: Direction = edge === 'left' || edge === 'right' ? 'row' : 'col';
  return insertBeside(root, targetId, dir, node, edge === 'left' || edge === 'top');
}

/**
 * Remove pane `id`. Refuses (returns root unchanged) when it is the last one —
 * the board is never empty. Freed space goes to the neighbour that took the
 * removed pane's place (previous sibling when there is one).
 */
export function removePane(root: LayoutNode, id: string): LayoutNode {
  const parent = findParent(root, id);
  if (!parent) return root; // root pane, or not found → nothing to do

  const i = parent.children.findIndex((c) => c.id === id);
  const freed = parent.sizes[i] ?? 0;
  parent.children.splice(i, 1);
  parent.sizes.splice(i, 1);
  const heir = i > 0 ? i - 1 : 0;
  parent.sizes[heir] = (parent.sizes[heir] ?? 0) + freed;

  return collapse(root, parent);
}

/** Collapse a split that has a single child into its parent (or root). */
function collapse(root: LayoutNode, split: SplitNode): LayoutNode {
  if (split.children.length > 1) return root;
  const only = split.children[0]!;
  const grand = findParent(root, split.id);
  if (!grand) return only;

  const i = grand.children.indexOf(split);
  if (only.type === 'split' && only.dir === grand.dir) {
    // Merge same-direction grandchild into grandparent, scaling its sizes.
    const share = grand.sizes[i] ?? 0;
    grand.children.splice(i, 1, ...only.children);
    grand.sizes.splice(i, 1, ...only.sizes.map((s) => s * share));
  } else {
    grand.children[i] = only;
  }
  return root;
}

/** Swap two panes in place (their positions and sizes trade). */
export function swapPanes(root: LayoutNode, a: string, b: string): void {
  const pa = findParent(root, a);
  const pb = findParent(root, b);
  if (!pa || !pb || a === b) return;
  const ia = pa.children.findIndex((c) => c.id === a);
  const ib = pb.children.findIndex((c) => c.id === b);
  const na = pa.children[ia]!;
  const nb = pb.children[ib]!;
  pa.children[ia] = nb;
  pb.children[ib] = na;
}

/**
 * Resize the seam after child `index` of split `splitId` so that the pair of
 * siblings around it redistributes `delta` (a fraction of the split's
 * extent, positive = grow the earlier sibling). Clamped to MIN_FRACTION.
 */
export function resizeSeam(split: SplitNode, index: number, delta: number): void {
  const a = split.sizes[index];
  const b = split.sizes[index + 1];
  if (a === undefined || b === undefined) return;
  const pair = a + b;
  const min = Math.min(MIN_FRACTION, pair / 2);
  const na = Math.min(Math.max(a + delta, min), pair - min);
  split.sizes[index] = na;
  split.sizes[index + 1] = pair - na;
}

/* --------------------------------------------------------- persistence */

/**
 * Validate an untrusted (localStorage) tree and repair what can be repaired.
 * Returns null when it is unusable, so the caller falls back to a fresh board.
 */
export function sanitize(node: unknown): LayoutNode | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Partial<LayoutNode> & { state?: Partial<PaneState> & { fresh?: unknown } };
  if (n.type === 'pane') {
    if (typeof n.id !== 'string') return null;
    const s: Partial<PaneState> & { fresh?: unknown } = n.state ?? {};
    const input = typeof s.input === 'string' ? s.input : '';
    let mode = typeof s.mode === 'string' ? s.mode : 'json';
    // Pre-1.2 boards had a `fresh` flag instead of the Auto tool: an untouched
    // empty pane starts in Auto now.
    if (s.fresh === true && input === '') mode = 'auto';
    return {
      type: 'pane',
      id: n.id,
      state: defaultPaneState({
        mode,
        input,
        ...(typeof s.inputB === 'string' && s.inputB !== '' ? { inputB: s.inputB } : {}),
        seam: clamp01(typeof s.seam === 'number' ? s.seam : 0.5),
        pretty: s.pretty !== false,
        layout: s.layout === 'side' ? 'side' : 'stacked',
        options: s.options && typeof s.options === 'object' ? { ...s.options } : {},
        ...(typeof s.title === 'string' && s.title.trim() ? { title: s.title.slice(0, 80) } : {}),
        ...(typeof s.sourceId === 'string' ? { sourceId: s.sourceId } : {}),
        ...(s.wrap === true ? { wrap: true } : {}),
        ...(s.detected === true ? { detected: true } : {}),
        ...(s.viewAs === 'tree' || s.viewAs === 'table' ? { viewAs: s.viewAs } : {}),
      }),
    };
  }
  if (n.type === 'split') {
    const sn = n as Partial<SplitNode>;
    if (typeof sn.id !== 'string' || !Array.isArray(sn.children)) return null;
    const children = sn.children.map(sanitize).filter((c): c is LayoutNode => c !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    let sizes = Array.isArray(sn.sizes) ? sn.sizes.map((x) => (typeof x === 'number' && x > 0 ? x : 0)) : [];
    if (sizes.length !== children.length || sizes.some((x) => x === 0)) {
      sizes = children.map(() => 1 / children.length);
    }
    const total = sizes.reduce((a, b) => a + b, 0);
    return {
      type: 'split',
      id: sn.id,
      dir: sn.dir === 'col' ? 'col' : 'row',
      children,
      sizes: sizes.map((s) => s / total),
    };
  }
  return null;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));
}
