/**
 * Timestamp renderer: one card per input line with labelled, copyable rows.
 */

import { h } from '../ui.js';
import type { TimestampData } from '../modes/timestamp.js';
import type { ViewRenderer } from './types.js';
import { viewShell, cardList, kvTable, badge } from './ui.js';

export const renderTimestamp: ViewRenderer = (host, raw) => {
  const d = raw as TimestampData;
  const { body } = viewShell(host);
  body.append(
    cardList(
      d.cards.map((c) => ({
        title: h('code', {}, c.input),
        meta: [badge('neutral', c.kind)],
        body: kvTable(c.rows.map((r) => ({ label: r.label, value: r.value }))),
      })),
    ),
  );
};
