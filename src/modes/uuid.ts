/**
 * UUID / ULID / Random mode. Empty input → generate `count` ids of `kind`.
 * Non-empty input → find and decode every UUID / ULID in it (version,
 * variant, embedded timestamp). Time-bearing generators read
 * ctx.options.now (ms) when present so tests are deterministic.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { uuidV4, uuidV7, ulid, nanoid, randomHex, randomBase64, password, decodeUuid, decodeUlid, findIds, type IdInfo } from '../lib/uuid.js';

export type IdKind = 'uuid-v4' | 'uuid-v7' | 'ulid' | 'nanoid' | 'random-hex' | 'random-base64' | 'password';
const KINDS: IdKind[] = ['uuid-v4', 'uuid-v7', 'ulid', 'nanoid', 'random-hex', 'random-base64', 'password'];

export interface UuidData {
  ids: IdInfo[];
}

export function generateIds(kind: IdKind, count: number, opts: { now: number; length: number; symbols: boolean; uppercase: boolean; hyphens: boolean }): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let id: string;
    switch (kind) {
      case 'uuid-v4': id = uuidV4(); break;
      case 'uuid-v7': id = uuidV7(opts.now); break;
      case 'ulid': id = ulid(opts.now); break;
      case 'nanoid': id = nanoid(21); break;
      case 'random-hex': id = randomHex(opts.length); break;
      case 'random-base64': id = randomBase64(opts.length); break;
      case 'password': id = password(opts.length, opts.symbols); break;
    }
    if ((kind === 'uuid-v4' || kind === 'uuid-v7') && !opts.hyphens) id = id.replace(/-/g, '');
    if (opts.uppercase && (kind === 'uuid-v4' || kind === 'uuid-v7' || kind === 'random-hex')) id = id.toUpperCase();
    out.push(id);
  }
  return out;
}

export function runUuid(input: string, ctx: RunContext): ModeResult {
  const kindOpt = ctx.options['kind'];
  const kind: IdKind = KINDS.includes(kindOpt as IdKind) ? (kindOpt as IdKind) : 'uuid-v4';
  const countN = Number(ctx.options['count']);
  const count = [1, 5, 10, 25, 100].includes(countN) ? countN : 5;
  const lengthN = Number(ctx.options['length']);
  const length = [8, 16, 24, 32, 64].includes(lengthN) ? lengthN : 16;
  const symbols = ctx.options['symbols'] !== false;
  const uppercase = ctx.options['uppercase'] === true;
  const hyphens = ctx.options['hyphens'] !== false;
  const now = typeof ctx.options['now'] === 'number' && Number.isFinite(ctx.options['now']) ? (ctx.options['now'] as number) : Date.now();

  if (input.trim() === '') {
    const ids = generateIds(kind, count, { now, length, symbols, uppercase, hyphens });
    return {
      output: ids.join('\n'),
      notes: ['Generated locally — paste an id to decode it instead.'],
      status: `Generated ${count} × ${kind}${kind === 'random-hex' || kind === 'random-base64' ? ` · ${length} bytes` : kind === 'password' ? ` · ${length} chars` : ''}`,
    };
  }

  const found = findIds(input);
  if (found.length === 0) {
    return {
      output: '',
      error: { message: 'No UUID or ULID found in the input.', hint: 'Paste ids like 550e8400-e29b-41d4-a716-446655440000 or 01ARZ3NDEKTSV4RRFFQ69G5FAV — or clear the input to generate new ones.' },
      status: 'Nothing to decode',
    };
  }
  const ids = found.map((f) => (f.kind === 'uuid' ? decodeUuid(f.id) : decodeUlid(f.id)));
  const output = ids
    .map((i) => {
      const head = `${i.id}  (${i.kind.toUpperCase()}${i.valid ? '' : ' — invalid'})`;
      const lines = i.fields.map((f) => `  ${f.label.padEnd(15)} ${f.value}`);
      const warns = i.warnings.map((w) => `  ! ${w}`);
      return [head, ...lines, ...warns].join('\n');
    })
    .join('\n\n');
  const invalid = ids.filter((i) => !i.valid).length;
  return {
    output,
    view: { kind: 'uuid', data: { ids } satisfies UuidData },
    status: `Decoded ${ids.length} id${ids.length === 1 ? '' : 's'}${invalid ? ` · ${invalid} invalid` : ''}`,
  };
}

export const uuidMode: ToolMode = {
  id: 'uuid',
  label: 'UUID / ULID / Random',
  description: 'Generate UUID v4/v7, ULID, nanoid, random bytes and passwords — or decode ids you paste.',
  category: 'Crypto & IDs',
  icon: 'fingerprint',
  keywords: ['uuid', 'guid', 'ulid', 'nanoid', 'random', 'password', 'generate', 'id'],
  emptyHint: 'Leave empty to generate ids with the options above, or paste UUIDs / ULIDs to decode them.',
  sample: '550e8400-e29b-41d4-a716-446655440000\n6ba7b810-9dad-11d1-80b4-00c04fd430c8\n01ARZ3NDEKTSV4RRFFQ69G5FAV',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'kind',
      label: 'Kind',
      default: 'uuid-v4',
      options: [
        { value: 'uuid-v4', label: 'UUID v4' },
        { value: 'uuid-v7', label: 'UUID v7' },
        { value: 'ulid', label: 'ULID' },
        { value: 'nanoid', label: 'nanoid' },
        { value: 'random-hex', label: 'Random hex' },
        { value: 'random-base64', label: 'Random base64' },
        { value: 'password', label: 'Password' },
      ],
    },
    {
      kind: 'select',
      key: 'count',
      label: 'Count',
      default: '5',
      options: [
        { value: '1', label: '1' },
        { value: '5', label: '5' },
        { value: '10', label: '10' },
        { value: '25', label: '25' },
        { value: '100', label: '100' },
      ],
    },
    {
      kind: 'select',
      key: 'length',
      label: 'Length',
      default: '16',
      options: [
        { value: '8', label: '8' },
        { value: '16', label: '16' },
        { value: '24', label: '24' },
        { value: '32', label: '32' },
        { value: '64', label: '64' },
      ],
    },
    { kind: 'toggle', key: 'symbols', label: 'Symbols', default: true },
    { kind: 'toggle', key: 'uppercase', label: 'Uppercase', default: false },
    { kind: 'toggle', key: 'hyphens', label: 'Hyphens', default: true },
  ],
  run: runUuid,
};
