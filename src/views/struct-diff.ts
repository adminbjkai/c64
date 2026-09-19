/**
 * Structural diff renderer (JSON / XML / YAML Compare, JSON Patch preview).
 *
 * Summary bar: count badges, filter chips per change kind, "N of M" with
 * Prev / Next (keyboard n / p while the view is focused) and a side-by-side
 * ↔ inline toggle. Below it, one table row per pointer path. Side-by-side
 * shows the Original and Changed values in two columns; inline shows a single
 * `old → new` column. Rows are classed sd-add / sd-del / sd-chg / sd-type /
 * sd-move / sd-eq.
 *
 * Laziness: rows are built when a node is expanded (equal subtrees start
 * collapsed and are expanded from the value on demand); with `onlyChanges`
 * runs of equal siblings fold into one "… N unchanged" row. Rendering stops
 * at ROW_CAP rows with a notice. Clicking a row copies its JSON Pointer.
 */

import { h } from '../ui.js';
import type { AlignNode, AlignStatus, Change, DiffSummary } from '../lib/structural-diff.js';
import type { ViewRenderer } from './types.js';

export interface StructDiffData {
  left: unknown;
  right: unknown;
  changes: Change[];
  summary: DiffSummary;
  onlyChanges: boolean;
  tree: AlignNode;
  /** Column headings, default Original / Changed. */
  labels?: [string, string];
}

const ROW_CAP = 5000;
const STATUS_CLASS: Record<AlignStatus, string> = { eq: 'sd-eq', add: 'sd-add', del: 'sd-del', chg: 'sd-chg', type: 'sd-type', move: 'sd-move' };
const CHIPS: { status: AlignStatus; label: string }[] = [
  { status: 'add', label: 'added' },
  { status: 'del', label: 'removed' },
  { status: 'chg', label: 'changed' },
  { status: 'type', label: 'type' },
  { status: 'move', label: 'moved' },
];

const isContainer = (v: unknown): v is object => v !== null && typeof v === 'object';

function summaryText(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  const n = Object.keys(v as object).length;
  return n === 0 ? '{}' : `{${n} key${n === 1 ? '' : 's'}}`;
}

/** A value cell: container summary or a coloured literal (reuses the json-tree literal classes). */
function valueSpan(v: unknown, present: boolean): HTMLElement {
  if (!present) return h('span.sd-absent', {}, '');
  if (isContainer(v)) return h('span.tn-summary', {}, summaryText(v));
  if (v === null || v === undefined) return h('span.tn-val.null', {}, 'null');
  if (typeof v === 'string') {
    const s = JSON.stringify(v);
    return h('span.tn-val.str', {}, s.length > 120 ? s.slice(0, 117) + '…"' : s);
  }
  return h(`span.tn-val.${typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'plain'}`, {}, String(v));
}

