/**
 * Graph model + tidy-tree layout for the JSON Graph mode. Pure and DOM-free
 * so the layout is unit-testable and can move to the worker.
 *
 * Model: every object/array becomes a *card*. A card lists its primitive
 * children as rows ("key: value"); each container child becomes a child card
 * joined by an edge labelled with the key. A primitive root is one card.
 *
 * Layout: top-down tidy tree — each parent is centred over the span of its
 * descendants, siblings never overlap, levels are as tall as their tallest
 * card. (Simpler than Reingold–Tilford contour packing but produces the
 * "parents centred over descendants" shape the spec asks for.)
 */

export type Segs = (string | number)[];

export interface GraphRow {
  key: string;
  value: string;
  cls: 'str' | 'num' | 'bool' | 'null' | 'more';
}

export interface GraphNode {
  id: number;
  segs: Segs;
  kind: 'object' | 'array' | 'primitive';
  /** Card title: the key under its parent (or "$" for the root) + size. */
  title: string;
  rows: GraphRow[];
  parent: number | null;
  edgeLabel: string;
  children: number[];
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface GraphOptions {
  /** Stop creating cards after this many (huge documents). */
  maxNodes?: number;
  /** Max primitive rows shown per card before "… n more". */
  maxRows?: number;
  charWidth?: number;
  rowHeight?: number;
  titleHeight?: number;
  padding?: number;
  minWidth?: number;
  maxWidth?: number;
  gapX?: number;
  gapY?: number;
}

const DEFAULTS: Required<GraphOptions> = {
  maxNodes: 1500,
  maxRows: 30,
  charWidth: 7.2,
  rowHeight: 18,
  titleHeight: 24,
  padding: 10,
  minWidth: 90,
  maxWidth: 340,
  gapX: 28,
  gapY: 56,
};

const isContainer = (v: unknown): v is object => v !== null && typeof v === 'object';

function rowLiteral(v: unknown): { value: string; cls: GraphRow['cls'] } {
  if (v === null) return { value: 'null', cls: 'null' };
  if (typeof v === 'string') {
    const s = JSON.stringify(v);
    return { value: s.length > 42 ? s.slice(0, 39) + '…"' : s, cls: 'str' };
  }
  if (typeof v === 'number') return { value: String(v), cls: 'num' };
  if (typeof v === 'boolean') return { value: String(v), cls: 'bool' };
  return { value: String(v), cls: 'null' };
}

function sizeLabel(v: object): string {
  const n = Array.isArray(v) ? v.length : Object.keys(v).length;
  return Array.isArray(v) ? `[${n}]` : `{${n}}`;
}

export interface Graph {
  nodes: GraphNode[];
  truncated: boolean;
  width: number;
  height: number;
}

export function buildGraph(value: unknown, options: GraphOptions = {}): Graph {
  const o = { ...DEFAULTS, ...options };
  const nodes: GraphNode[] = [];
  let truncated = false;

  const measure = (node: GraphNode): void => {
    const longest = Math.max(node.title.length, ...node.rows.map((r) => r.key.length + 2 + r.value.length));
    node.width = Math.min(o.maxWidth, Math.max(o.minWidth, Math.ceil(longest * o.charWidth) + o.padding * 2));
    node.height = o.titleHeight + node.rows.length * o.rowHeight + (node.rows.length ? o.padding : 0);
  };

  // Breadth-first so truncation keeps the shallow, most useful part.
  const queue: { value: unknown; segs: Segs; parent: number | null; label: string }[] = [{ value, segs: [], parent: null, label: '' }];
  while (queue.length) {
    const item = queue.shift()!;
    if (nodes.length >= o.maxNodes) {
      truncated = true;
      break;
    }
    const id = nodes.length;
    const v = item.value;
    const node: GraphNode = {
      id,
      segs: item.segs,
      kind: Array.isArray(v) ? 'array' : isContainer(v) ? 'object' : 'primitive',
      title: '',
      rows: [],
      parent: item.parent,
      edgeLabel: item.label,
      children: [],
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    };
    const name = item.segs.length ? String(item.segs[item.segs.length - 1]) : '$';
    if (isContainer(v)) {
      node.title = `${name} ${sizeLabel(v)}`;
      const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
      let hiddenRows = 0;
      for (const [k, child] of entries) {
        if (isContainer(child)) {
          queue.push({ value: child, segs: [...item.segs, k], parent: id, label: String(k) });
        } else if (node.rows.length < o.maxRows) {
          const lit = rowLiteral(child);
          node.rows.push({ key: String(k), value: lit.value, cls: lit.cls });
        } else hiddenRows++;
      }
      if (hiddenRows) node.rows.push({ key: '…', value: `${hiddenRows} more`, cls: 'more' });
    } else {
      const lit = rowLiteral(v);
      node.title = name;
      node.rows.push({ key: '', value: lit.value, cls: lit.cls });
    }
    measure(node);
    nodes.push(node);
    if (item.parent !== null) nodes[item.parent]!.children.push(id);
  }

  const size = layoutTidy(nodes, o);
  return { nodes, truncated, ...size };
}

/** Assign x/y to every node. Returns the overall bounding size. */
export function layoutTidy(nodes: GraphNode[], options: GraphOptions = {}): { width: number; height: number } {
  const o = { ...DEFAULTS, ...options };
  if (!nodes.length) return { width: 0, height: 0 };

  // Depth + per-level height.
  const depth = new Array<number>(nodes.length).fill(0);
  const levelHeight: number[] = [];
  for (const n of nodes) {
    depth[n.id] = n.parent === null ? 0 : depth[n.parent]! + 1;
    const d = depth[n.id]!;
    levelHeight[d] = Math.max(levelHeight[d] ?? 0, n.height);
  }
  const levelY: number[] = [];
  let y = 0;
  levelHeight.forEach((hgt, d) => {
    levelY[d] = y;
    y += hgt + o.gapY;
  });

  // Subtree widths, bottom-up (nodes are in BFS order, so reverse is post-order enough).
  const subtree = new Array<number>(nodes.length).fill(0);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    const kids = n.children.reduce((sum, c) => sum + subtree[c]!, 0) + Math.max(0, n.children.length - 1) * o.gapX;
    subtree[i] = Math.max(n.width, kids);
  }

  // Positions, top-down: children packed left→right inside the parent's span.
  const place = (id: number, x0: number): void => {
    const n = nodes[id]!;
    n.y = levelY[depth[id]!]!;
    const span = subtree[id]!;
    n.x = x0 + (span - n.width) / 2;
    const kidsWidth = n.children.reduce((sum, c) => sum + subtree[c]!, 0) + Math.max(0, n.children.length - 1) * o.gapX;
    let cx = x0 + (span - kidsWidth) / 2;
    for (const c of n.children) {
      place(c, cx);
      cx += subtree[c]! + o.gapX;
    }
  };
  place(0, 0);

  let width = 0;
  for (const n of nodes) width = Math.max(width, n.x + n.width);
  return { width, height: Math.max(0, y - o.gapY) };
}
