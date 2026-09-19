/**
 * UUID / ULID renderer: one card per decoded id with a validity badge,
 * copyable field rows and any warnings as notes.
 */

import { h } from '../ui.js';
import type { UuidData } from '../modes/uuid.js';
import type { ViewRenderer } from './types.js';
import { viewShell, cardList, kvTable, badge, note, copyButton, type KvRow, type Tone } from './ui.js';

export const renderUuid: ViewRenderer = (host, raw) => {
  const d = raw as UuidData;
  const { body } = viewShell(host);
  body.append(
    cardList(
      d.ids.map((i) => {
        const [tone, text]: [Tone, string] = i.valid ? (i.warnings.length ? ['warn', 'Valid with warnings'] : ['ok', 'Valid']) : ['danger', 'Invalid'];
        const rows: KvRow[] = i.fields.map((f) => ({ label: f.label, value: f.value }));
        if (i.timestamp) rows.unshift({ label: 'Embedded time', value: i.timestamp });
        return {
          title: h('code', {}, i.id),
          meta: [badge(tone, text), badge('neutral', i.kind.toUpperCase() + (i.version !== undefined ? ` v${i.version}` : ''))],
          actions: [copyButton('Copy id', () => i.id)],
          body: [rows.length ? kvTable(rows) : null, ...i.warnings.map((w) => note('warn', w))],
        };
      }),
    ),
  );
};