/** Children of an equal / added / removed container, synthesised from its one value (no diff needed). */
function eqChildren(node: AlignNode): AlignNode[] {
  const v = node.status === 'del' ? node.left : node.right;
  if (!isContainer(v)) return [];
  const status: AlignStatus = node.status === 'add' || node.status === 'del' ? node.status : 'eq';
  const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
  return entries.map(([k, x]) => ({
    key: k,
    path: node.path + '/' + String(k).replace(/~/g, '~0').replace(/\//g, '~1'),
    status,
    left: status === 'add' ? undefined : x,
    right: status === 'del' ? undefined : x,
    changes: 0,
  }));
}

export const renderStructDiff: ViewRenderer = (host, raw, ctx) => {
  const d = raw as StructDiffData;
  const [labelA, labelB] = d.labels ?? ['Original', 'Changed'];
  let inline = false;
  const filters = new Set<AlignStatus>(CHIPS.map((c) => c.status));
  let current = -1;
  let rowCount = 0;
  let capped = false;

  /* -------------------------------------------------------------- bar */
  const s = d.summary;
  const badges = h(
    'span.sd-badges',
    {},
    h('span.badge.ok', {}, `+${s.added}`),
    h('span.badge.bad', {}, `−${s.removed}`),
    h('span.badge.warn', {}, `~${s.changed}`),
    s.typeChanges ? h('span.badge', {}, `${s.typeChanges} type`) : null,
    s.moved ? h('span.badge', {}, `${s.moved} moved`) : null,
  );
  const chips = h('span.sd-chips');
  for (const c of CHIPS) {
    const el = h('button.sd-chip.is-on', { type: 'button', 'data-status': c.status, 'aria-pressed': 'true' }, c.label);
    el.addEventListener('click', () => {
      if (filters.has(c.status)) filters.delete(c.status);
      else filters.add(c.status);
      el.classList.toggle('is-on', filters.has(c.status));
      el.setAttribute('aria-pressed', String(filters.has(c.status)));
      applyFilters();
    });
    chips.append(el);
  }
  const navCount = h('span.sd-nav-count', {}, '');
  const prev = h<HTMLButtonElement>('button.btn.small', { type: 'button', title: 'Previous change (p)' }, 'Prev');
  const next = h<HTMLButtonElement>('button.btn.small', { type: 'button', title: 'Next change (n)' }, 'Next');
  const layout = h('button.btn.small', { type: 'button' }, 'Inline view');
  const bar = h('div.sd-bar', {}, badges, chips, h('span.sd-nav', {}, navCount, prev, next), layout);

  /* ------------------------------------------------------------ table */
  const wrap = h('div.table-wrap.sd-wrap');
  let tbody: HTMLElement = h('tbody');

  const makeRow = (node: AlignNode, depth: number, expandable: boolean, expanded: boolean): HTMLTableRowElement => {
    const tr = h<HTMLTableRowElement>(`tr.sd-row.${STATUS_CLASS[node.status]}`, { 'data-path': node.path, 'data-depth': String(depth), 'data-status': node.status });
    const pathCell = h('td.sd-path');
    pathCell.style.paddingLeft = `${8 + depth * 16}px`;
    const caret = expandable ? h('button.sd-caret', { type: 'button', tabindex: '-1', 'aria-label': 'Toggle' }, expanded ? '▾' : '▸') : h('span.sd-caret.sd-leaf');
    pathCell.append(caret, h('span.sd-key', {}, node.key === null ? '(root)' : typeof node.key === 'number' ? `[${node.key}]` : JSON.stringify(node.key)));
    if (node.from) pathCell.append(h('span.sd-from', {}, ` ← ${node.from}`));
    tr.append(pathCell);
    const hasLeft = node.status !== 'add';
    const hasRight = node.status !== 'del';
    if (inline) {
      const cell = h('td.sd-val');
      if (node.status === 'chg' || node.status === 'type') {
        if (isContainer(node.left) && isContainer(node.right) && node.status === 'chg') cell.append(valueSpan(node.right, true));
        else cell.append(h('span.sd-old', {}, valueSpan(node.left, true)), h('span.sd-arrow', {}, ' → '), h('span.sd-new', {}, valueSpan(node.right, true)));
      } else if (node.status === 'del') cell.append(h('span.sd-old', {}, valueSpan(node.left, true)));
      else cell.append(h('span.sd-new', {}, valueSpan(node.right, true)));
      tr.append(cell);
    } else {
      tr.append(h('td.sd-left', {}, valueSpan(node.left, hasLeft)), h('td.sd-right', {}, valueSpan(node.right, hasRight)));
    }
    if (expandable) {
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(tr, node, depth);
      });
    }
    tr.addEventListener('click', () => ctx.copy(node.path === '' ? '' : node.path, 'pointer'));
    return tr;
  };

  const childrenOf = (node: AlignNode): AlignNode[] => node.children ?? eqChildren(node);
  const isExpandable = (node: AlignNode): boolean => {
    if ((node.children?.length ?? 0) > 0) return true;
    if (node.status === 'chg' || node.status === 'type') return false;
    const v = node.status === 'del' ? node.left : node.right;
    return isContainer(v) && Object.keys(v).length > 0;
  };

  /** Rows for a list of sibling nodes (folds equal runs when onlyChanges). */
  const buildRows = (nodes: AlignNode[], depth: number, out: HTMLTableRowElement[]): void => {
    let i = 0;
    while (i < nodes.length) {
      if (rowCount >= ROW_CAP) {
        capped = true;
        return;
      }
      const node = nodes[i]!;
      if (d.onlyChanges && node.status === 'eq') {
        let j = i;
        while (j < nodes.length && nodes[j]!.status === 'eq') j++;
        const run = nodes.slice(i, j);
        const fold = h<HTMLTableRowElement>('tr.sd-fold', { 'data-depth': String(depth) });
        const cell = h('td', { colspan: inline ? '2' : '3' }, h('button.sd-fold-btn', { type: 'button' }, `… ${run.length} unchanged`));
        cell.style.paddingLeft = `${8 + depth * 16}px`;
        fold.append(cell);
        fold.addEventListener('click', () => {
          const rows: HTMLTableRowElement[] = [];
          for (const n of run) {
            rowCount++;
            rows.push(makeRow(n, depth, isExpandable(n), false));
          }
          fold.replaceWith(...rows);
          applyFilters();
        });
        rowCount++;
        out.push(fold);
        i = j;
        continue;
      }
      const expandable = isExpandable(node);
      const expanded = expandable && node.changes > 0;
      rowCount++;
      out.push(makeRow(node, depth, expandable, expanded));
      if (expanded) buildRows(childrenOf(node), depth + 1, out);
      i++;
    }
  };

  const toggle = (tr: HTMLTableRowElement, node: AlignNode, depth: number): void => {
    const caret = tr.querySelector('.sd-caret')!;
    const open = caret.textContent === '▾';
    if (open) {
      let sib = tr.nextElementSibling as HTMLElement | null;
      while (sib && Number(sib.dataset['depth']) > depth) {
        const nxt = sib.nextElementSibling as HTMLElement | null;
        sib.remove();
        rowCount--;
        sib = nxt;
      }
      caret.textContent = '▸';
    } else {
      const rows: HTMLTableRowElement[] = [];
      buildRows(childrenOf(node), depth + 1, rows);
      tr.after(...rows);
      caret.textContent = '▾';
      if (capped) ctx.toast(`Showing the first ${ROW_CAP} rows`);
    }
    applyFilters();
  };

  const draw = (): void => {
    rowCount = 0;
    capped = false;
    current = -1;
    const table = h('table.csv-table.sd-table');
    table.append(
      h('thead', {}, inline ? h('tr', {}, h('th', {}, 'Path'), h('th', {}, `${labelA} → ${labelB}`)) : h('tr', {}, h('th', {}, 'Path'), h('th', {}, labelA), h('th', {}, labelB))),
    );
    tbody = h('tbody');
    const rows: HTMLTableRowElement[] = [];
    const root = d.tree;
    if (root.status === 'eq') {
      rows.push(makeRow(root, 0, isExpandable(root), false));
      rowCount++;
    } else if (root.children) {
      buildRows(root.children, 0, rows);
    } else {
      rows.push(makeRow(root, 0, false, false));
      rowCount++;
    }
    tbody.append(...rows);
    if (capped) tbody.append(h('tr.sd-notice', {}, h('td', { colspan: inline ? '2' : '3' }, `Showing the first ${ROW_CAP} rows — narrow the comparison to see more.`)));
    table.append(tbody);
    wrap.replaceChildren(table);
    layout.textContent = inline ? 'Side by side' : 'Inline view';
    applyFilters();
  };

  /* ------------------------------------------------------- navigation */
  const changeRows = (): HTMLElement[] => Array.from(tbody.querySelectorAll<HTMLElement>('tr.sd-row')).filter((r) => r.dataset['status'] !== 'eq' && !r.hidden);

  const applyFilters = (): void => {
    for (const r of tbody.querySelectorAll<HTMLElement>('tr.sd-row')) {
      const st = r.dataset['status'] as AlignStatus;
      r.hidden = st !== 'eq' && !filters.has(st);
    }
    const rows = changeRows();
    if (current >= rows.length) current = rows.length - 1;
    updateNav(rows);
  };

  const updateNav = (rows: HTMLElement[]): void => {
    for (const r of tbody.querySelectorAll('.is-current')) r.classList.remove('is-current');
    if (current >= 0 && rows[current]) rows[current]!.classList.add('is-current');
    navCount.textContent = rows.length === 0 ? 'no changes' : `${current >= 0 ? current + 1 : '–'} of ${rows.length}`;
    prev.disabled = rows.length === 0;
    next.disabled = rows.length === 0;
  };

  const step = (delta: number): void => {
    const rows = changeRows();
    if (rows.length === 0) return;
    current = current < 0 ? (delta > 0 ? 0 : rows.length - 1) : (current + delta + rows.length) % rows.length;
    updateNav(rows);
    rows[current]!.scrollIntoView({ block: 'center' });
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  layout.addEventListener('click', () => {
    inline = !inline;
    draw();
  });

  const root = h('div.sd', { tabindex: '0' });
  root.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'n' || ke.key === 'j') {
      step(1);
      ke.preventDefault();
    } else if (ke.key === 'p' || ke.key === 'k') {
      step(-1);
      ke.preventDefault();
    }
  });
  draw();
  root.append(bar);
  if (d.changes.length === 0) root.append(h('div.sd-identical.muted', {}, 'No differences'));
  root.append(wrap);
  host.append(root);
};
