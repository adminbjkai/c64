/**
 * The movable "Explain" panel that floats inside a pane. It calls the pure
 * `explain()` heuristics (src/explain.ts) on the pane's input and offers
 * one-click suggestions that switch the pane's mode/options.
 *
 * Draggable by its title bar within the pane; closes with × or Escape.
 */

import { explain, type Explanation } from './explain.js';
import { h } from './ui.js';

export interface ExplainHost {
  getInput(): string;
  apply(mode: string, options?: Record<string, unknown>): void;
}

export class ExplainPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private open = false;
  private refreshTimer: number | undefined;

  constructor(private readonly host: ExplainHost) {
    this.body = h('div.explain-body');
    const close = h('button.btn.icon.close', { type: 'button', 'aria-label': 'Close explain panel' }, '×');
    close.addEventListener('click', () => this.toggle(false));
    const title = h('div.explain-title', {}, h('strong', {}, 'Explain'), h('span.muted', {}, ' · local, no server'), h('span.spacer'), close);
    this.el = h('aside.explain', { hidden: true, role: 'dialog', 'aria-label': 'Explain input' }, title, this.body);
    this.bindDrag(title);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggle(false);
    });
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.el.hidden = !this.open;
    if (this.open) {
      this.render();
      this.el.querySelector<HTMLElement>('button')?.focus();
    }
  }

  /** Re-run heuristics when the input changes (debounced, only while open). */
  refresh(): void {
    if (!this.open) return;
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.render(), 250);
  }

  private render(): void {
    let ex: Explanation;
    try {
      ex = explain(this.host.getInput());
    } catch (e) {
      ex = { shape: 'Could not analyse', confidence: 'low', reasons: [(e as Error).message], suggestions: [] };
    }
    this.body.replaceChildren(
      h('div.explain-shape', {}, h('span', {}, ex.shape), h(`span.badge.${{ high: 'ok', medium: 'warn', low: 'muted' }[ex.confidence]}`, {}, `${ex.confidence} confidence`)),
      h('ul.explain-reasons', {}, ...ex.reasons.map((r) => h('li', {}, r))),
    );
    if (ex.suggestions.length) {
      const list = h('div.explain-suggestions', {}, h('div.label', {}, 'Next steps'));
      for (const s of ex.suggestions) {
        const btn = h('button.btn.small', { type: 'button', title: s.note ?? '' }, s.label);
        btn.addEventListener('click', () => this.host.apply(s.mode, s.options));
        list.append(btn);
      }
      this.body.append(list);
    }
  }

  private bindDrag(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const parent = this.el.parentElement!.getBoundingClientRect();
      const rect = this.el.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const move = (ev: PointerEvent): void => {
        const x = Math.min(Math.max(0, ev.clientX - dx - parent.left), parent.width - rect.width);
        const y = Math.min(Math.max(0, ev.clientY - dy - parent.top), parent.height - rect.height);
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
        this.el.style.right = 'auto';
      };
      const up = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
}
