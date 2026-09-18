/**
 * Base64 mode: text ↔ Base64 (standard or URL-safe), `.txt` upload, byte
 * counts. Direction "auto" decodes when the input looks like Base64 and
 * encodes otherwise. Pretty, when decoding, formats a decoded JSON payload.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { encodeBase64, decodeBase64, looksLikeBase64, Base64Error } from '../lib/base64.js';
import { parseJson } from './json.js';

/** Classic 16-bytes-per-line hex dump: offset · hex · ASCII. */
export function hexDump(data: Uint8Array): string {
  const lines: string[] = [];
  for (let off = 0; off < data.length; off += 16) {
    const chunk = data.subarray(off, off + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0'));
    const left = hex.slice(0, 8).join(' ');
    const right = hex.slice(8).join(' ');
    const ascii = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${left.padEnd(23)}  ${right.padEnd(23)}  |${ascii}|`);
  }
  return lines.join('\n');
}

export function runBase64(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const urlSafe = ctx.options['urlSafe'] === true;
  const dirOpt = ctx.options['direction'];
  const direction = dirOpt === 'encode' || dirOpt === 'decode' ? dirOpt : looksLikeBase64(input) ? 'decode' : 'encode';

  if (direction === 'encode') {
    const output = encodeBase64(input, { urlSafe });
    return {
      output,
      status: `Encoded · ${formatBytes(byteLength(input))} → ${output.length} chars${urlSafe ? ' · URL-safe' : ''}`,
      notes: dirOpt === 'auto' || dirOpt === undefined ? ['Auto: input did not look like Base64, so it was encoded. Pick Decode to force decoding.'] : undefined,
    };
  }

  try {
    const r = decodeBase64(input, { urlSafe });
    const notes: string[] = [];
    let output = r.text;
    let shape = r.printable ? 'text' : 'binary (shown as UTF-8 with replacement characters)';
    if (ctx.pretty && r.printable) {
      const t = r.text.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          output = JSON.stringify(parseJson(t).value, null, 2);
          shape = 'JSON (pretty-printed — switch to Raw for the literal bytes)';
        } catch {
          /* not JSON, keep text */
        }
      }
    }
    if (!r.printable) {
      output = hexDump(r.data);
      shape = 'binary (shown as a hex dump)';
      notes.push('Decoded bytes are not readable text — this is binary data (a hash, key, token or file), so it is shown as a hex dump.');
    }
    return {
      output,
      notes: notes.length ? notes : undefined,
      status: `Decoded · ${input.replace(/\s/g, '').length} chars → ${r.bytes} byte${r.bytes === 1 ? '' : 's'} of ${shape}`,
    };
  } catch (e) {
    if (e instanceof Base64Error) {
      // Map offset → line/col for the error box.
      const before = input.slice(0, e.offset);
      const line = before.split('\n').length;
      const col = e.offset - before.lastIndexOf('\n');
      return { output: '', error: { message: e.message, line, col, hint: e.hint }, status: `Invalid Base64 · line ${line}, col ${col}` };
    }
    return failure('Base64', e);
  }
}

export const base64Mode: ToolMode = {
  id: 'base64',
  label: 'Base64',
  description: 'Encode text to Base64 or decode it back — standard or URL-safe.',
  category: 'Encoding',
  icon: 'base64',
  emptyHint: 'Paste text to encode, or Base64 to decode (auto-detected). Upload a .txt file with the button above.',
  sample: 'eyJzZXJ2aWNlIjoiYXBpIiwidmVyc2lvbiI6MywiaGVhbHRoeSI6dHJ1ZX0=',
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'encode', label: 'Encode' },
        { value: 'decode', label: 'Decode' },
      ],
    },
    { kind: 'toggle', key: 'urlSafe', label: 'URL-safe', default: false },
    { kind: 'file', label: 'Upload .txt', accept: '.txt,text/plain' },
  ],
  run: runBase64,
};
