/**
 * Board — projects the layout tree (src/layout.ts) onto the DOM and handles
 * the interactions that change it: Add Right / Add Below, Close (with undo),
 * Duplicate, Swap, Maximise, pipes between panes, and dragging the seams.
 *
 * Rendering strategy: the split structure is rebuilt from scratch on every
 * structural change (cheap — a handful of divs), while PaneView elements are
 * cached by id and re-parented, so editors keep their text, scroll and focus.
 * Seam drags only touch `flex-grow` styles; no re-render.
 */

import {
  addSibling,
  removePane,
  resizeSeam,
  paneCount,
  allPanes,
  findPane,
  findParent,
  createPane,
  clonePane,
  swapPanes,
  movePane,
  sanitize,
  type Edge,
  type LayoutNode,
  type SplitNode,
  type PaneNode,
  type PaneState,
} from './layout.js';
import { PaneView, type BoardActions } from './pane.js';
import { h, toast } from './ui.js';
import { installKeyboard } from './pane-interactions.js';

/** Board widths from this up put input and output side by side by default. */
const SIDE_MIN_WIDTH = 900;

/**
 * A new pane sized for the board: side-by-side (seam 0.5) on wide boards,
 * stacked with a shorter editor (seam 0.42) on narrow ones. Existing boards
 * keep whatever layout they saved.
 */
export function newPaneFor(host: HTMLElement, state: Partial<PaneState> = {}): PaneNode {
  const wide = (host.clientWidth || innerWidth) >= SIDE_MIN_WIDTH;
  return createPane({ layout: wide ? 'side' : 'stacked', seam: wide ? 0.5 : 0.42, ...state });
}

interface ClosedEntry {
  node: PaneNode;
  /** Neighbour to re-attach next to, and on which axis. */
  anchorId: string;
  dir: 'row' | 'col';
}

export interface BoardEvents {
  /** The tree or a pane's persisted state changed. */
  changed(): void;
  /** Active pane / pane set changed (for the status bar, palette, sidebar). */
  focusChanged(): void;
}

export class Board {
  root: LayoutNode;
  private readonly views = new Map<string, PaneView>();
  private activeId: string | null = null;
  private zoomedId: string | null = null;
  private readonly closed: ClosedEntry[] = [];

  constructor(
    private readonly host: HTMLElement,
    initial: LayoutNode | null,
    private readonly events: BoardEvents,
  ) {
    this.root = initial ?? newPaneFor(host);
    // Any focus inside a pane makes it the active one (target of shortcuts).
    host.addEventListener('focusin', (e) => {
      const pane = (e.target as HTMLElement).closest<HTMLElement>('.pane');
      if (pane?.dataset['paneId']) this.setActive(pane.dataset['paneId']);
    });
    host.addEventListener('pointerdown', (e) => {
      const pane = (e.target as HTMLElement).closest<HTMLElement>('.pane');
      if (pane?.dataset['paneId']) this.setActive(pane.dataset['paneId']);
    });
    // Drag-to-reorder: a pane's grip asks for a move (see pane-interactions).
    host.addEventListener('c64:move', (e) => {
      const d = (e as CustomEvent<{ paneId: string; targetId: string; edge: Edge }>).detail;
      if (d) this.move(d.paneId, d.targetId, d.edge);
    });
    installKeyboard(() => {
      const v = this.active;
      return v ? { escapeInPane: () => v.escapeInPane(), focusEditor: () => v.focus() } : null;
    });
    this.render();
    const first = allPanes(this.root)[0]!;
    this.setActive(first.id);
  }

  /* ------------------------------------------------------------- actions */

  private readonly actions: BoardActions = {
    addRight: (id) => this.add(id, 'row'),
    addBelow: (id) => this.add(id, 'col'),
    close: (id) => this.close(id),
    duplicate: (id) => this.duplicate(id),
    swap: (id, delta) => this.swap(id, delta),
    zoom: (id) => this.toggleZoom(id),
    isZoomed: (id) => this.zoomedId === id,
    canClose: () => paneCount(this.root) > 1,
    changed: () => this.persist(),
    outputChanged: (id, text) => this.propagate(id, text),
    otherPanes: (id) => allPanes(this.root).filter((p) => p.id !== id).map((p) => ({ id: p.id, title: this.titleOf(p.id, true) })),
    link: (id, sourceId) => this.link(id, sourceId),
    sendOn: (id) => this.addPiped(id),
    titleOf: (id) => this.titleOf(id),
    rename: (id) => this.rename(id),
  };

