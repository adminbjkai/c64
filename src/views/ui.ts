/**
 * Rich-view primitives (design system §3). Every renderer in src/views builds
 * from these so the views share one look: a scrolling `.v-body` under an
 * optional 28px bar, sections with hairline headings, label/value grids,
 * data tables, cards, badges and inline-confirming copy buttons.
 *
 * Copying never toasts: the clicked control swaps its text to "Copied" for
 * 1200 ms and an aria-live region announces it. Class names are `v-*`.
 *
 * The small string helpers at the bottom (`statusParts`, `plural`, `count`)
 * are DOM-free so they can be unit-tested in node.
 */

import { h, copyText } from '../ui.js';
import { icon } from '../icons.js';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
type Child = Node | string | null | undefined;

/* --------------------------------------------------------------- copying */

const DONE_MS = 1200;
let liveRegion: HTMLElement | null = null;
const pending = new WeakMap<HTMLElement, { restore: Node[]; timer: number }>();

function announce(message: string): void {
  if (!liveRegion) {
    liveRegion = h('div.v-live', { role: 'status', 'aria-live': 'polite' });
    document.body.append(liveRegion);
  }
  liveRegion.textContent = '';
  liveRegion.textContent = message;
}

/**
 * Copy `text` and confirm inline on `button`: its content becomes "Copied"
 * (class `is-done`) for 1200 ms, then the original content is restored.
 */
export function copyInline(button: HTMLElement, text: string): void {
  void copyText(text).then((ok) => {
    const prior = pending.get(button);
    if (prior) clearTimeout(prior.timer);
    const restore = prior ? prior.restore : Array.from(button.childNodes);
    button.replaceChildren(ok ? 'Copied' : "Couldn't copy");
    button.classList.toggle('is-done', ok);
    button.classList.toggle('is-failed', !ok);
    announce(ok ? 'Copied to clipboard' : "Couldn't copy. Select the result and press Ctrl+C.");
    const timer = window.setTimeout(() => {
      button.replaceChildren(...restore);
      button.classList.remove('is-done', 'is-failed');
      pending.delete(button);
    }, DONE_MS);
    pending.set(button, { restore, timer });
  });
}

/** A transparent mono button showing `display ?? value`; click copies `value`. */
export function copyable(value: string, opts: { label?: string; display?: string | Node } = {}): HTMLButtonElement {
  const what = opts.label ? `Copy ${opts.label}` : 'Copy';
  const b = h<HTMLButtonElement>('button.v-copy', { type: 'button', title: what, 'aria-label': `${what}: ${value}` });
  b.append(h('span.v-copy-t', {}, opts.display ?? value), h('span.v-copy-i', {}, icon('copy', 12)));
  b.addEventListener('click', () => copyInline(b, value));
  return b;
}

/** A `.btn.small` whose click copies `text` and confirms inline. */
export function copyButton(label: string, text: () => string): HTMLButtonElement {
  const b = h<HTMLButtonElement>('button.btn.small', { type: 'button' }, label);
  b.addEventListener('click', () => copyInline(b, text()));
  return b;
}

/* ----------------------------------------------------------------- shell */

export interface ShellOptions {
  /** Left side of the bar: badges, short text. */
  status?: Child[];
  /** Right side of the bar: buttons, selects. */
  actions?: Child[];
  /** No body padding (tables, trees, previews that want the full width). */
  flush?: boolean;
  /** Body is a non-scrolling flex column; the child manages its own scroll. */
  column?: boolean;
}

/** Optional 28px bar + a scrolling body appended to `host`. */
export function viewShell(host: HTMLElement, opts: ShellOptions = {}): { body: HTMLElement; bar: HTMLElement | null } {
  const hasBar = (opts.status?.length ?? 0) > 0 || (opts.actions?.length ?? 0) > 0;
  let bar: HTMLElement | null = null;
  if (hasBar) {
    bar = h('div.v-bar', {}, h('div.v-bar-status', {}, ...(opts.status ?? [])), h('div.v-bar-actions', {}, ...(opts.actions ?? [])));
    host.append(bar);
  }
  const body = h('div.v-body');
  if (opts.flush) body.classList.add('is-flush');
  if (opts.column) body.classList.add('is-column');
  host.append(body);
  return { body, bar };
}

/* --------------------------------------------------------------- section */

export function section(title: Child, opts: { actions?: Child[]; meta?: Child } = {}, ...children: Child[]): HTMLElement {
  const head = h('div.v-section-h', {}, h('span.v-section-t', {}, title), opts.meta !== undefined && opts.meta !== null ? h('span.v-section-m', {}, opts.meta) : null);
  if (opts.actions?.length) head.append(h('span.v-spacer'), h('span.v-section-a', {}, ...opts.actions));
  return h('section.v-section', {}, head, ...children);
}

/* --------------------------------------------------------------- kvTable */

export interface KvRow {
  label: Child;
  value: Child;
  /** Text to copy; defaults to `value` when it is a string. `false` disables. */
  copy?: string | false;
  note?: Child;
  tone?: Tone;
}

/** Label / value / note grid; every string value is a `copyable`. */
export function kvTable(rows: KvRow[]): HTMLElement {
  const grid = h('div.v-kv');
  for (const r of rows) {
    const toneCls = r.tone ? `.is-${r.tone}` : '';
    const copy = r.copy === false ? undefined : r.copy ?? (typeof r.value === 'string' ? r.value : undefined);
    const label = typeof r.label === 'string' ? r.label : undefined;
    const value = copy !== undefined ? copyable(copy, { label, display: r.value ?? undefined }) : r.value;
    grid.append(h(`div.v-kv-l${toneCls}`, {}, r.label), h(`div.v-kv-v${toneCls}`, {}, value), h(`div.v-kv-n${toneCls}`, {}, r.note));
  }
  return grid;
}

