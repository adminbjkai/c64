/**
 * chmod renderer: per input line a card with the octal / symbolic / command
 * values and a 3×3 read-only checkbox grid plus special bits. The pane input
 * is the source of truth, so the grid is display-only.
 */

import { h } from '../ui.js';
import type { ChmodData, ChmodEntry } from '../modes/chmod.js';
import type { ViewRenderer } from './types.js';
import { viewShell, cardList, kvTable, badge, muted, note, type Card } from './ui.js';

export const renderChmod: ViewRenderer = (host, raw) => {
  const d = raw as ChmodData;
  const { body } = viewShell(host);
  body.append(cardList(d.entries.map(card)));
};

function box(on: boolean, label: string): HTMLElement {
  return h('td.chmod-cell', {}, h('input', { type: 'checkbox', checked: on, disabled: true, 'aria-label': label, tabindex: -1 }));
}

function card(e: ChmodEntry): Card {
  const values = kvTable([
    { label: 'Octal', value: e.octal3 },
    { label: 'Octal, 4 digits', value: e.octal4 },
    { label: 'Symbolic', value: e.symbolic },
    { label: 'Command', value: e.command },
  ]);
  const grid = h(
    'table.chmod-grid',
    {},
    h('thead', {}, h('tr', {}, h('th'), h('th', {}, 'Read'), h('th', {}, 'Write'), h('th', {}, 'Execute'))),
    h(
      'tbody',
      {},
      ...(['owner', 'group', 'others'] as const).map((who) => h('tr', {}, h('th.chmod-who', {}, who), box(e[who].r, `${who} read`), box(e[who].w, `${who} write`), box(e[who].x, `${who} execute`))),
    ),
  );
  const special = h(
    'div.chmod-special',
    {},
    badge(e.setuid ? 'warn' : 'neutral', `setuid ${e.setuid ? 'on' : 'off'}`),
    badge(e.setgid ? 'warn' : 'neutral', `setgid ${e.setgid ? 'on' : 'off'}`),
    badge(e.sticky ? 'warn' : 'neutral', `sticky ${e.sticky ? 'on' : 'off'}`),
  );
  const type = e.fileType ? (e.fileType === 'd' ? 'directory' : e.fileType === 'l' ? 'symlink' : `type ${e.fileType}`) : null;
  return {
    title: h('code', {}, e.input),
    meta: [badge('neutral', e.form), type ? badge('neutral', type) : null, muted(`line ${e.line}`)],
    body: [e.note ? note('neutral', e.note) : null, h('div.chmod-body', {}, values, h('div.chmod-grid-wrap', {}, grid, special))],
  };
}
