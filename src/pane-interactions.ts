/**
 * Pane interactions (design spec §4): drag-to-reorder panes, the "View as"
 * segmented control for JSON-valued results, inline copy confirmation and
 * the document-level Escape chain.
 *
 * Nothing here touches the DOM at module load, so the pure helpers
 * (`nearestEdge`, `tableFromJson`) can be unit-tested under `node --test`.
 * The PaneView wires these up from its `bindInteractions()` region.
 */

import type { Edge } from './layout.js';
import type { TableData } from './modes/csv.js';
import { h, copyInline, isMenuOpen, closeMenu } from './ui.js';
import { closePalette } from './palette.js';

export type { Edge };

/* ------------------------------------------------------------ drop edges */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How deep (as a fraction of the side) an edge's band reaches into the pane. */
export const EDGE_BAND = 0.25;

/**
 * Which edge of `rect` a pointer at (x, y) is closest to. Within the outer
 * 25 % band of a side that side wins by pixel distance (corners pick the
 * nearer one); in the centre region the distances are normalised by the
 * pane's size so a wide pane doesn't always answer "top"/"bottom".
 */
export function nearestEdge(rect: RectLike, x: number, y: number): Edge {
  const dl = x - rect.left;
  const dr = rect.left + rect.width - x;
  const dt = y - rect.top;
  const db = rect.top + rect.height - y;
  const all: [Edge, number, number][] = [
    ['left', dl, rect.width],
    ['right', dr, rect.width],
    ['top', dt, rect.height],
    ['bottom', db, rect.height],
  ];
  const inBand = all.filter(([, d, size]) => d <= size * EDGE_BAND);
  const pool = inBand.length ? inBand : all;
  const metric = inBand.length ? (d: number) => d : (d: number, size: number) => d / Math.max(size, 1);
  let best = pool[0]!;
  for (const c of pool) if (metric(c[1], c[2]) < metric(best[1], best[2])) best = c;
  return best[0];
}

export const EDGE_CLASSES = ['drop-edge-left', 'drop-edge-right', 'drop-edge-top', 'drop-edge-bottom'];

export interface DragReorderOptions {
  /** The pane element being dragged (has `data-pane-id`). */
  pane: HTMLElement;
  /** The ⋮⋮ handle in the title bar. */
  grip: HTMLElement;
  /** Called on a successful drop. */
  onDrop(targetId: string, edge: Edge): void;
}

const DRAG_THRESHOLD = 4;

/**
 * Pointer-drag a pane by its grip: a ghost outline follows the pointer and
 * the pane under it shows a 2 px accent bar on the edge the drop will use.
 * Escape (or pointercancel) abandons the drag.
 */
export function bindDragReorder({ pane, grip, onDrop }: DragReorderOptions): void {
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost: HTMLElement | null = null;
    let target: HTMLElement | null = null;
    let edge: Edge | null = null;
    grip.setPointerCapture(e.pointerId);

    const clearTarget = () => {
      target?.classList.remove(...EDGE_CLASSES);
      target = null;
      edge = null;
    };
    const finish = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', onKey, true);
      clearTarget();
      ghost?.remove();
      ghost = null;
      pane.classList.remove('is-dragged');
      document.body.classList.remove('pane-dragging');
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish();
    };
    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        const r = pane.getBoundingClientRect();
        ghost = h('div.drag-ghost', { 'aria-hidden': 'true' });
        ghost.style.width = `${Math.max(120, Math.round(r.width * 0.3))}px`;
        ghost.style.height = `${Math.max(80, Math.round(r.height * 0.3))}px`;
        document.body.append(ghost);
        pane.classList.add('is-dragged');
        document.body.classList.add('pane-dragging');
        document.addEventListener('keydown', onKey, true);
      }
      ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.pane') ?? null;
      const next = over && over !== pane && over.dataset['paneId'] ? over : null;
      if (next !== target) {
        clearTarget();
        target = next;
      }
      if (!target) return;
      const e2 = nearestEdge(target.getBoundingClientRect(), ev.clientX, ev.clientY);
      if (e2 !== edge) {
        target.classList.remove(...EDGE_CLASSES);
        target.classList.add(`drop-edge-${e2}`);
        edge = e2;
      }
    };
    const up = () => {
      const id = target?.dataset['paneId'];
      const chosen = edge;
      finish();
      if (id && chosen) onDrop(id, chosen);
    };
    const cancel = () => finish();
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
  });
}

