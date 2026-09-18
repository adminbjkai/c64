/**
 * SVG renderer for the JSON Graph: cards, labelled edges, zoom / pan / fit,
 * click-to-select. Zoom keeps the point under the cursor fixed; Fit (or the
 * `0` key) scales the whole graph into the viewport.
 */

import { h } from '../ui.js';
import { pathKey } from '../modes/json-parse.js';
import { formatPath } from '../lib/jsonpath.js';
import type { GraphData } from '../modes/json-graph.js';
import type { GraphNode } from '../lib/graph-layout.js';
import type { ViewRenderer } from './types.js';

const NS = 'http://www.w3.org/2000/svg';
const ROW_H = 18;
const TITLE_H = 24;
const PAD = 10;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export const renderJsonGraph: ViewRenderer = (host, raw, ctx) => {
  const { graph, spans } = raw as GraphData;
  const nodes = graph.nodes;

  /* ---------------------------------------------------------- toolbar */
  const pathText = h('code.path-text', {}, '$');
  const zoomIn = h('button.btn.small', { type: 'button', title: 'Zoom in (+)' }, '+');
  const zoomOut = h('button.btn.small', { type: 'button', title: 'Zoom out (−)' }, '−');
  const fitBtn = h('button.btn.small', { type: 'button', title: 'Fit to view (0)' }, 'Fit');
  const copyPath = h('button.btn.small', { type: 'button' }, 'Copy path');
  copyPath.addEventListener('click', () => ctx.copy(pathText.textContent ?? '', 'path'));
  const toolbar = h('div.view-toolbar', {}, zoomOut, zoomIn, fitBtn, h('span.spacer'), h('span.label', {}, 'Selected'), pathText, copyPath);

  /* -------------------------------------------------------------- svg */
  const root = svg('svg', { class: 'graph', tabindex: 0, role: 'img', 'aria-label': 'JSON graph' });
  const world = svg('g');
  root.append(world);

  // Edges first so cards draw on top.
  for (const n of nodes) {
    if (n.parent === null) continue;
    const p = nodes[n.parent]!;
    const x1 = p.x + p.width / 2;
    const y1 = p.y + p.height;
    const x2 = n.x + n.width / 2;
    const y2 = n.y;
    const my = (y1 + y2) / 2;
    world.append(svg('path', { class: 'edge', d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}` }));
    const label = svg('text', { class: 'edge-label', x: x2, y: y2 - 6, 'text-anchor': 'middle' });
    label.textContent = n.edgeLabel;
    world.append(label);
  }

  let selected: SVGGElement | null = null;
  const cardEls = new Map<number, SVGGElement>();
  const select = (n: GraphNode, g: SVGGElement): void => {
    selected?.classList.remove('is-selected');
    selected = g;
    g.classList.add('is-selected');
    pathText.textContent = formatPath(n.segs);
    const span = spans.get(pathKey(n.segs));
    if (span) ctx.selectInEditor(span[0], span[1]);
  };

  for (const n of nodes) {
    const g = svg('g', { class: `card kind-${n.kind}`, transform: `translate(${n.x},${n.y})`, tabindex: -1 });
    g.append(svg('rect', { class: 'card-bg', width: n.width, height: n.height, rx: 6 }));
    g.append(svg('rect', { class: 'card-title-bg', width: n.width, height: TITLE_H, rx: 6 }));
    const title = svg('text', { class: 'card-title', x: PAD, y: 16 });
    title.textContent = n.title;
    g.append(title);
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
      select(n, g);
    });
    world.append(g);
    cardEls.set(n.id, g);
  }

  /* -------------------------------------------------------- zoom / pan */
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let userAdjusted = false; // once the user zooms/pans, resizes no longer auto-fit
  const apply = (): void => world.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  const viewport = (): { w: number; hgt: number } => ({ w: root.clientWidth || 600, hgt: root.clientHeight || 400 });

  const fit = (): void => {
    const { w, hgt } = viewport();
    const margin = 24;
    scale = Math.min(2, Math.max(0.05, Math.min((w - margin * 2) / Math.max(1, graph.width), (hgt - margin * 2) / Math.max(1, graph.height))));
    tx = (w - graph.width * scale) / 2;
    ty = margin;
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
  zoomIn.addEventListener('click', () => zoomAt(1.25, ...center()));
  zoomOut.addEventListener('click', () => zoomAt(0.8, ...center()));
  fitBtn.addEventListener('click', fit);

  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX - tx;
    const sy = e.clientY - ty;
    let moved = false;
    root.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      tx = ev.clientX - sx;
      ty = ev.clientY - sy;
      moved = true;
      userAdjusted = true;
      root.classList.add('is-panning');
      apply();
    };
    const up = (): void => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.classList.remove('is-panning');
      if (!moved) root.focus();
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoomAt(1.25, ...center());
    else if (e.key === '-' || e.key === '_') zoomAt(0.8, ...center());
    else if (e.key === '0') fit();
    else if (e.key === 'ArrowLeft') (userAdjusted = true), (tx += 40);
    else if (e.key === 'ArrowRight') tx -= 40;
    else if (e.key === 'ArrowUp') ty += 40;
    else if (e.key === 'ArrowDown') ty -= 40;
    else return;
    e.preventDefault();
    apply();
  });

  host.append(toolbar, root);
  // Fit once the SVG has a size (after layout).
  requestAnimationFrame(fit);
  const ro = new ResizeObserver(() => {
    if (!userAdjusted) fit();
  });
  ro.observe(root);
  return () => ro.disconnect();
};
