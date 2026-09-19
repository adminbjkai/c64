/**
 * SVG renderer for the JSON Graph — canvas-first, jsoncrack-style: the SVG
 * fills the pane, a floating pill at the bottom holds zoom / fit / search /
 * collapse controls, clicking a card opens a details drawer (path, raw
 * value, copy / select actions), and container cards can be collapsed.
 *
 * The helpers at the top (`matchNodes`, `visibleIds`, …) are pure and
 * DOM-free so they can be unit-tested in node; nothing here touches
 * `document` at module load.
 */

import { h } from '../ui.js';
import { icon } from '../icons.js';
import { pathKey } from '../modes/json-parse.js';
import { formatPath } from '../lib/jsonpath.js';
import type { GraphData } from '../modes/json-graph.js';
import type { Graph, GraphNode } from '../lib/graph-layout.js';
import type { ViewRenderer } from './types.js';
import { viewShell, copyInline } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const ROW_H = 18;
const TITLE_H = 24;
const PAD = 10;
const RADIUS = 8;
/** Above this many cards, containers below depth 2 start collapsed. */
const COLLAPSE_ABOVE = 1500;
const RAW_LIMIT = 20_000;

/* ------------------------------------------------------------ pure helpers */

/** Depth of every node (index = id). */
export function nodeDepths(graph: Graph): number[] {
  const depth = new Array<number>(graph.nodes.length).fill(0);
  for (const n of graph.nodes) depth[n.id] = n.parent === null ? 0 : depth[n.parent]! + 1;
  return depth;
}

/** Ids (in BFS order) whose title, row keys or row values contain `query` (case-insensitive). */
export function matchNodes(graph: Graph, query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  for (const n of graph.nodes) {
    if (n.title.toLowerCase().includes(q) || n.rows.some((r) => r.key.toLowerCase().includes(q) || r.value.toLowerCase().includes(q))) out.push(n.id);
  }
  return out;
}

/** Ids of cards that are shown given the set of collapsed container ids (descendants of a collapsed card are hidden). */
export function visibleIds(graph: Graph, collapsed: ReadonlySet<number>): Set<number> {
  const visible = new Set<number>();
  for (const n of graph.nodes) {
    // BFS order guarantees the parent was decided first.
    if (n.parent === null || (visible.has(n.parent) && !collapsed.has(n.parent))) visible.add(n.id);
  }
  return visible;
}

/** Number of descendant cards under `id`. */
export function descendantCount(graph: Graph, id: number): number {
  let count = 0;
  const stack = [...graph.nodes[id]!.children];
  while (stack.length) {
    const c = stack.pop()!;
    count++;
    stack.push(...graph.nodes[c]!.children);
  }
  return count;
}

/** Ids of cards with children at depth >= `minDepth` — the set to collapse for "Collapse all" (1) or the large-graph cap (2). */
export function collapseFromDepth(graph: Graph, minDepth: number): Set<number> {
  const depth = nodeDepths(graph);
  const out = new Set<number>();
  for (const n of graph.nodes) if (n.children.length && depth[n.id]! >= minDepth) out.add(n.id);
  return out;
}

/** Ancestor ids of `id`, nearest first. */
export function ancestorsOf(graph: Graph, id: number): number[] {
  const out: number[] = [];
  let p = graph.nodes[id]!.parent;
  while (p !== null) {
    out.push(p);
    p = graph.nodes[p]!.parent;
  }
  return out;
}

/** Human summary for the drawer: "object, 3 keys", "array, 12 items", "string". */
export function describeNode(n: GraphNode): string {
  if (n.kind === 'primitive') {
    const cls = n.rows[0]?.cls ?? 'null';
    return cls === 'str' ? 'string' : cls === 'num' ? 'number' : cls === 'bool' ? 'boolean' : 'null';
  }
  const size = /[[{](\d+)[\]}]\s*$/.exec(n.title)?.[1] ?? '?';
  return n.kind === 'array' ? `array, ${size} item${size === '1' ? '' : 's'}` : `object, ${size} key${size === '1' ? '' : 's'}`;
}

