/**
 * chmod renderer: per input line a card with the octal / symbolic / command
 * values (copy buttons) and a 3×3 read-only checkbox grid plus special bits.
 * The pane input is the source of truth, so the grid is display-only.
 */

import { h } from '../ui.js';
import type { ChmodData, ChmodEntry } from '../modes/chmod.js';
import type { ViewRenderer, ViewContext } from './types.js';

export const renderChmod: ViewRenderer = (host, raw, ctx) => {
  const d = raw as ChmodData;
  for (const e of d.entries) host.append(renderEntry(e, ctx));
};

function box(on: boolean, label: string): HTMLElement {
  return h('td.chmod-cell', {}, h('input', { type: 'checkbox', checked: on, disabled: true, 'aria-label': label, tabindex: -1 }));
}

function renderEntry(e: ChmodEntry, ctx: ViewContext): HTMLElement {
  const valueRow = (label: string, value: string): HTMLElement => {
    const copy = h('button.btn.small', { type: 'button' }, 'Copy');
    copy.addEventListener('click', () => ctx.copy(value, label));
    return h('tr', {}, h('td.chmod-label', {}, label), h('td.chmod-value', {}, h('code', {}, value)), h('td.chmod-actions', {}, copy));
  };
  const values = h('table.csv-table.chmod-table', {}, h('tbody', {}, valueRow('octal', e.octal3), valueRow('octal (4 digits)', e.octal4), valueRow('symbolic', e.symbolic), valueRow('command', e.command)));

  const grid = h(
    'table.chmod-grid',
    {},
    h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'read'), h('th', {}, 'write'), h('th', {}, 'execute'))),
    h(
      'tbody',
      {},
      ...(['owner', 'group', 'others'] as const).map((who) => h('tr', {}, h('th.chmod-who', {}, who), box(e[who].r, `${who} read`), box(e[who].w, `${who} write`), box(e[who].x, `${who} execute`))),
    ),
  );
  const special = h(
    'div.chmod-special',
    {},
    h('span.muted', {}, 'special: '),
    h(`span.badge${e.setuid ? '.warn' : ''}`, {}, `setuid ${e.setuid ? 'on' : 'off'}`),
    ' ',
    h(`span.badge${e.setgid ? '.warn' : ''}`, {}, `setgid ${e.setgid ? 'on' : 'off'}`),
    ' ',
    h(`span.badge${e.sticky ? '.warn' : ''}`, {}, `sticky ${e.sticky ? 'on' : 'off'}`),
  );

  return h(
    'section.chmod-card',
    {},
    h('header.chmod-head', {}, h('code.chmod-input', {}, e.input), h('span.badge', {}, e.form), e.fileType ? h('span.badge', {}, e.fileType === 'd' ? 'directory' : e.fileType === 'l' ? 'symlink' : `type ${e.fileType}`) : null, h('span.muted', {}, ` line ${e.line}`)),
    e.note ? h('div.chmod-note.muted', {}, e.note) : null,
    h('div.chmod-body', {}, h('div.table-wrap', {}, values), h('div.chmod-grid-wrap', {}, grid, special)),
  );
}
