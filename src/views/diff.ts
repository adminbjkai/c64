/**
 * Diff renderer. Line mode: side-by-side two-column table (with a bar
 * button to switch to a single-column inline listing). Word/char mode: one
 * block of inline spans, insertions/deletions highlighted.
 */

import { h } from '../ui.js';
import type { DiffData } from '../modes/diff.js';
import type { DiffOp } from '../lib/diff.js';
import type { ViewRenderer } from './types.js';
import { viewShell, dataTable, badge, muted, plural, type Row } from './ui.js';

const CLS: Record<DiffOp['type'], string> = { equal: 'diff-eq', insert: 'diff-add', delete: 'diff-del' };

function inlineSpans(ops: DiffOp[]): HTMLElement {
  const pre = h('pre.diff-inline');
  for (const op of ops) pre.append(op.type === 'equal' ? document.createTextNode(op.value) : h(`span.${CLS[op.type]}`, {}, op.value));
  return pre;
}

/** Pair deletions with following insertions so changed lines sit on the same row. */
function sideBySide(ops: DiffOp[]): HTMLElement {
  const rows: Row[] = [];
  let ln = 0;
  let rn = 0;
  const row = (l: string | null, r: string | null, lc: string, rc: string) => {
    if (l !== null) ln++;
    if (r !== null) rn++;
    rows.push({ ln: { text: l === null ? '' : String(ln), copy: false }, l: { text: l ?? '', cls: lc }, rn: { text: r === null ? '' : String(rn), copy: false }, r: { text: r ?? '', cls: rc } });
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
  return dataTable(
    [
      { key: 'ln', label: '#', cls: 'v-num' },
      { key: 'l', label: 'Before', mono: true, wrap: true },
      { key: 'rn', label: '#', cls: 'v-num' },
      { key: 'r', label: 'After', mono: true, wrap: true },
    ],
    rows,
    { copy: false, cls: 'diff-table' },
  );
}

function inlineLines(ops: DiffOp[]): HTMLElement {
  const rows: Row[] = [];
  let ln = 0;
  let rn = 0;
  for (const op of ops) {
    if (op.type !== 'insert') ln++;
    if (op.type !== 'delete') rn++;
    rows.push({
      ln: op.type === 'insert' ? '' : String(ln),
      rn: op.type === 'delete' ? '' : String(rn),
      sign: op.type === 'insert' ? '+' : op.type === 'delete' ? '−' : ' ',
      text: op.value,
    });
  }
  return dataTable(
    [
      { key: 'ln', label: '#', cls: 'v-num' },
      { key: 'rn', label: '#', cls: 'v-num' },
      { key: 'sign', label: '', cls: 'diff-sign' },
      { key: 'text', label: 'Line', mono: true, wrap: true },
    ],
    rows,
    { copy: false, cls: 'diff-table', header: false, rowClass: (_r, i) => CLS[ops[i]!.type] },
  );
}

export const renderDiff: ViewRenderer = (host, raw) => {
  const d = raw as DiffData;
  const status = [badge('ok', `+${d.stats.added.toLocaleString('en-US')}`), badge('danger', `−${d.stats.removed.toLocaleString('en-US')}`), muted(plural(d.stats.equal, 'line equal', 'lines equal'))];
  if (d.granularity !== 'line') {
    const { body } = viewShell(host, { status, flush: true });
    body.append(inlineSpans(d.ops));
    return;
  }
  let inline = false;
  const toggle = h('button.btn.small', { type: 'button' }, 'Inline');
  const { body } = viewShell(host, { status, actions: [toggle], flush: true });
  const draw = () => {
    body.replaceChildren(inline ? inlineLines(d.ops) : sideBySide(d.ops));
    toggle.textContent = inline ? 'Side by side' : 'Inline';
  };
  toggle.addEventListener('click', () => {
    inline = !inline;
    draw();
  });
  draw();
};
