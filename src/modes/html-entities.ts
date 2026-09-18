/**
 * HTML Entities mode: decode `&amp;` / `&#123;` / `&#x1F600;` references, or
 * encode text with a chosen scope (minimal, named, all non-ASCII as hex).
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { decodeEntities, encodeEntities, looksLikeEntities, type EncodeScope } from '../lib/html-entities.js';

function scopeOption(v: unknown): EncodeScope {
  return v === 'named' || v === 'all-non-ascii' ? v : 'minimal';
}

export function runHtmlEntities(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const dirOpt = ctx.options['direction'];
  const direction = dirOpt === 'encode' || dirOpt === 'decode' ? dirOpt : looksLikeEntities(input) ? 'decode' : 'encode';

  if (direction === 'encode') {
    const scope = scopeOption(ctx.options['scope']);
    const r = encodeEntities(input, scope);
    return { output: r.text, status: `Encoded · ${r.escaped} character${r.escaped === 1 ? '' : 's'} escaped · ${scope}` };
  }

  const r = decodeEntities(input);
  const notes: string[] = [];
  if (r.unknown.length) {
    const list = Array.from(new Set(r.unknown)).slice(0, 5).join(', ');
    notes.push(`Unknown entit${r.unknown.length === 1 ? 'y' : 'ies'} left as-is: ${list}${r.unknown.length > 5 ? ', …' : ''}.`);
  }
  return {
    output: r.text,
    notes: notes.length ? notes : undefined,
    status: `Decoded · ${r.decoded} entit${r.decoded === 1 ? 'y' : 'ies'}`,
  };
}

export const htmlEntitiesMode: ToolMode = {
  id: 'html-entities',
  label: 'HTML Entities',
  description: 'Encode special characters as HTML entities or decode named and numeric references back to text.',
  category: 'Web',
  icon: 'entity',
  keywords: ['html', 'entities', 'escape', 'unescape', 'amp', 'nbsp', 'charref'],
  emptyHint: 'Paste HTML with entities to decode, or plain text to encode (auto-detected).',
  sample: '&lt;p class=&quot;note&quot;&gt;Caf&eacute; &amp; cr&egrave;me &mdash; &copy; 2026 &#x1F600; &#8364;5 &hellip;&lt;/p&gt;',
  supportsPretty: false,
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
    {
      kind: 'select',
      key: 'scope',
      label: 'Encode scope',
      default: 'minimal',
      options: [
        { value: 'minimal', label: 'Minimal (& < > " \')' },
        { value: 'named', label: 'Named entities' },
        { value: 'all-non-ascii', label: 'All non-ASCII (hex)' },
      ],
    },
  ],
  run: runHtmlEntities,
};
