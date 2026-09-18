/**
 * Board — projects the layout tree (src/layout.ts) onto the DOM and handles
 * the interactions that change it: Add Right / Add Below, Close, and dragging
 * the seams between panes.
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
  createPane,
  type LayoutNode,
  type SplitNode,
  type PaneNode,
} from './layout.js';
import { PaneView, type BoardActions } from './pane.js';
import { saveBoard } from './store.js';
import { h, toast } from './ui.js';

export class Board {
  root: LayoutNode;
  private readonly views = new Map<string, PaneView>();
  private activeId: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    initial: LayoutNode | null,
  ) {
    this.root = initial ?? createPane();
    // Any focus inside a pane makes it the active one (target of shortcuts).
    host.addEventListener('focusin', (e) => {
      const pane = (e.target as HTMLElement).closest<HTMLElement>('.pane');
      if (pane?.dataset['paneId']) this.setActive(pane.dataset['paneId']);
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
    canClose: () => paneCount(this.root) > 1,
    changed: () => this.persist(),
  };

  get active(): PaneView | null {
    return this.activeId ? (this.views.get(this.activeId) ?? null) : null;
  }

  setActive(id: string): void {
    if (this.activeId === id) return;
    this.activeId = id;
    for (const [pid, v] of this.views) v.el.classList.toggle('is-active', pid === id);
  }

  add(targetId: string, dir: 'row' | 'col'): void {
    const target = findPane(this.root, targetId);
    if (!target) return;
    // A new pane inherits the neighbour's mode/options — usually what you
    // want when comparing two payloads side by side. Input starts empty.
    const fresh = createPane({ mode: target.state.mode, options: { ...target.state.options }, pretty: target.state.pretty });
    this.root = addSibling(this.root, targetId, dir, fresh);
    this.render();
    this.persist();
    this.setActive(fresh.id);
    this.views.get(fresh.id)?.focus();
  }

  close(id: string): void {
    if (paneCount(this.root) <= 1) {
      toast('The last pane stays — the board is never empty');
      return;
    }
    // Pick a neighbour to focus afterwards: the pane before it in reading order.
    const order = allPanes(this.root);
    const idx = order.findIndex((p) => p.id === id);
    const next = order[idx - 1] ?? order[idx + 1];

    this.root = removePane(this.root, id);
    this.views.get(id)?.el.remove();
    this.views.delete(id);
    this.render();
    this.persist();
    if (next) {
      this.setActive(next.id);
      this.views.get(next.id)?.focus();
    }
  }

  /** Move focus to the previous/next pane in reading order (wraps). */
  focusRelative(delta: 1 | -1): void {
    const order = allPanes(this.root);
    if (!order.length) return;
    const idx = Math.max(0, order.findIndex((p) => p.id === this.activeId));
    const next = order[(idx + delta + order.length) % order.length]!;
    this.setActive(next.id);
    this.views.get(next.id)?.focus();
  }

  persist(): void {
    saveBoard(this.root);
  }

  /* ----------------------------------------------------------- rendering */

  render(): void {
    const tree = this.build(this.root);
    this.host.replaceChildren(tree);
    for (const v of this.views.values()) v.refreshCloseState();
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
      title: horizontalMotion ? 'Drag to resize · ←/→ keys nudge' : 'Drag to resize · ↑/↓ keys nudge',
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
