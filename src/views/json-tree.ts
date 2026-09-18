/**
 * Collapsible JSON tree — used by Tree View and by JSON Path (which adds a
 * path bar, a style toggle and live query results on top).
 *
 * Performance: rows are created lazily when a node is expanded, and arrays
 * or objects with more than CHUNK children are paged ("Show 200 more"), so
 * a multi-MB document never materialises the whole DOM at once.
 */

import { h } from '../ui.js';
import { pathKey } from '../modes/json-parse.js';
import { formatPath } from '../lib/jsonpath.js';
import type { ViewContext, ViewRenderer } from './types.js';

export type Segs = (string | number)[];

export interface TreeData {
  value: unknown;
  /** pathKey(segments) → [start, end) in the source text. */
  spans: Map<string, [number, number]>;
  /** JSON Path mode extras. */
  path?: {
    query: string;
    matches: { path: Segs; value: unknown }[];
    queryError?: string;
    /** Path segments the mode found selected (persisted in options). */
    selected?: Segs;
  };
}

const CHUNK = 200;
const EXPAND_ALL_CAP = 5000;
const DEFAULT_DEPTH = 2;

const isContainer = (v: unknown): v is object => v !== null && typeof v === 'object';

function summary(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  if (isContainer(v)) {
    const n = Object.keys(v).length;
    return n === 0 ? '{}' : `{${n} key${n === 1 ? '' : 's'}}`;
  }
  return '';
}

/** Compact, single-line literal for a primitive (long strings ellipsised). */
function literal(v: unknown): { text: string; cls: string } {
  if (v === null) return { text: 'null', cls: 'null' };
  switch (typeof v) {
    case 'string': {
      const s = JSON.stringify(v);
      return { text: s.length > 120 ? s.slice(0, 117) + '…"' : s, cls: 'str' };
    }
    case 'number':
      return { text: String(v), cls: 'num' };
    case 'boolean':
      return { text: String(v), cls: 'bool' };
    default:
      return { text: String(v), cls: '' };
  }
}

function childEntries(v: object): [string | number, unknown][] {
  return Array.isArray(v) ? v.map((x, i) => [i, x] as [number, unknown]) : Object.entries(v);
}

