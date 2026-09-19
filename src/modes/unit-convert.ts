/**
 * Unit Converter mode: one quantity per line (`12 km`, `3.5 GiB`, `72 °F`),
 * converted to every unit of its category or to a single target unit.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseQuantity, findUnit, unitsOf, convert, formatNumber, closestUnits, UnitError, UNIT_CATEGORIES, type UnitCategory } from '../lib/units.js';

export interface UnitsRow {
  symbol: string;
  name: string;
  value: string;
  /** True for the input's own unit. */
  self: boolean;
}

export interface UnitsEntry {
  line: number;
  input: string;
  category: UnitCategory;
  rows: UnitsRow[];
}

export interface UnitsData {
  entries: UnitsEntry[];
}

function precisionOption(v: unknown): number {
  return v === '3' || v === 3 ? 3 : v === '10' || v === 10 ? 10 : 6;
}

export function runUnitConvert(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const sig = precisionOption(ctx.options['precision']);
  const target = typeof ctx.options['target'] === 'string' ? ctx.options['target'].trim() : '';
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  const entries: UnitsEntry[] = [];
  const seen = new Set<UnitCategory>();

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    if (text.trim() === '') {
      out.push('');
      continue;
    }
    try {
      const q = parseQuantity(text, i + 1);
      const { category, unit } = q.match;
      seen.add(category);
      const shown = `${formatNumber(q.value, sig)} ${unit.symbol}`;
      let rows: UnitsRow[];
      if (target !== '') {
        const t = findUnit(target, category);
        if (!t) {
          const others = findUnit(target);
          const hint = others
            ? `"${target}" is a ${others.category} unit but line ${i + 1} is ${category}. Clear the target or use one of: ${unitsOf(category).map((x) => x.symbol).join(', ')}.`
            : `Closest known units: ${closestUnits(target).join(', ')}.`;
          throw new UnitError(`Unknown target unit "${target}"`, i + 1, 1, hint);
        }
        rows = [{ symbol: t.unit.symbol, name: t.unit.name, value: formatNumber(convert(q.value, q.match, t.unit), sig), self: t.unit === unit }];
      } else {
        rows = unitsOf(category).map((u) => ({ symbol: u.symbol, name: u.name, value: formatNumber(convert(q.value, q.match, u), sig), self: u === unit }));
      }
      const parts = rows.filter((r) => !r.self || target !== '').map((r) => `${r.value} ${r.symbol}`);
      out.push(`${shown} = ${parts.join(' = ')}`);
      entries.push({ line: i + 1, input: shown, category, rows });
    } catch (e) {
      const err = e instanceof UnitError ? e : new UnitError(String((e as Error).message ?? e), i + 1, 1, '');
      return {
        output: out.join('\n'),
        error: { message: err.message, line: err.line, col: err.col, hint: err.hint || undefined },
        status: `Invalid quantity · line ${err.line}`,
      };
    }
  }

  const n = entries.length;
  const cats = [...seen].join(', ');
  const data: UnitsData = { entries };
  return {
    output: out.join('\n'),
    status: `${n} quantit${n === 1 ? 'y' : 'ies'} · ${cats}${target ? ` · to ${target}` : ''} · ${sig} sig. digits`,
    view: { kind: 'units', data },
  };
}

export const unitConvertMode: ToolMode = {
  id: 'unit-convert',
  label: 'Unit Converter',
  description: `Convert quantities between units of ${UNIT_CATEGORIES.length} categories — length, mass, temperature, data, speed and more.`,
  category: 'Developer',
  icon: 'units',
  keywords: ['units', 'convert', 'metric', 'imperial', 'celsius', 'fahrenheit', 'bytes', 'gib', 'miles', 'km', 'kg', 'lb', 'psi', 'measurement'],
  emptyHint: 'One quantity per line, e.g. `12 km`, `3.5 GiB`, `72 °F`, `90 mph` — every unit in its category is listed.',
  sample: '12 km\n3.5 GiB\n72 °F\n90 mph\n1e6 ms\n2 acres\n180 lb\n2.4 GHz',
  supportsPretty: false,
  controls: [
    { kind: 'text', key: 'target', label: 'To', placeholder: 'all (or a unit, e.g. mi)', default: '' },
    {
      kind: 'select',
      key: 'precision',
      label: 'Precision',
      default: '6',
      options: [
        { value: '3', label: '3 digits' },
        { value: '6', label: '6 digits' },
        { value: '10', label: '10 digits' },
      ],
    },
  ],
  run: runUnitConvert,
};