/* ------------------------------------------------------------- dataTable */

export interface Column {
  key: string;
  label: Child;
  numeric?: boolean;
  mono?: boolean;
  /** Long text: wrap instead of clipping. */
  wrap?: boolean;
  /** Extra class(es) on every cell of this column; `is-full` lifts the max-width so long values scroll instead of clipping. */
  cls?: string;
}

/** A cell: plain text (copyable), a node (as-is), or text with a class. */
export type Cell = string | number | Node | null | undefined | { text: Child; cls?: string; copy?: string | false };
export type Row = Record<string, Cell>;

export interface TableOptions {
  sticky?: boolean;
  /** Prepend a muted row-number column. */
  rowNum?: boolean;
  /** Render the header row (default true). */
  header?: boolean;
  /** Text cells become copyables (default true). */
  copy?: boolean;
  onRow?: (row: Row, index: number, tr: HTMLTableRowElement) => void;
  rowClass?: (row: Row, index: number) => string | undefined;
  cls?: string;
}

export function dataTable(columns: Column[], rows: Row[], opts: TableOptions = {}): HTMLElement {
  const sticky = opts.sticky ?? true;
  const table = h(`table.v-table${opts.cls ? '.' + opts.cls : ''}`);
  if (sticky) table.classList.add('is-sticky');
  if (opts.header !== false) {
    const tr = h('tr');
    if (opts.rowNum) tr.append(h('th.v-num', {}, '#'));
    for (const c of columns) tr.append(h(`th${c.numeric ? '.is-num' : ''}`, {}, c.label));
    table.append(h('thead', {}, tr));
  }
  const body = h('tbody');
  rows.forEach((row, i) => {
    const rc = opts.rowClass?.(row, i);
    const tr = h<HTMLTableRowElement>(`tr${rc ? '.' + rc : ''}`);
    if (opts.rowNum) tr.append(h('td.v-num', {}, String(i + 1)));
    for (const c of columns) {
      const td = h('td');
      for (const cls of [c.numeric ? 'is-num' : '', c.mono ? 'is-mono' : '', c.wrap ? 'is-wrap' : '', ...(c.cls ?? '').split(' ')]) if (cls) td.classList.add(cls);
      const raw = row[c.key];
      const spec = raw !== null && typeof raw === 'object' && !(raw instanceof Node) ? raw : { text: raw === null || raw === undefined ? undefined : typeof raw === 'number' ? String(raw) : raw };
      if (spec.cls) td.classList.add(spec.cls);
      if (spec.text === undefined || spec.text === null) {
        td.classList.add('is-missing');
      } else {
        const label = typeof c.label === 'string' ? c.label.toLowerCase() : undefined;
        const copy = spec.copy === false || opts.copy === false ? undefined : spec.copy ?? (typeof spec.text === 'string' ? spec.text : undefined);
        td.append(copy !== undefined ? copyable(copy, { label, display: spec.text }) : spec.text);
      }
      tr.append(td);
    }
    if (opts.onRow) {
      tr.classList.add('is-clickable');
      tr.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.v-copy')) return;
        opts.onRow!(row, i, tr);
      });
    }
    body.append(tr);
  });
  table.append(body);
  return h('div.v-table-wrap', {}, table);
}

/* -------------------------------------------------------------- cardList */

export interface Card {
  title?: Child;
  /** Badges / short muted text after the title. */
  meta?: Child[];
  body: Child | Child[];
  actions?: Child[];
}

export function cardList(cards: Card[], opts: { compact?: boolean } = {}): HTMLElement {
  const list = h(`div.v-cards${opts.compact ? '.is-compact' : ''}`);
  for (const c of cards) {
    const card = h('section.v-card');
    if (c.title !== undefined || c.meta?.length || c.actions?.length) {
      const head = h('div.v-card-h', {}, c.title !== undefined ? h('span.v-card-t', {}, c.title) : null, ...(c.meta ?? []));
      if (c.actions?.length) head.append(h('span.v-spacer'), h('span.v-card-a', {}, ...c.actions));
      card.append(head);
    }
    card.append(h('div.v-card-b', {}, ...(Array.isArray(c.body) ? c.body : [c.body])));
    list.append(card);
  }
  return list;
}

/* ------------------------------------------------------- empty / badge / note */

export function emptyState(message: string, action?: { label: string; run: () => void }): HTMLElement {
  const el = h('div.v-empty', {}, h('p', {}, message));
  if (action) {
    const b = h('button.btn.small', { type: 'button' }, action.label);
    b.addEventListener('click', action.run);
    el.append(b);
  }
  return el;
}

export function badge(kind: Tone, text: Child): HTMLElement {
  return h(`span.v-badge.is-${kind}`, {}, text);
}

/** A short notice inside a view (warnings, unverified-signature notes). */
export function note(tone: Tone, ...children: Child[]): HTMLElement {
  return h(`div.v-note.is-${tone}`, { role: 'note' }, ...children);
}

/** Muted inline text for bars and heads. */
export function muted(text: string): HTMLElement {
  return h('span.v-muted', {}, text);
}

/* ------------------------------------------------- string helpers (DOM-free) */

/** Split "Verdict — fact, fact" into its parts (§5 status grammar). */
export function statusParts(status: string): { verdict: string; facts: string[] } {
  const i = status.indexOf(' — ');
  if (i < 0) return { verdict: status.trim(), facts: [] };
  return {
    verdict: status.slice(0, i).trim(),
    facts: status
      .slice(i + 3)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** "1 match", "12 matches" — regular plurals only. */
export function plural(n: number, word: string, pluralWord = word + 's'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : pluralWord}`;
}

/** Join facts with commas, dropping empties (never "·"). */
export function facts(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(', ');
}
