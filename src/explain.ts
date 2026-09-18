/**
 * The local "Explain" helper. Looks at a pane's input, works out what it
 * probably is (JWT? Base64-wrapped JSON? minified XML? CSV?), explains the
 * reasoning in plain English and proposes next steps as one-click mode
 * switches. Pure heuristics, runs entirely in this tab — no model, no server.
 */

import { parseJson } from './modes/json.js';
import { decodeBase64, looksLikeBase64 } from './lib/base64.js';
import { parseXml } from './lib/xml.js';
import { parseYaml } from './lib/yaml.js';
import { validateCss } from './lib/css.js';
import { detectDelimiter, parseCsv } from './lib/csv.js';
import { formatBytes, byteLength } from './modes/types.js';

export interface Suggestion {
  label: string;
  /** Mode to switch the pane to, with any options to set. */
  mode: string;
  options?: Record<string, unknown>;
  /** Explains what the suggestion does. */
  note?: string;
}

export interface Explanation {
  /** Short headline, e.g. "Base64-encoded JSON". */
  shape: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  suggestions: Suggestion[];
}

const DELIM_NAME: Record<string, string> = { ',': 'commas', '\t': 'tabs', ';': 'semicolons', '|': 'pipes' };

function stats(text: string): string {
  const lines = text.split('\n').length;
  return `${lines} line${lines === 1 ? '' : 's'}, ${text.length} chars, ${formatBytes(byteLength(text))}`;
}

function tryJson(text: string): { ok: true; value: unknown; notes: string[] } | { ok: false } {
  try {
    const r = parseJson(text);
    return { ok: true, value: r.value, notes: r.notes };
  } catch {
    return { ok: false };
  }
}

function jsonSuggestions(minified: boolean): Suggestion[] {
  return [
    { label: minified ? 'Format it' : 'Validate / reformat', mode: 'json', note: 'Pretty-print with your indent choice; Raw minifies.' },
    { label: 'Explore as tree', mode: 'json-tree' },
    { label: 'Draw as graph', mode: 'json-graph' },
    { label: 'Convert to YAML', mode: 'convert', options: { from: 'json', to: 'yaml' } },
    { label: 'Encode as Base64', mode: 'base64', options: { direction: 'encode' }, note: 'Re-encode the JSON for transport.' },
  ];
}

