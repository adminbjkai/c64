/**
 * Subnet renderer: a card per parsed item with a label → value grid; IPv4
 * blocks get a "Split into /N" select in the card actions that re-runs the
 * mode with the `split` option and lists the sub-blocks.
 */

import { h } from '../ui.js';
import type { SubnetData, SubnetItem } from '../modes/ip-subnet.js';
import type { ViewRenderer, ViewContext } from './types.js';
import { viewShell, cardList, kvTable, dataTable, section, badge, muted, copyButton, type Card } from './ui.js';

export const renderSubnet: ViewRenderer = (host, raw, ctx) => {
  const d = raw as SubnetData;
  const { body } = viewShell(host);
  body.append(cardList(d.items.map((it) => card(it, ctx))));
};

function card(it: SubnetItem, ctx: ViewContext): Card {
  if (it.kind === 'range') {
    return {
      title: h('code', {}, it.input),
      meta: [badge('neutral', `IPv${it.version} range`), muted(`${it.count} addresses, line ${it.line}`)],
      actions: [copyButton('Copy list', () => it.cidrs.join('\n'))],
      body: dataTable([{ key: 'cidr', label: 'CIDR', mono: true }], it.cidrs.map((c) => ({ cidr: c })), { rowNum: true }),
    };
  }
  const actions: Node[] = [];
  const parts: (Node | null)[] = [kvTable(it.rows.map((r) => ({ label: r.label, value: r.value })))];
  if (it.splitChoices.length) {
    const sel = h<HTMLSelectElement>('select.subnet-split-select', { 'aria-label': 'Split into' });
    const base = Number(it.cidr.split('/')[1]);
    sel.append(h('option', { value: 'none' }, 'No split'));
    for (const n of it.splitChoices) sel.append(h('option', { value: `+${n}` }, `/${base + n} (${2 ** n} blocks)`));
    sel.value = it.splitPrefix === null ? 'none' : `+${it.splitPrefix - base}`;
    sel.addEventListener('change', () => ctx.setOption('split', sel.value));
    actions.push(h('label.v-inline', {}, muted('Split into'), sel));
    if (it.splits.length) {
      parts.push(
        section(
          'Blocks',
          { meta: String(it.splits.length) },
          dataTable(
            [
              { key: 'block', label: 'Block', mono: true },
              { key: 'hosts', label: 'Hosts', mono: true },
            ],
            it.splits.map((s) => ({ block: s.cidr, hosts: `${s.first} to ${s.last}` })),
            { rowNum: true },
          ),
        ),
      );
    }
  }
  return {
    title: h('code', {}, it.cidr),
    meta: [badge('neutral', `IPv${it.version}`), badge('neutral', it.type), muted(`line ${it.line}`)],
    actions,
    body: parts,
  };
}
