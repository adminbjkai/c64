/**
 * URL Encode / Decode mode: percent-encode or decode text as a URI component,
 * a whole URI, or a form field (x-www-form-urlencoded). When the result is a
 * full URL it is also broken down into parts (url view).
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { percentEncode, percentDecode, looksPercentEncoded, PercentError, type PercentFlavour } from '../lib/percent.js';

export interface UrlData {
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  username: string;
  password: string;
  params: [string, string][];
}

const FULL_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Break a full URL into its parts, or null when `text` is not one. */
export function urlBreakdown(text: string): UrlData | null {
  const t = text.trim();
  if (!FULL_URL.test(t)) return null;
  try {
    const u = new URL(t);
    return {
      href: u.href,
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      origin: u.origin,
      username: u.username,
      password: u.password,
      params: Array.from(u.searchParams.entries()),
    };
  } catch {
    return null;
  }
}

function flavourOption(v: unknown): PercentFlavour {
  return v === 'uri' || v === 'form' ? v : 'component';
}

export function runUrl(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const flavour = flavourOption(ctx.options['component']);
  const dirOpt = ctx.options['direction'];
  const direction = dirOpt === 'encode' || dirOpt === 'decode' ? dirOpt : looksPercentEncoded(input, flavour) ? 'decode' : 'encode';

  let output: string;
  if (direction === 'encode') {
    output = percentEncode(input, flavour);
  } else {
    try {
      output = percentDecode(input, flavour);
    } catch (e) {
      if (e instanceof PercentError) {
        const before = input.slice(0, e.offset);
        const line = before.split('\n').length;
        const col = e.offset - before.lastIndexOf('\n');
        return { output: '', error: { message: e.message, line, col, hint: e.hint }, status: `Invalid percent-encoding · line ${line}, col ${col}` };
      }
      return { output: '', error: { message: String(e) }, status: 'Invalid percent-encoding' };
    }
  }
  const result: ModeResult = {
    output,
    status: `${direction === 'encode' ? 'Encoded' : 'Decoded'} · ${input.length} chars → ${output.length} chars`,
  };
  const data = urlBreakdown(output) ?? urlBreakdown(input);
  if (data) result.view = { kind: 'url', data };
  return result;
}

export const urlMode: ToolMode = {
  id: 'url',
  label: 'URL Encode / Decode',
  description: 'Percent-encode or decode text and break a full URL into its parts.',
  category: 'Web',
  icon: 'link',
  keywords: ['percent', 'urlencode', 'urldecode', 'uri', 'encodeURIComponent', 'query'],
  emptyHint: 'Paste text to encode or a percent-encoded string / URL to decode (auto-detected).',
  sample: 'https://example.com/search?q=caf%C3%A9%20au%20lait&lang=en&page=2#results',
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
      key: 'component',
      label: 'Mode',
      default: 'component',
      options: [
        { value: 'component', label: 'Component' },
        { value: 'uri', label: 'Whole URI' },
        { value: 'form', label: 'Form (space → +)' },
      ],
    },
  ],
  run: runUrl,
};