  get active(): PaneView | null {
    return this.activeId ? (this.views.get(this.activeId) ?? null) : null;
  }

  get panes(): PaneView[] {
    return allPanes(this.root).map((p) => this.views.get(p.id)!).filter(Boolean);
  }

  get zoomed(): string | null {
    return this.zoomedId;
  }

  /**
   * The user's own title, or "Pane 2". With `long`, the automatic title also
   * names the tool ("Pane 2 · JSON Path") for menus and the palette.
   */
  titleOf(id: string, long = false): string {
    const order = allPanes(this.root);
    const idx = order.findIndex((p) => p.id === id);
    const node = order[idx];
    if (!node) return 'Pane';
    if (node.state.title) return node.state.title;
    const v = this.views.get(id);
    return long ? `Pane ${idx + 1} · ${v ? v.mode.label : node.state.mode}` : `Pane ${idx + 1}`;
  }

  setActive(id: string): void {
    if (this.activeId === id) return;
    this.activeId = id;
    for (const [pid, v] of this.views) v.el.classList.toggle('is-active', pid === id);
    this.events.focusChanged();
  }

  add(targetId: string, dir: 'row' | 'col', fresh?: PaneNode): PaneNode | null {
    const target = findPane(this.root, targetId);
    if (!target) return null;
    // A new pane starts in Auto detect: paste and it picks the tool itself.
    const node = fresh ?? newPaneFor(this.host);
    this.root = addSibling(this.root, targetId, dir, node);
    this.zoomedId = null;
    this.render();
    this.persist();
    this.setActive(node.id);
    this.views.get(node.id)?.focus();
    return node;
  }

  /** Add a pane to the right whose input is piped from `sourceId`. */
  addPiped(sourceId: string): void {
    const src = findPane(this.root, sourceId);
    if (!src) return;
    const node = newPaneFor(this.host, { mode: 'json', sourceId });
    this.add(sourceId, 'row', node);
    const v = this.views.get(sourceId);
    if (v) this.views.get(node.id)?.setInput(v.outputText);
    toast(`New pane reads its input from ${this.titleOf(sourceId, true)}`);
  }

  duplicate(id: string): void {
    const node = findPane(this.root, id);
    if (!node) return;
    this.add(id, 'row', clonePane(node));
    toast('Pane duplicated');
  }

  swap(id: string, delta: 1 | -1): void {
    const order = allPanes(this.root);
    const idx = order.findIndex((p) => p.id === id);
    const other = order[idx + delta];
    if (!other) {
      toast(delta > 0 ? 'Already the last pane' : 'Already the first pane');
      return;
    }
    swapPanes(this.root, id, other.id);
    this.render();
    this.persist();
    this.views.get(id)?.focus();
  }

  /** Drop pane `id` on `edge` of pane `targetId` (drag-to-reorder). */
  move(id: string, targetId: string, edge: Edge): void {
    if (id === targetId || !findPane(this.root, id) || !findPane(this.root, targetId)) return;
    this.root = movePane(this.root, id, targetId, edge);
    this.zoomedId = null;
    this.render();
    this.persist();
    this.setActive(id);
    this.views.get(id)?.focus();
  }

  rename(id: string): void {
    const node = findPane(this.root, id);
    if (!node) return;
    const name = prompt('Pane name (leave empty for the automatic one)', node.state.title ?? '');
    if (name === null) return;
    node.state.title = name.trim() ? name.trim().slice(0, 80) : undefined;
    this.refreshTitles();
    this.persist();
  }

  close(id: string): void {
    if (paneCount(this.root) <= 1) {
      toast('The last pane stays — the board is never empty');
      return;
    }
    const node = findPane(this.root, id);
    if (!node) return;
    // Pick a neighbour to focus afterwards: the pane before it in reading order.
    const order = allPanes(this.root);
    const idx = order.findIndex((p) => p.id === id);
    const next = order[idx - 1] ?? order[idx + 1];
    const parent = findParent(this.root, id);
    this.closed.push({ node, anchorId: (idx > 0 ? order[idx - 1] : order[idx + 1])!.id, dir: parent?.dir ?? 'row' });
    if (this.closed.length > 10) this.closed.shift();

    // Panes that were piped from this one keep their last input, unlinked.
    for (const p of allPanes(this.root)) if (p.state.sourceId === id) this.link(p.id, null);

    this.root = removePane(this.root, id);
    this.views.get(id)?.destroy();
    this.views.delete(id);
    if (this.zoomedId === id) this.zoomedId = null;
    this.render();
    this.persist();
    if (next) {
      this.setActive(next.id);
      this.views.get(next.id)?.focus();
    }
    toast('Pane closed — Alt+Shift+Z restores it');
  }