function getAt(root: unknown, segs: Segs): unknown {
  let cur = root;
  for (const s of segs) {
    if (!isContainer(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[String(s)];
  }
  return cur;
}

export const renderJsonTree: ViewRenderer = (host, raw, ctx) => {
  const data = raw as TreeData;
  const style = ctx.options['pathStyle'] === 'bracket' ? 'bracket' : 'dot';
  const pathMode = !!data.path;
  const rowByKey = new Map<string, HTMLElement>();
  let selectedRow: HTMLElement | null = null;

  /* ------------------------------------------------------------ toolbar */
  const expandAll = h('button.btn.small', { type: 'button', title: 'Expand every node (capped for huge documents)' }, 'Expand all');
  const collapseAll = h('button.btn.small', { type: 'button' }, 'Collapse all');
  const toolbar = h('div.view-toolbar', {}, expandAll, collapseAll);

  let pathBar: HTMLElement | null = null;
  let pathText: HTMLElement | null = null;
  if (pathMode) {
    pathText = h('code.path-text', {}, formatPath(data.path!.selected ?? [], style));
    const styleBtn = h('button.btn.small', { type: 'button', title: 'Toggle $.a.b[0] / $[\'a\'][\'b\'][0]' }, style === 'dot' ? 'dot' : 'bracket');
    styleBtn.addEventListener('click', () => ctx.setOption('pathStyle', style === 'dot' ? 'bracket' : 'dot'));
    const copyPath = h('button.btn.small', { type: 'button' }, 'Copy path');
    copyPath.addEventListener('click', () => ctx.copy(pathText!.textContent ?? '', 'path'));
    pathBar = h('div.path-bar', {}, h('span.label', {}, 'Path'), pathText, styleBtn, copyPath);
  }

  /* --------------------------------------------------------------- tree */
  const tree = h('div.json-tree', { role: 'tree' });

  const select = (row: HTMLElement, segs: Segs, scroll = false): void => {
    selectedRow?.classList.remove('is-selected');
    selectedRow = row;
    row.classList.add('is-selected');
    if (pathText) pathText.textContent = formatPath(segs, style);
    if (pathMode) ctx.options['selectedPath'] = segs; // remembered without a re-run
    const span = data.spans.get(pathKey(segs));
    if (span) ctx.selectInEditor(span[0], span[1]);
    if (scroll) row.scrollIntoView({ block: 'center' });
  };

  /** Build one node row (+ lazily its children container). */
  const buildNode = (key: string | number | null, value: unknown, segs: Segs, depth: number): HTMLElement => {
    const container = isContainer(value);
    const wrap = h('div.tn', { role: 'treeitem', 'data-depth': String(depth) });
    const row = h('div.tn-row', { tabindex: '0' });
    row.style.paddingLeft = `${8 + depth * 16}px`;
    rowByKey.set(pathKey(segs), row);

    const caret = container
      ? h('button.tn-caret', { type: 'button', tabindex: '-1', 'aria-label': 'Toggle' }, '▸')
      : h('span.tn-caret.tn-leaf');
    row.append(caret);
    if (key !== null) {
      row.append(h('span.tn-key', {}, typeof key === 'number' ? String(key) : JSON.stringify(key)), h('span.tn-colon', {}, ':'));
    }
    if (container) {
      row.append(h('span.tn-summary', {}, summary(value)));
    } else {
      const lit = literal(value);
      row.append(h(`span.tn-val.${lit.cls || 'plain'}`, {}, lit.text));
    }
    // Hover actions.
    const copyVal = h('button.tn-act', { type: 'button', title: 'Copy value (c)' }, 'copy');
    copyVal.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.copy(container ? JSON.stringify(value, null, 2) : typeof value === 'string' ? value : JSON.stringify(value), 'value');
    });
    const copyPath = h('button.tn-act', { type: 'button', title: 'Copy path (p)' }, 'path');
    copyPath.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.copy(formatPath(segs, style), 'path');
    });
    row.append(h('span.tn-actions', {}, copyVal, copyPath));
    wrap.append(row);

    let kids: HTMLElement | null = null;
    let expanded = false;
    const setExpanded = (on: boolean): void => {
      if (!container) return;
      expanded = on;
      caret.textContent = on ? '▾' : '▸';
      wrap.setAttribute('aria-expanded', String(on));
      if (on && !kids) {
        kids = h('div.tn-kids', { role: 'group' });
        renderChildren(kids, value, segs, depth + 1, 0);
        wrap.append(kids);
      } else if (kids) {
        kids.hidden = !on;
      }
    };
    (wrap as HTMLElement & { _setExpanded?: (on: boolean) => void })._setExpanded = setExpanded;

    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      setExpanded(!expanded);
    });
    row.addEventListener('click', () => select(row, segs));
    row.addEventListener('dblclick', () => setExpanded(!expanded));
    row.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowRight': setExpanded(true); break;
        case 'ArrowLeft': setExpanded(false); break;
        case 'Enter': case ' ': select(row, segs); break;
        case 'c': copyVal.click(); break;
        case 'p': copyPath.click(); break;
        case 'ArrowDown': case 'ArrowUp': {
          const rows = Array.from(tree.querySelectorAll<HTMLElement>('.tn-row')).filter((r) => r.offsetParent !== null);
          const i = rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1);
          rows[i]?.focus();
          break;
        }
        default: return;
      }
      e.preventDefault();
    });

    if (container && depth < DEFAULT_DEPTH) setExpanded(true);
    return wrap;
  };

  /** Append children [from, from+CHUNK) and a "show more" row if needed. */
  const renderChildren = (into: HTMLElement, value: object, segs: Segs, depth: number, from: number): void => {
    const entries = childEntries(value);
    const to = Math.min(entries.length, from + CHUNK);
    for (let i = from; i < to; i++) {
      const [k, v] = entries[i]!;
      into.append(buildNode(k, v, [...segs, k], depth));
    }
    if (to < entries.length) {
      const more = h('button.tn-more', { type: 'button' }, `Show ${Math.min(CHUNK, entries.length - to)} more (${entries.length - to} hidden)`);
      more.style.marginLeft = `${8 + depth * 16}px`;
      more.addEventListener('click', () => {
        more.remove();
        renderChildren(into, value, segs, depth, to);
      });
      into.append(more);
    }
  };

  tree.append(buildNode(null, data.value, [], 0));

  const setAll = (on: boolean): void => {
    let count = 0;
    const walk = (el: Element): void => {
      const w = el as HTMLElement & { _setExpanded?: (on: boolean) => void };
      if (w._setExpanded) {
        if (on && ++count > EXPAND_ALL_CAP) return;
        w._setExpanded(on);
      }
      for (const c of Array.from(el.children)) walk(c);
    };
    walk(tree);
    if (on && count > EXPAND_ALL_CAP) ctx.toast(`Expanded the first ${EXPAND_ALL_CAP} nodes — expand deeper branches individually`);
  };
  expandAll.addEventListener('click', () => setAll(true));
  collapseAll.addEventListener('click', () => {
    setAll(false);
    (tree.firstElementChild as HTMLElement & { _setExpanded?: (on: boolean) => void })._setExpanded?.(true);
  });

  /** Expand ancestors of `segs`, then select its row. */
  const reveal = (segs: Segs): void => {
    for (let i = 0; i < segs.length; i++) {
      const row = rowByKey.get(pathKey(segs.slice(0, i)));
      (row?.parentElement as (HTMLElement & { _setExpanded?: (on: boolean) => void }) | null)?._setExpanded?.(true);
      // Paged children: keep clicking "show more" until the wanted row exists.
      let guard = 0;
      while (!rowByKey.get(pathKey(segs.slice(0, i + 1))) && guard++ < 50) {
        const more = row?.parentElement?.querySelector<HTMLButtonElement>(':scope > .tn-kids > .tn-more');
        if (!more) break;
        more.click();
      }
    }
    const target = rowByKey.get(pathKey(segs));
    if (target) {
      select(target, segs, true);
      target.focus();
    }
  };

  /* --------------------------------------------------------- path mode */
  let results: HTMLElement | null = null;
  if (pathMode) {
    const p = data.path!;
    results = h('div.path-results');
    if (p.queryError) {
      results.append(h('div.path-error', {}, p.queryError));
    } else if (p.query.trim()) {
      results.append(h('div.path-count', {}, `${p.matches.length} match${p.matches.length === 1 ? '' : 'es'} for `, h('code', {}, p.query)));
      const list = h('div.path-list');
      const shown = p.matches.slice(0, 500);
      for (const m of shown) {
        const lit = isContainer(m.value) ? { text: summary(m.value), cls: 'summary' } : literal(m.value);
        const item = h('button.path-item', { type: 'button' }, h('code', {}, formatPath(m.path, style)), h(`span.tn-val.${lit.cls || 'plain'}`, {}, lit.text));
        item.addEventListener('click', () => reveal(m.path));
        list.append(item);
      }
      if (p.matches.length > shown.length) list.append(h('div.path-count', {}, `… ${p.matches.length - shown.length} more not listed`));
      results.append(list);
    } else {
      results.append(h('div.path-count', {}, 'Click any node to see its path. Type a JSONPath query above, e.g. ', h('code', {}, '$..name'), ' or ', h('code', {}, '$.items[?(@.price > 10)]')));
    }
  }

  host.append(toolbar);
  if (pathBar) host.append(pathBar);
  if (results) host.append(results);
  host.append(tree);

  // Restore the previously selected node (survives re-runs while typing).
  const remembered = (pathMode ? data.path!.selected : undefined) ?? (ctx.options['selectedPath'] as Segs | undefined);
  if (remembered && getAt(data.value, remembered) !== undefined) {
    const row = rowByKey.get(pathKey(remembered));
    if (row) {
      selectedRow = row;
      row.classList.add('is-selected');
      if (pathText) pathText.textContent = formatPath(remembered, style);
    }
  }
};
