/**
 * Diff renderer. Line mode: side-by-side two-column table (with a header
 * button to switch to a single-column inline listing). Word/char mode: one
 * block of inline spans, insertions/deletions highlighted.
 */

import { h } from '../ui.js';
import type { DiffData } from '../modes/diff.js';
import type { DiffOp } from '../lib/diff.js';
import type { ViewRenderer } from './types.js';

const CLS: Record<DiffOp['type'], string> = { equal: 'diff-eq', insert: 'diff-add', delete: 'diff-del' };

function inlineSpans(ops: DiffOp[]): HTMLElement {
  const pre = h('pre.diff-inline');
  for (const op of ops) pre.append(op.type === 'equal' ? document.createTextNode(op.value) : h(`span.${CLS[op.type]}`, {}, op.value));
  return pre;
}

/** Pair deletions with following insertions so changed lines sit on the same row. */
function sideBySide(ops: DiffOp[]): HTMLElement {
  const table = h('table.csv-table.diff-table');
  table.append(h('thead', {}, h('tr', {}, h('th.rownum', {}, '#'), h('th', {}, 'Before'), h('th.rownum', {}, '#'), h('th', {}, 'After'))));
  const body = h('tbody');
  let ln = 0;
  let rn = 0;
  const row = (l: string | null, r: string | null, lc: string, rc: string) => {
    if (l !== null) ln++;
    if (r !== null) rn++;
    body.append(
      h('tr', {}, h('td.rownum', {}, l === null ? '' : String(ln)), h(`td.${lc}`, {}, l ?? ''), h('td.rownum', {}, r === null ? '' : String(rn)), h(`td.${rc}`, {}, r ?? '')),
    );
  };
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.type === 'equal') {
      row(op.value, op.value, 'diff-eq', 'diff-eq');
      i++;
      continue;
    }
    const dels: string[] = [];
    const ins: string[] = [];
    while (i < ops.length && ops[i]!.type === 'delete') dels.push(ops[i++]!.value);
    while (i < ops.length && ops[i]!.type === 'insert') ins.push(ops[i++]!.value);
    const n = Math.max(dels.length, ins.length);
    for (let k = 0; k < n; k++) {
      const l = k < dels.length ? dels[k]! : null;
      const r = k < ins.length ? ins[k]! : null;
      row(l, r, l === null ? 'diff-empty' : 'diff-del', r === null ? 'diff-empty' : 'diff-add');
    }
  }
  table.append(body);
  return h('div.table-wrap', {}, table);
}

function inlineLines(ops: DiffOp[]): HTMLElement {
  const table = h('table.csv-table.diff-table.diff-table-inline');
  const body = h('tbody');
  let ln = 0;
  let rn = 0;
  for (const op of ops) {
    if (op.type !== 'insert') ln++;
    if (op.type !== 'delete') rn++;
    body.append(
      h(
        `tr.${CLS[op.type]}`,
        {},
        h('td.rownum', {}, op.type === 'insert' ? '' : String(ln)),
        h('td.rownum', {}, op.type === 'delete' ? '' : String(rn)),
        h('td.diff-sign', {}, op.type === 'insert' ? '+' : op.type === 'delete' ? '−' : ' '),
        h(`td.${CLS[op.type]}`, {}, op.value),
      ),
    );
  }
  table.append(body);
  return h('div.table-wrap', {}, table);
}

export const renderDiff: ViewRenderer = (host, raw) => {
  const d = raw as DiffData;
  const summary = h(
    'span.muted',
    {},
    h('span.badge.ok', {}, `+${d.stats.added}`),
    ' ',
    h('span.badge.bad', {}, `−${d.stats.removed}`),
    ` · ${d.stats.equal} equal`,
  );
  if (d.granularity !== 'line') {
    host.append(h('div.diff-head', {}, summary), inlineSpans(d.ops));
    return;
  }
  let inline = false;
  const body = h('div.diff-body');
  const toggle = h('button.btn.small', { type: 'button' }, 'Inline view');
  const draw = () => {
    body.replaceChildren(inline ? inlineLines(d.ops) : sideBySide(d.ops));
    toggle.textContent = inline ? 'Side by side' : 'Inline view';
  };
  toggle.addEventListener('click', () => {
    inline = !inline;
    draw();
  });
  draw();
  host.append(h('div.diff-head', {}, summary, toggle), body);
};
