/**
 * Command palette (⌘/Ctrl+K): one fuzzy-searchable list of tools (switch
 * the active pane), actions (pane and workspace commands) and boards.
 * Arrow keys move, Enter runs, Escape closes. Recently used commands float
 * to the top when the query is empty.
 */

import { icon } from './icons.js';
import { h } from './ui.js';

export interface Command {
  id: string;
  label: string;
  /** Section header the item is grouped under. */
  group: string;
  hint?: string;
  icon?: string;
  keys?: string;
  keywords?: string;
  run(): void;
}

const RECENT_KEY = 'c64.palette.recent';
const MAX_RESULTS = 60;

/** Subsequence match with a score favouring word starts and contiguity. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  const idx = t.indexOf(q);
  if (idx !== -1) return 100 - idx * 0.5 + (idx === 0 || /[\s\-_/·]/.test(t[idx - 1]!) ? 20 : 0);
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at === -1) return 0;
    streak = at === ti ? streak + 1 : 0;
    score += 3 + streak * 2 + (at === 0 || /[\s\-_/·]/.test(t[at - 1]!) ? 6 : 0);
    ti = at + 1;
  }
  return score;
}

export class Palette {
  private readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private commands: Command[] = [];
  private shown: Command[] = [];
  private selected = 0;
  private recent: string[] = [];

  constructor(private readonly provider: () => Command[]) {
    this.input = h<HTMLInputElement>('input.palette-input', { type: 'text', placeholder: 'Type a tool, action or board name…', 'aria-label': 'Command palette', spellcheck: 'false', autocomplete: 'off' });
    this.list = h('div.palette-list', { role: 'listbox' });
    this.el = h(
      'div.palette-backdrop',
      { hidden: true },
      h('div.palette', { role: 'dialog', 'aria-label': 'Command palette' }, h('div.palette-head', {}, icon('command', 16), this.input, h('kbd', {}, 'Esc')), this.list, h('div.palette-foot', {}, h('span', {}, h('kbd', {}, '↑↓'), ' move'), h('span', {}, h('kbd', {}, '↵'), ' run'), h('span.spacer'), h('span.muted', {}, 'Everything runs locally'))),
    );
    document.body.append(this.el);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') this.move(1);
      else if (e.key === 'ArrowUp') this.move(-1);
      else if (e.key === 'Enter') this.runSelected();
      else if (e.key === 'Escape') this.close();
      else return;
      e.preventDefault();
    });
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) this.recent = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(query = ''): void {
    this.commands = this.provider();
    this.el.hidden = false;
    this.input.value = query;
    this.filter();
    this.input.focus();
  }

  close(): void {
    this.el.hidden = true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private filter(): void {
    const q = this.input.value.trim();
    let rows: { c: Command; s: number }[];
    if (!q) {
      const rank = (c: Command) => {
        const r = this.recent.indexOf(c.id);
        return r === -1 ? 1000 : r;
      };
      rows = this.commands.map((c) => ({ c, s: 0 })).sort((a, b) => rank(a.c) - rank(b.c));
    } else {
      rows = this.commands
        .map((c) => ({ c, s: Math.max(fuzzyScore(q, c.label), fuzzyScore(q, `${c.group} ${c.keywords ?? ''} ${c.hint ?? ''}`) * 0.6) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s);
    }
    this.shown = rows.slice(0, MAX_RESULTS).map((r) => r.c);
    this.selected = 0;
    this.renderList(q);
  }

  private renderList(q: string): void {
    this.list.replaceChildren();
    if (!this.shown.length) {
      this.list.append(h('div.palette-empty', {}, `No match for “${q}”`));
      return;
    }
    let lastGroup = '';
    this.shown.forEach((c, i) => {
      const group = !q && this.recent.includes(c.id) && i < 5 ? 'Recent' : c.group;
      if (group !== lastGroup) {
        this.list.append(h('div.palette-group', {}, group));
        lastGroup = group;
      }
      const row = h('button.palette-item', { type: 'button', role: 'option', 'data-i': String(i), 'aria-selected': String(i === this.selected) });
      row.append(icon(c.icon ?? 'chevronRight', 15), h('span.palette-label', {}, c.label), c.hint ? h('span.palette-hint', {}, c.hint) : '', c.keys ? h('kbd', {}, c.keys) : '');
      row.addEventListener('click', () => {
        this.selected = i;
        this.runSelected();
      });
      row.addEventListener('pointermove', () => {
        if (this.selected !== i) {
          this.selected = i;
          this.paintSelection();
        }
      });
      this.list.append(row);
    });
  }

  private paintSelection(): void {
    for (const b of this.list.querySelectorAll<HTMLElement>('.palette-item')) {
      const on = Number(b.dataset['i']) === this.selected;
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest' });
    }
  }

  private move(delta: number): void {
    if (!this.shown.length) return;
    this.selected = (this.selected + delta + this.shown.length) % this.shown.length;
    this.paintSelection();
  }

  private runSelected(): void {
    const c = this.shown[this.selected];
    if (!c) return;
    this.close();
    this.recent = [c.id, ...this.recent.filter((id) => id !== c.id)].slice(0, 8);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    } catch {
      /* ignore */
    }
    c.run();
  }
}