/** Pretty-print a raw JSON slice if it parses; otherwise return it as-is. */
export function prettyRaw(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/* --------------------------------------------------------------- renderer */

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Rounded-top rectangle path for the title band. */
function titlePath(w: number, r: number): string {
  return `M0,${r} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${TITLE_H - r} h${-w} z`;
}

let markerSeq = 0;

export const renderJsonGraph: ViewRenderer = (host, raw, ctx) => {
  const { graph, spans } = raw as GraphData;
  const nodes = graph.nodes;
  const markerId = `jg-arrow-${++markerSeq}`;

  const wrap = h('div.jg');
  const root = svg('svg', { class: 'graph jg-canvas', tabindex: 0, role: 'img', 'aria-label': 'JSON graph' });
  const defs = svg('defs');
  const marker = svg('marker', { id: markerId, class: 'jg-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  marker.append(svg('path', { d: 'M0,0 L10,5 L0,10 z' }));
  defs.append(marker);
  const world = svg('g');
  root.append(defs, world);

  /* ------------------------------------------------------------- state */
  const collapsed = new Set<number>();
  const cardEls = new Map<number, SVGGElement>();
  const edgeEls = new Map<number, SVGElement[]>(); // keyed by child id
  const toggleEls = new Map<number, SVGTextElement>();
  const badgeEls = new Map<number, SVGTextElement>();
  let selectedId: number | null = null;
  let matches: number[] = [];
  let matchIdx = -1;
  let query = '';

  /* ------------------------------------------------------------- edges */
  for (const n of nodes) {
    if (n.parent === null) continue;
    const p = nodes[n.parent]!;
    const x1 = p.x + p.width / 2;
    const y1 = p.y + p.height;
    const x2 = n.x + n.width / 2;
    const y2 = n.y;
    const my = (y1 + y2) / 2;
    const path = svg('path', { class: 'edge', d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 1}`, 'marker-end': `url(#${markerId})` });
    const label = svg('text', { class: 'edge-label', x: x2, y: y2 - 11, 'text-anchor': 'middle' });
    label.textContent = n.edgeLabel;
    world.append(path, label);
    edgeEls.set(n.id, [path, label]);
  }

  /* ------------------------------------------------------------- cards */
  for (const n of nodes) {
    const g = svg('g', { class: `card kind-${n.kind}`, transform: `translate(${n.x},${n.y})`, tabindex: -1 });
    g.append(svg('rect', { class: 'card-bg', width: n.width, height: n.height, rx: RADIUS }));
    g.append(svg('path', { class: 'card-title-bg', d: titlePath(n.width, RADIUS) }));
    g.append(svg('rect', { class: 'card-accent', x: 0, y: 0, width: 3, height: n.height, rx: 1.5 }));
    const title = svg('text', { class: 'card-title', x: PAD, y: 17 });
    title.textContent = n.title;
    g.append(title);
    if (n.children.length) {
      const t = svg('text', { class: 'card-toggle', x: n.width - PAD, y: 17, 'text-anchor': 'end' });
      t.textContent = '⊟';
      const tt = svg('title');
      tt.textContent = 'Collapse / expand this branch';
      t.append(tt);
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsed.has(n.id)) collapsed.delete(n.id);
        else collapsed.add(n.id);
        updateVisibility();
      });
      g.append(t);
      toggleEls.set(n.id, t);
      const badge = svg('text', { class: 'card-hidden', x: n.width / 2, y: n.height + 15, 'text-anchor': 'middle', hidden: '' });
      badge.textContent = `… ${descendantCount(graph, n.id)} hidden`;
      g.append(badge);
      badgeEls.set(n.id, badge);
    }
    n.rows.forEach((r, i) => {
      const y = TITLE_H + PAD / 2 + (i + 1) * ROW_H - 5;
      if (r.key) {
        const k = svg('text', { class: 'row-key', x: PAD, y });
        k.textContent = r.key + ':';
        g.append(k);
      }
      const v = svg('text', { class: `row-val ${r.cls}`, x: PAD + (r.key ? (r.key.length + 1.5) * 7.2 : 0), y });
      v.textContent = r.value;
      g.append(v);
    });
    const t = svg('title');
    t.textContent = formatPath(n.segs);
    g.append(t);
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (suppressClick) return;
      select(n.id);
    });
    world.append(g);
    cardEls.set(n.id, g);
  }

  const setHidden = (el: Element, hidden: boolean): void => {
    if (hidden) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  };

  const updateVisibility = (): void => {
    const visible = visibleIds(graph, collapsed);
    for (const n of nodes) {
      const shown = visible.has(n.id);
      setHidden(cardEls.get(n.id)!, !shown);
      for (const e of edgeEls.get(n.id) ?? []) setHidden(e, !shown);
      const toggle = toggleEls.get(n.id);
      if (toggle) {
        const isCollapsed = collapsed.has(n.id);
        toggle.textContent = isCollapsed ? '⊞' : '⊟';
        setHidden(badgeEls.get(n.id)!, !isCollapsed);
      }
    }
  };

  /* -------------------------------------------------------- zoom / pan */
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let userAdjusted = false; // once the user zooms/pans, resizes no longer auto-fit
  let suppressClick = false;
  const zoomReadout = h('span.jg-zoom', { title: 'Zoom' }, '100%');
  const apply = (): void => {
    world.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
    zoomReadout.textContent = `${Math.round(scale * 100)}%`;
  };
  const viewport = (): { w: number; hgt: number } => ({ w: root.clientWidth || 600, hgt: root.clientHeight || 400 });

  /** Bounding box of the cards currently shown (collapsed branches leave gaps we need not fit). */
  const visibleBounds = (): { x: number; y: number; w: number; h: number } => {
    const vis = visibleIds(graph, collapsed);
    let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
    for (const n of nodes) {
      if (!vis.has(n.id)) continue;
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height + (collapsed.has(n.id) ? 20 : 0));
    }
    return x0 === Infinity ? { x: 0, y: 0, w: 1, h: 1 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const fit = (): void => {
    const { w, hgt } = viewport();
    const margin = 24;
    const b = visibleBounds();
    scale = Math.min(2, Math.max(0.05, Math.min((w - margin * 2) / Math.max(1, b.w), (hgt - margin * 2) / Math.max(1, b.h))));
    tx = (w - b.w * scale) / 2 - b.x * scale;
    ty = margin - b.y * scale;
    apply();
  };
  const zoomAt = (factor: number, cx: number, cy: number): void => {
    userAdjusted = true;
    const next = Math.min(4, Math.max(0.05, scale * factor));
    // keep (cx, cy) fixed on screen
    tx = cx - ((cx - tx) * next) / scale;
    ty = cy - ((cy - ty) * next) / scale;
    scale = next;
    apply();
  };
  const center = (): [number, number] => {
    const { w, hgt } = viewport();
    return [w / 2, hgt / 2];
  };
  /** Pan so the card sits in the middle of the viewport at the current scale. */
  const centerOn = (n: GraphNode): void => {
    const { w, hgt } = viewport();
    tx = w / 2 - (n.x + n.width / 2) * scale;
    ty = hgt / 2 - (n.y + n.height / 2) * scale;
    userAdjusted = true;
    apply();
  };

  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Drag to pan; two pointers pinch to zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      root.setPointerCapture(e.pointerId);
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      return;
    }
    const sx = e.clientX - tx;
    const sy = e.clientY - ty;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const r = root.getBoundingClientRect();
        if (pinchDist > 0) zoomAt(d / pinchDist, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
        pinchDist = d;
        moved = true;
        return;
      }
      if (ev.pointerId !== e.pointerId) return;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      // Capture only once a drag is real, so plain clicks still reach the cards.
      if (!moved) root.setPointerCapture(ev.pointerId);
      tx = ev.clientX - sx;
      ty = ev.clientY - sy;
      moved = true;
      userAdjusted = true;
      root.classList.add('is-panning');
      apply();
    };
    const up = (ev: PointerEvent): void => {
      pointers.delete(ev.pointerId);
      if (pointers.size) return;
      pinchDist = 0;
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      root.classList.remove('is-panning');
      if (moved) {
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
      } else root.focus();
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });
  root.addEventListener('click', () => {
    if (!suppressClick) closeDrawer();
  });

  /* ------------------------------------------------------------ drawer */
  const drawerPath = h('code.jg-path');
  const drawerMeta = h('div.jg-drawer-meta');
  const drawerRaw = h('pre.jg-raw');
  const drawerClose = h('button.btn.icon.jg-drawer-close', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close details' }, icon('close', 14));
  const copyValue = h('button.btn.small', { type: 'button' }, icon('copy', 12), 'Copy value');
  const copyPath = h('button.btn.small', { type: 'button' }, icon('copy', 12), 'Copy path');
  const selectBtn = h<HTMLButtonElement>('button.btn.small', { type: 'button' }, icon('external', 12), 'Select in editor');
  const drawer = h('aside.jg-drawer', { hidden: true, 'aria-label': 'Card details' },
    h('div.jg-drawer-head', {}, drawerPath, drawerClose),
    drawerMeta,
    drawerRaw,
    h('div.jg-drawer-actions', {}, copyValue, copyPath, selectBtn),
  );
  let rawValue = '';
  const spanOf = (n: GraphNode): [number, number] | undefined => spans.get(pathKey(n.segs));

  const select = (id: number): void => {
    const n = nodes[id]!;
    if (selectedId !== null) cardEls.get(selectedId)?.classList.remove('is-selected');
    selectedId = id;
    cardEls.get(id)!.classList.add('is-selected');
    drawerPath.textContent = formatPath(n.segs);
    drawerMeta.textContent = describeNode(n);
    const span = spanOf(n);
    rawValue = span ? ctx.input.slice(span[0], span[1]) : '';
    const pretty = prettyRaw(rawValue);
    drawerRaw.textContent = pretty.length > RAW_LIMIT ? pretty.slice(0, RAW_LIMIT) + `\n… (${pretty.length - RAW_LIMIT} more characters — use Copy value)` : pretty;
    selectBtn.disabled = !span;
    drawer.hidden = false;
  };
  const closeDrawer = (): void => {
    drawer.hidden = true;
    if (selectedId !== null) cardEls.get(selectedId)?.classList.remove('is-selected');
    selectedId = null;
  };
  drawerClose.addEventListener('click', closeDrawer);
  copyValue.addEventListener('click', () => copyInline(copyValue, rawValue));
  copyPath.addEventListener('click', () => copyInline(copyPath, drawerPath.textContent ?? ''));
  selectBtn.addEventListener('click', () => {
    if (selectedId === null) return;
    const span = spanOf(nodes[selectedId]!);
    if (span) ctx.selectInEditor(span[0], span[1]);
  });

  /* ------------------------------------------------------------ search */
  const searchInput = h<HTMLInputElement>('input.jg-search', { type: 'search', placeholder: 'Find key or value…', 'aria-label': 'Search nodes', spellcheck: 'false' });
  const searchCount = h('span.jg-count');
  const searchWrap = h('span.jg-search-wrap', { hidden: true }, searchInput, searchCount);
  const searchBtn = h('button.jg-btn', { type: 'button', title: 'Search (/)', 'aria-label': 'Search' }, icon('search', 14));

  const applySearch = (): void => {
    const active = query.trim() !== '';
    const set = new Set(matches);
    for (const n of nodes) {
      const g = cardEls.get(n.id)!;
      g.classList.toggle('jg-dim', active && !set.has(n.id));
      g.classList.toggle('is-match', matchIdx >= 0 && matches[matchIdx] === n.id);
    }
    searchCount.textContent = active ? (matches.length ? `${matchIdx + 1} / ${matches.length}` : '0 / 0') : '';
    searchCount.classList.toggle('is-empty', active && !matches.length);
  };
  const goTo = (idx: number): void => {
    if (!matches.length) return;
    matchIdx = ((idx % matches.length) + matches.length) % matches.length;
    const id = matches[matchIdx]!;
    // Reveal the match if it is inside a collapsed branch.
    let changed = false;
    for (const a of ancestorsOf(graph, id)) if (collapsed.delete(a)) changed = true;
    if (changed) updateVisibility();
    applySearch();
    centerOn(nodes[id]!);
  };
  const setQuery = (q: string): void => {
    query = q;
    matches = matchNodes(graph, q);
    matchIdx = matches.length ? 0 : -1;
    applySearch();
    if (matchIdx >= 0) goTo(0);
  };
  const openSearch = (): void => {
    searchWrap.hidden = false;
    searchBtn.classList.add('is-on');
    searchInput.focus();
    searchInput.select();
  };
  const closeSearch = (): void => {
    searchInput.value = '';
    setQuery('');
    searchWrap.hidden = true;
    searchBtn.classList.remove('is-on');
  };
  searchBtn.addEventListener('click', () => (searchWrap.hidden ? openSearch() : closeSearch()));
  searchInput.addEventListener('input', () => setQuery(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') goTo(matchIdx + (e.shiftKey ? -1 : 1));
    else if (e.key === 'ArrowUp') goTo(matchIdx - 1);
    else if (e.key === 'Escape') {
      closeSearch();
      root.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  /* ------------------------------------------------------------- pill */
  const zoomOut = h('button.jg-btn', { type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out' }, '−');
  const zoomIn = h('button.jg-btn', { type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in' }, '+');
  const fitBtn = h('button.jg-btn', { type: 'button', title: 'Fit to view (0)', 'aria-label': 'Fit to view' }, icon('maximize', 14));
  const collapseAll = h('button.jg-btn.jg-text', { type: 'button', title: 'Collapse every branch below the root' }, 'Collapse all');
  const expandAll = h('button.jg-btn.jg-text', { type: 'button', title: 'Expand every branch' }, 'Expand all');
  zoomIn.addEventListener('click', () => zoomAt(1.25, ...center()));
  zoomOut.addEventListener('click', () => zoomAt(0.8, ...center()));
  fitBtn.addEventListener('click', () => {
    userAdjusted = false;
    fit();
  });
  collapseAll.addEventListener('click', () => {
    collapsed.clear();
    for (const id of collapseFromDepth(graph, 1)) collapsed.add(id);
    updateVisibility();
    if (!userAdjusted) fit();
  });
  expandAll.addEventListener('click', () => {
    collapsed.clear();
    updateVisibility();
    if (!userAdjusted) fit();
  });
  const pill = h('div.jg-pill', { role: 'toolbar', 'aria-label': 'Graph controls' },
    zoomOut, zoomReadout, zoomIn, fitBtn,
    h('span.jg-sep'),
    searchBtn, searchWrap,
    h('span.jg-sep'),
    collapseAll, expandAll,
  );
  // Keep pill clicks from bubbling to the canvas (which would close the drawer).
  pill.addEventListener('click', (e) => e.stopPropagation());
  drawer.addEventListener('click', (e) => e.stopPropagation());

  /* --------------------------------------------------------- keyboard */
  root.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(1.25, ...center());
    else if (e.key === '-' || e.key === '_') zoomAt(0.8, ...center());
    else if (e.key === '0') {
      userAdjusted = false;
      fit();
    } else if (e.key === '/') openSearch();
    else if (e.key === 'Escape') {
      if (query) closeSearch();
      else if (!drawer.hidden) closeDrawer();
      else return;
    } else if (e.key === 'ArrowLeft') (userAdjusted = true), (tx += 40);
    else if (e.key === 'ArrowRight') tx -= 40;
    else if (e.key === 'ArrowUp') ty += 40;
    else if (e.key === 'ArrowDown') ty -= 40;
    else return;
    e.preventDefault();
    apply();
  });

  /* ------------------------------------------------------------ mount */
  wrap.append(root, pill, drawer);
  if (nodes.length > COLLAPSE_ABOVE) {
    for (const id of collapseFromDepth(graph, 2)) collapsed.add(id);
    wrap.append(h('div.jg-notice', {}, `Large graph (${nodes.length.toLocaleString('en-US')} cards). Branches below depth 2 start collapsed; use ⊞ on a card or Expand all.`));
  }
  updateVisibility();
  const { body } = viewShell(host, { flush: true, column: true });
  body.classList.add('is-clip');
  body.append(wrap);
  // Fit once the SVG has a size (after layout).
  requestAnimationFrame(fit);
  const ro = new ResizeObserver(() => {
    if (!userAdjusted) fit();
  });
  ro.observe(root);
  return () => ro.disconnect();
};