  /** Re-open the most recently closed pane next to where it was. */
  undoClose(): void {
    const entry = this.closed.pop();
    if (!entry) {
      toast('Nothing to undo');
      return;
    }
    const anchor = findPane(this.root, entry.anchorId) ? entry.anchorId : allPanes(this.root)[0]!.id;
    this.add(anchor, entry.dir, entry.node);
    toast('Pane restored');
  }

  toggleZoom(id?: string): void {
    const target = id ?? this.activeId;
    if (!target) return;
    this.zoomedId = this.zoomedId === target ? null : target;
    this.render();
    this.views.get(target)?.focus();
    this.events.focusChanged();
  }

  /** Move focus to the previous/next pane in reading order (wraps). */
  focusRelative(delta: 1 | -1): void {
    const order = allPanes(this.root);
    if (!order.length) return;
    const idx = Math.max(0, order.findIndex((p) => p.id === this.activeId));
    const next = order[(idx + delta + order.length) % order.length]!;
    if (this.zoomedId && this.zoomedId !== next.id) this.zoomedId = next.id;
    this.setActive(next.id);
    this.render();
    this.views.get(next.id)?.focus();
  }

  focusPane(id: string): void {
    if (!findPane(this.root, id)) return;
    if (this.zoomedId && this.zoomedId !== id) {
      this.zoomedId = id;
      this.render();
    }
    this.setActive(id);
    this.views.get(id)?.focus();
  }

  /* ---------------------------------------------------------------- pipes */

  /** Make pane `id` read its input from `sourceId` (null = unlink). */
  link(id: string, sourceId: string | null): void {
    const node = findPane(this.root, id);
    if (!node) return;
    if (sourceId && (sourceId === id || this.wouldCycle(id, sourceId))) {
      toast('That would create a loop');
      return;
    }
    node.state.sourceId = sourceId ?? undefined;
    const v = this.views.get(id);
    v?.refreshLink();
    if (sourceId) {
      const src = this.views.get(sourceId);
      if (src) v?.setInput(src.outputText);
    }
    this.persist();
  }

  private wouldCycle(id: string, sourceId: string): boolean {
    let cur: string | undefined = sourceId;
    const seen = new Set<string>();
    while (cur) {
      if (cur === id || seen.has(cur)) return true;
      seen.add(cur);
      cur = findPane(this.root, cur)?.state.sourceId;
    }
    return false;
  }

  private propagate(sourceId: string, text: string): void {
    for (const p of allPanes(this.root)) {
      if (p.state.sourceId === sourceId) this.views.get(p.id)?.setInput(text);
    }
  }

  /* ------------------------------------------------------------ swapping */

  /** Replace the whole tree (board switch / import). */
  load(root: LayoutNode): void {
    const clean = sanitize(root) ?? newPaneFor(this.host);
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.closed.length = 0;
    this.zoomedId = null;
    this.root = clean;
    this.render();
    const first = allPanes(this.root)[0]!;
    this.activeId = null;
    this.setActive(first.id);
    this.events.focusChanged();
  }

  persist(): void {
    this.events.changed();
  }

  /* ----------------------------------------------------------- rendering */

  render(): void {
    if (this.zoomedId && findPane(this.root, this.zoomedId)) {
      const view = this.viewFor(findPane(this.root, this.zoomedId)!);
      // Keep the other panes alive (they own editors), just not displayed.
      const hidden = h('div.board-hidden', { hidden: true });
      for (const p of allPanes(this.root)) if (p.id !== this.zoomedId) hidden.append(this.viewFor(p).el);
      this.host.replaceChildren(h('div.split.split-zoom', {}, view.el), hidden);
    } else {
      this.host.replaceChildren(this.build(this.root));
    }
    this.host.classList.toggle('is-zoomed', this.zoomedId !== null);
    // Single-pane boards hide the split/close icons (they live in the ⋯ menu);
    // multi-pane boards keep them in every title bar.
    this.host.dataset['panes'] = paneCount(this.root) > 1 ? 'many' : '1';
    for (const v of this.views.values()) v.refreshChrome();
    this.refreshTitles();
  }

