/**
 * Case renderer: every case variant of the first line in one table, each
 * value copyable.
 */

import { h } from '../ui.js';
import type { CaseAllData } from '../modes/case.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, dataTable } from './ui.js';

export const renderCaseAll: ViewRenderer = (host, raw) => {
  const d = raw as CaseAllData;
  const { body } = viewShell(host);
  body.append(
    section(
      'All variants',
      { meta: h('span', {}, 'of ', h('code', {}, d.source)) },
      dataTable(
        [
          { key: 'name', label: 'Case' },
          { key: 'value', label: 'Value', mono: true, wrap: true },
        ],
        d.variants.map((v) => ({ name: { text: v.name, copy: false }, value: v.value })),
      ),
    ),
  );
};
