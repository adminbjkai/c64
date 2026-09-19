/**
 * XML Compare mode: both documents are parsed with the strict XML parser and
 * mapped to a canonical JSON-like value (via `xmlToJson`), then compared
 * with the structural diff engine.
 *
 * Canonical mapping (see src/lib/xml.ts): the document is
 * `{ <root>: value }`; an element with attributes or child elements is an
 * object with `@attr` keys, `#text` for non-blank text (trimmed runs joined
 * by one space) and one key per child name — repeated siblings become an
 * array, so child order matters (default array mode: by index) while
 * attribute order never does. A text-only element with no attributes is just
 * its string. Comments, PIs, DOCTYPE and the declaration are ignored; CDATA
 * is text.
 *
 * Limitations: namespaces are not resolved — elements and attributes are
 * compared on their prefixed names exactly as written (`ns:a` ≠ `a`, and two
 * prefixes bound to the same URI are different names). Adding a second
 * sibling turns a value into an array (a type change), and adding an
 * attribute turns a text-only element into an object. The JSON Patch in the
 * Raw output is expressed against the canonical value, not the XML text.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { parseXml, xmlToJson } from '../lib/xml.js';
import { checkSides, compareControls, compareValues, readDiffOptions, sideFailure } from './struct-compare.js';

const LABELS: [string, string] = ['Original', 'Changed'];

/** Trim element text (`#text` and text-only elements); drop whitespace-only `#text`. Attributes are left as written. */
function trimText(v: unknown): unknown {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(trimText);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k.startsWith('@')) out[k] = x;
      else if (k === '#text') {
        const t = typeof x === 'string' ? x.trim() : x;
        if (t !== '') out[k] = t;
      } else out[k] = trimText(x);
    }
    return out;
  }
  return v;
}

/** Parse XML text to its canonical comparable value. */
export function xmlToCanonical(text: string): unknown {
  return trimText(xmlToJson(parseXml(text)));
}

export function runXmlDiff(input: string, ctx: RunContext): ModeResult {
  const early = checkSides(input, ctx.inputB, LABELS);
  if (early) return early;
  let a: unknown;
  let b: unknown;
  try {
    a = xmlToCanonical(input);
  } catch (e) {
    return sideFailure(LABELS[0], 'XML', e);
  }
  try {
    b = xmlToCanonical(ctx.inputB ?? '');
  } catch (e) {
    return sideFailure(LABELS[1], 'XML', e);
  }
  return compareValues(a, b, ctx, readDiffOptions(ctx, { trimStrings: true }), LABELS, [
    'Compared on the canonical value: @attr = attribute, #text = text, repeated children = array. The JSON Patch targets that value, not the XML text.',
  ]);
}

export const xmlDiffMode: ToolMode = {
  id: 'xml-diff',
  label: 'XML Compare',
  description: 'Compare two XML documents by structure — attributes, text and child elements — ignoring formatting.',
  category: 'Compare',
  icon: 'compare',
  keywords: ['diff', 'xml', 'structural', 'semantic', 'attributes', 'elements'],
  emptyHint: 'Paste the original XML in Original and the new version in Changed.',
  inputs: 2,
  inputLabels: LABELS,
  sample: `<?xml version="1.0"?>
<catalog>
  <!-- comments are ignored -->
  <product id="42" status="active">
    <name>Widget</name>
    <price currency="USD">9.99</price>
    <tags>
      <tag>a</tag>
      <tag>b</tag>
    </tags>
  </product>
</catalog>`,
  sampleB: `<catalog>
  <product status="active" id="42">
    <name><![CDATA[Widget Pro]]></name>
    <price currency="EUR">9.99</price>
    <tags>
      <tag>a</tag>
      <tag>c</tag>
    </tags>
    <sku>W-42</sku>
  </product>
</catalog>`,
  supportsPretty: true,
  outputLanguage: (ctx) => (ctx.pretty ? undefined : 'json'),
  controls: compareControls({ trimStrings: true }),
  run: runXmlDiff,
};