  refreshTitles(): void {
    for (const [id, v] of this.views) v.setTitle(this.titleOf(id));
    this.events.focusChanged();
  }

  private build(node: LayoutNode): HTMLElement {
    if (node.type === 'pane') return this.viewFor(node).el;
    return this.buildSplit(node);
  }

  private viewFor(node: PaneNode): PaneView {
    let v = this.views.get(node.id);
    if (!v) {
      v = new PaneView(node, this.actions);
      this.views.set(node.id, v);
    }
    return v;
  }

  private buildSplit(split: SplitNode): HTMLElement {
    const el = h(`div.split.split-${split.dir}`, { 'data-split-id': split.id });
    split.children.forEach((child, i) => {
      const cell = h('div.cell', {}, this.build(child));
      cell.style.flexGrow = String(split.sizes[i] ?? 0);
      el.append(cell);
      if (i < split.children.length - 1) el.append(this.buildSeam(split, i));
    });
    return el;
  }

  /** The draggable divider after child `index` of `split`. */
  private buildSeam(split: SplitNode, index: number): HTMLElement {
    const horizontalMotion = split.dir === 'row';
    const seam = h('div.seam.seam-between', {
      role: 'separator',
      'aria-orientation': horizontalMotion ? 'vertical' : 'horizontal',
      'aria-label': 'Resize panes',
      tabindex: '0',
      title: horizontalMotion ? 'Drag to resize · ←/→ keys nudge · double-click to even out' : 'Drag to resize · ↑/↓ keys nudge · double-click to even out',
    });

    const applySizes = () => {
      const cells = seam.parentElement!.querySelectorAll<HTMLElement>(':scope > .cell');
      cells.forEach((c, i) => (c.style.flexGrow = String(split.sizes[i] ?? 0)));
    };

    seam.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      seam.setPointerCapture(e.pointerId);
      const container = seam.parentElement!;
      const rect = container.getBoundingClientRect();
      // Space actually shared by the cells = container minus all seams.
      const seamPx = Array.from(container.querySelectorAll<HTMLElement>(':scope > .seam')).reduce(
        (sum, s) => sum + (horizontalMotion ? s.offsetWidth : s.offsetHeight),
        0,
      );
      const usable = (horizontalMotion ? rect.width : rect.height) - seamPx;
      const start = horizontalMotion ? e.clientX : e.clientY;
      const startSizes = [...split.sizes];
      document.body.classList.add('dragging', horizontalMotion ? 'dragging-row' : 'dragging-col');

      const move = (ev: PointerEvent) => {
        const now = horizontalMotion ? ev.clientX : ev.clientY;
        split.sizes = [...startSizes];
        resizeSeam(split, index, (now - start) / usable);
        applySizes();
      };
      const up = () => {
        seam.removeEventListener('pointermove', move);
        seam.removeEventListener('pointerup', up);
        seam.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging', 'dragging-row', 'dragging-col');
        this.persist();
      };
      seam.addEventListener('pointermove', move);
      seam.addEventListener('pointerup', up);
      seam.addEventListener('pointercancel', up);
    });

    // Double-click: even out the two neighbours.
    seam.addEventListener('dblclick', () => {
      const a = split.sizes[index] ?? 0;
      const b = split.sizes[index + 1] ?? 0;
      split.sizes[index] = (a + b) / 2;
      split.sizes[index + 1] = (a + b) / 2;
      applySizes();
      this.persist();
    });

    // Keyboard: arrows nudge, Shift for bigger steps.
    seam.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.03;
      const dec = horizontalMotion ? 'ArrowLeft' : 'ArrowUp';
      const inc = horizontalMotion ? 'ArrowRight' : 'ArrowDown';
      if (e.key === dec) resizeSeam(split, index, -step);
      else if (e.key === inc) resizeSeam(split, index, step);
      else return;
      e.preventDefault();
      applySizes();
      this.persist();
    });

    return seam;
  }
}