export function explain(input: string): Explanation {
  const text = input.trim();
  if (!text) {
    return { shape: 'Nothing to look at yet', confidence: 'high', reasons: ['Paste or type something and I will tell you what it looks like.'], suggestions: [] };
  }
  const reasons: string[] = [];

  // ---- JWT: three base64url segments, first decodes to a JSON header.
  const jwt = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/.exec(text);
  if (jwt) {
    try {
      const header = JSON.parse(decodeBase64(jwt[1]!, { urlSafe: true }).text) as Record<string, unknown>;
      if (header && typeof header === 'object' && ('alg' in header || 'typ' in header)) {
        reasons.push('Three dot-separated base64url segments (header.payload.signature).');
        reasons.push(`The first segment decodes to a JSON header with alg=${String(header['alg'] ?? '?')}${header['typ'] ? `, typ=${String(header['typ'])}` : ''}.`);
        reasons.push(jwt[3] ? 'A signature is present, but it cannot be verified here without the issuer\'s key.' : 'The signature segment is empty (unsecured JWT).');
        return {
          shape: 'JSON Web Token (JWT)',
          confidence: 'high',
          reasons,
          suggestions: [{ label: 'Decode the JWT', mode: 'jwt', note: 'Splits header / payload / signature and shows exp / iat as dates.' }],
        };
      }
    } catch {
      /* not a JWT */
    }
  }

  // ---- JSON (native or tolerated).
  const json = tryJson(text);
  if (json.ok && (text.startsWith('{') || text.startsWith('['))) {
    const minified = !text.includes('\n') && text.length > 60;
    const kind = Array.isArray(json.value) ? `JSON array (${(json.value as unknown[]).length} items)` : `JSON object (${Object.keys(json.value as object).length} keys)`;
    reasons.push(`Starts with ${text[0]} and parses as JSON${json.notes.length ? ' after small fixes: ' + json.notes.join(' ') : '.'}`);
    if (minified) reasons.push('No line breaks — this is minified, probably straight from an API response.');
    const flatRecords = Array.isArray(json.value) && (json.value as unknown[]).length > 0 && (json.value as unknown[]).every((r) => r && typeof r === 'object' && !Array.isArray(r) && Object.values(r as object).every((v) => v === null || typeof v !== 'object'));
    const sugg = jsonSuggestions(minified);
    if (flatRecords) {
      reasons.push('Every item is a flat record with primitive values — it would make a clean CSV.');
      sugg.splice(3, 0, { label: 'Convert to CSV', mode: 'convert', options: { from: 'json', to: 'csv' } });
    }
    return { shape: kind + (minified ? ', minified' : ''), confidence: 'high', reasons, suggestions: sugg };
  }

  // ---- Base64 (possibly wrapping something else).
  if (looksLikeBase64(text)) {
    try {
      const urlSafe = /[-_]/.test(text) && !/[+/]/.test(text);
      const decoded = decodeBase64(text, { urlSafe });
      reasons.push(`Only base64${urlSafe ? 'url' : ''} characters${text.replace(/\s/g, '').length % 4 === 0 ? ', length is a multiple of 4' : ''} — decodes to ${decoded.bytes} bytes.`);
      const inner = decoded.text.trim();
      const innerJson = tryJson(inner);
      if (innerJson.ok && (inner.startsWith('{') || inner.startsWith('['))) {
        reasons.push('The decoded bytes are valid JSON.');
        return {
          shape: 'Base64-encoded JSON',
          confidence: 'high',
          reasons,
          suggestions: [
            { label: 'Decode it (Pretty shows the JSON formatted)', mode: 'base64', options: { direction: 'decode', urlSafe }, note: 'Then Copy, Add Right and drop it into a JSON Tree pane to explore.' },
          ],
        };
      }
      if (decoded.printable) {
        reasons.push('The decoded bytes are readable UTF-8 text.');
        return { shape: 'Base64-encoded text', confidence: 'medium', reasons, suggestions: [{ label: 'Decode it', mode: 'base64', options: { direction: 'decode', urlSafe } }] };
      }
      reasons.push('The decoded bytes are not readable text — likely binary (an image, a key, a hash).');
      return { shape: 'Base64-encoded binary', confidence: 'medium', reasons, suggestions: [{ label: 'Decode to see byte count', mode: 'base64', options: { direction: 'decode', urlSafe } }] };
    } catch {
      /* fall through */
    }
  }

  // ---- XML / HTML.
  if (text.startsWith('<')) {
    const html = /^<!doctype html/i.test(text) || /^<html/i.test(text);
    try {
      parseXml(text);
      reasons.push('Starts with < and is well-formed XML.');
      if (!text.includes('\n')) reasons.push('No line breaks — minified.');
      return {
        shape: html ? 'HTML (parses as XML)' : 'XML',
        confidence: 'high',
        reasons,
        suggestions: [
          { label: 'Format / validate', mode: 'xml' },
          { label: 'Convert to JSON', mode: 'convert', options: { from: 'xml', to: 'json' } },
        ],
      };
    } catch (e) {
      reasons.push(`Looks like markup but is not well-formed XML: ${(e as Error).message}.`);
      return { shape: html ? 'HTML' : 'XML-ish markup', confidence: 'medium', reasons, suggestions: [{ label: 'See the exact problem', mode: 'xml' }] };
    }
  }

  // ---- CSS.
  if (/[^{}]+\{[^{}]*:[^{}]*\}/.test(text)) {
    try {
      validateCss(text);
      reasons.push('Has selector { property: value } blocks with balanced braces.');
      return { shape: 'CSS', confidence: 'medium', reasons, suggestions: [{ label: 'Beautify / minify', mode: 'css' }] };
    } catch {
      /* not css */
    }
  }

  // ---- CSV / TSV.
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length >= 2) {
    const d = detectDelimiter(text);
    const counts = lines.slice(0, 20).map((l) => l.split(d).length - 1);
    const consistent = counts.every((c) => c === counts[0]) && counts[0]! >= 1;
    if (consistent) {
      try {
        const table = parseCsv(text, { delimiter: d });
        reasons.push(`${lines.length} lines, each with the same number of ${DELIM_NAME[d]} (${counts[0]}) — a ${counts[0]! + 1}-column table.`);
        reasons.push(`First line looks like a header: ${table.header?.slice(0, 5).join(', ') ?? ''}${(table.header?.length ?? 0) > 5 ? ', …' : ''}.`);
        return {
          shape: d === '\t' ? 'TSV (tab-separated values)' : 'CSV',
          confidence: 'medium',
          reasons,
          suggestions: [
            { label: 'Preview as table', mode: 'csv', options: { delimiter: d } },
            { label: 'Convert to JSON records', mode: 'convert', options: { from: 'csv', to: 'json' } },
          ],
        };
      } catch {
        /* not csv */
      }
    }
  }

  // ---- YAML.
  if (/^[\w"'-][^\n]*:(\s|$)/m.test(text) || /^\s*-\s+\S/m.test(text)) {
    try {
      const v = parseYaml(text);
      if (v && typeof v === 'object') {
        reasons.push('Indented key: value lines that parse as YAML.');
        return {
          shape: Array.isArray(v) ? 'YAML list' : 'YAML mapping',
          confidence: 'medium',
          reasons,
          suggestions: [
            { label: 'Validate / reformat', mode: 'yaml' },
            { label: 'Convert to JSON', mode: 'convert', options: { from: 'yaml', to: 'json' } },
          ],
        };
      }
    } catch {
      /* not yaml */
    }
  }

  // ---- A few shapes we recognise but have no dedicated mode for.
  if (/^[0-9a-f]+$/i.test(text.replace(/\s/g, '')) && text.replace(/\s/g, '').length % 2 === 0 && text.length >= 8) {
    reasons.push(`Only hex digits, even length — ${text.replace(/\s/g, '').length / 2} bytes.`);
    return { shape: 'Hex-encoded bytes', confidence: 'medium', reasons, suggestions: [] };
  }
  if (/^[^\s=&]+=[^&\s]*(&[^\s=&]+=[^&\s]*)*$/.test(text)) {
    reasons.push('key=value pairs joined by & — a URL query string.');
    return { shape: 'URL query string', confidence: 'medium', reasons, suggestions: [] };
  }
  if (/^https?:\/\/\S+$/.test(text)) {
    return { shape: 'URL', confidence: 'high', reasons: ['A single http(s) address.'], suggestions: [] };
  }

  reasons.push(`No structured format matched (${stats(text)}).`);
  return {
    shape: 'Plain text',
    confidence: 'low',
    reasons,
    suggestions: [{ label: 'Encode as Base64', mode: 'base64', options: { direction: 'encode' } }],
  };
}
