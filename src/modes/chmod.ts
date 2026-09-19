/**
 * chmod Calculator mode: one mode per line — octal (`755`, `4755`),
 * ls-style symbolic (`-rw-r--r--`) or an expression applied to a base
 * (`u+x,go-w 644`) — shown as octal, symbolic, a permission grid and a
 * ready-to-run chmod command.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseModeLine, toOctal, toSymbolic, bitsOf, ChmodError, type PermBits } from '../lib/chmod.js';

export interface ChmodEntry {
  line: number;
  input: string;
  form: 'octal' | 'symbolic' | 'expression';
  fileType: string | null;
  octal3: string;
  octal4: string;
  symbolic: string;
  command: string;
  owner: PermBits;
  group: PermBits;
  others: PermBits;
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
  note?: string;
}

export interface ChmodData {
  entries: ChmodEntry[];
}

function entryText(e: ChmodEntry): string {
  const row = (who: string, b: PermBits) => `  ${who.padEnd(7)} ${b.r ? 'r' : '-'} ${b.w ? 'w' : '-'} ${b.x ? 'x' : '-'}`;
  const special = [e.setuid && 'setuid', e.setgid && 'setgid', e.sticky && 'sticky'].filter(Boolean).join(', ') || 'none';
  return [`${e.input} → ${e.octal3} · ${e.octal4} · ${e.symbolic}${e.fileType ? ` (${e.fileType})` : ''}`, row('owner', e.owner), row('group', e.group), row('others', e.others), `  special: ${special}`, `  ${e.command}`].join('\n');
}

export function runChmod(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const target = typeof ctx.options['target'] === 'string' && ctx.options['target'].trim() !== '' ? ctx.options['target'].trim() : 'file';
  const lines = input.split(/\r?\n/);
  const entries: ChmodEntry[] = [];
  const notes: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    if (text.trim() === '' || text.trim().startsWith('#')) continue;
    try {
      const p = parseModeLine(text);
      const b = bitsOf(p.mode);
      const needsFour = p.mode > 0o777;
      const e: ChmodEntry = {
        line: i + 1,
        input: text.trim(),
        form: p.form,
        fileType: p.fileType,
        octal3: toOctal(p.mode, 3),
        octal4: toOctal(p.mode, 4),
        symbolic: toSymbolic(p.mode),
        command: `chmod ${needsFour ? toOctal(p.mode, 4) : toOctal(p.mode, 3)} ${target}`,
        ...b,
      };
      if (p.note) {
        e.note = p.note;
        notes.push(`Line ${i + 1}: ${p.note}`);
      }
      entries.push(e);
    } catch (err) {
      const e = err as ChmodError;
      return {
        output: entries.map(entryText).join('\n\n'),
        error: { message: e.message ?? String(err), line: i + 1, col: text.indexOf(text.trim()) + (e.col ?? 1), hint: e.hint },
        status: `Invalid mode · line ${i + 1}`,
      };
    }
  }
  const data: ChmodData = { entries };
  return {
    output: entries.map(entryText).join('\n\n'),
    status: `${entries.length} mode${entries.length === 1 ? '' : 's'}${entries.length === 1 ? ` · ${entries[0]!.octal4} · ${entries[0]!.symbolic}` : ''}`,
    notes: notes.length ? notes : undefined,
    view: { kind: 'chmod', data },
  };
}

export const chmodMode: ToolMode = {
  id: 'chmod',
  label: 'chmod Calculator',
  description: 'Convert Unix permissions between octal, symbolic and a read/write/execute grid, including setuid, setgid and sticky bits.',
  category: 'Developer',
  icon: 'chmod',
  keywords: ['chmod', 'permissions', 'octal', 'rwx', 'unix', 'linux', 'setuid', 'setgid', 'sticky', 'umask', 'ls -l'],
  emptyHint: 'One mode per line: `755`, `0644`, `4755`, `rwxr-xr-x`, `-rw-r--r--`, or an expression with a base like `u+x,go-w 644`.',
  sample: '755\n0644\n4755\ndrwxr-x---\n-rw-r--r--\nu+x,go-w 644\na=r,u+w 000',
  supportsPretty: false,
  controls: [{ kind: 'text', key: 'target', label: 'File', placeholder: 'file', default: 'file' }],
  run: runChmod,
};