/* --------------------------------------------------------------- view as */

export type ViewAs = 'text' | 'tree' | 'table';

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

const cell = (v: unknown): string => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Tabular form of a parsed JSON value, or null when it has none:
 * an array of objects → one column per key; an object → key / value rows.
 */
export function tableFromJson(value: unknown): TableData | null {
  if (Array.isArray(value)) {
    if (!value.length || !value.every(isPlainObject)) return null;
    const header: string[] = [];
    const seen = new Set<string>();
    for (const row of value) for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); header.push(k); }
    return { header, rows: value.map((row) => header.map((k) => cell(row[k]))), total: value.length };
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    return { header: ['key', 'value'], rows: entries.map(([k, v]) => [k, cell(v)]), total: entries.length };
  }
  return null;
}

/** Try to parse; undefined when the text is not JSON. */
export function parseJsonOutput(text: string): { value: unknown } | undefined {
  if (!text.trim()) return undefined;
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

const VIEW_AS: [ViewAs, string, string][] = [
  ['text', 'Text', 'Show the result as text'],
  ['tree', 'Tree', 'Show the result as a collapsible tree'],
  ['table', 'Table', 'Show the result as a table'],
];

/** The Text | Tree | Table segmented control. `onPick` receives the choice. */
export function buildViewAs(onPick: (v: ViewAs) => void): HTMLElement {
  const seg = h('div.segmented.view-as', { role: 'group', 'aria-label': 'View as' });
  for (const [val, label, tip] of VIEW_AS) {
    const b = h<HTMLButtonElement>('button', { type: 'button', title: tip, 'data-view': val }, label);
    b.addEventListener('click', () => {
      if (!b.disabled) onPick(val);
    });
    seg.append(b);
  }
  return seg;
}

/** Reflect the current choice and which segments are available. */
export function paintViewAs(seg: HTMLElement, current: ViewAs, tableOk: boolean): void {
  for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
    const v = b.dataset['view'] as ViewAs;
    b.setAttribute('aria-pressed', String(v === current));
    if (v === 'table') {
      b.disabled = !tableOk;
      b.title = tableOk ? 'Show the result as a table' : 'Table needs an array of objects';
    }
  }
}

/* ------------------------------------------------------------ inline copy */

/**
 * Take over a toolbar button's click so the confirmation is inline instead
 * of a toast: capture-phase listener, stops the original handler.
 */
export function interceptCopy(button: HTMLElement, getText: () => string, onEmpty: () => void): void {
  button.addEventListener(
    'click',
    (e) => {
      e.stopImmediatePropagation();
      const text = getText();
      if (!text) return onEmpty();
      void copyInline(button, text);
    },
    { capture: true },
  );
}

/* --------------------------------------------------------------- escape */

export interface EscapeHost {
  /** Close find, then explain / info — in that order; true when something closed. */
  escapeInPane(): boolean;
  focusEditor(): void;
}

/** Elements that already handle their own Escape key. */
const SELF_HANDLED = '.find-box, .explain, .menu, .palette, #help';

/**
 * Document-level Escape chain: find → explain / info → menu / palette →
 * focus returns to the editor. Skipped when the key lands in a control that
 * handles Escape itself (find input, explain panel, menus, palette, help).
 */
export function installKeyboard(host: () => EscapeHost | null): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(SELF_HANDLED)) return;
    const help = document.getElementById('help');
    if (help && !help.hidden) return; // main.ts closes it
    const pane = host();
    if (pane?.escapeInPane()) return e.preventDefault();
    if (isMenuOpen()) {
      closeMenu();
      return e.preventDefault();
    }
    if (closePalette()) return e.preventDefault();
    pane?.focusEditor();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
