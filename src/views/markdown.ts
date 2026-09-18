/**
 * Markdown preview renderer. The HTML comes from our own escaping renderer
 * (src/lib/markdown.ts), so innerHTML is acceptable here — but the result is
 * walked afterwards and anything outside the allow-list (tags, attributes,
 * URL schemes) is stripped, so a bug in the renderer cannot become XSS.
 */

import { h } from '../ui.js';
import type { MarkdownData } from '../modes/markdown.js';
import { SAFE_TAGS, SAFE_ATTRS, safeHref, safeSrc } from '../lib/markdown.js';
import type { ViewRenderer } from './types.js';

const TAGS = new Set<string>(SAFE_TAGS);
const ATTRS = new Set<string>(SAFE_ATTRS);

/** Remove disallowed elements (keeping their text) and attributes in place. */
export function sanitizeTree(root: HTMLElement): void {
  const els = Array.from(root.querySelectorAll('*'));
  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    if (!TAGS.has(tag)) {
      el.replaceWith(document.createTextNode(el.textContent ?? ''));
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ATTRS.has(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === 'href' && !safeHref(attr.value)) el.removeAttribute(attr.name);
      if (name === 'src' && !safeSrc(attr.value)) el.removeAttribute(attr.name);
    }
    if (tag === 'a') {
      el.setAttribute('rel', 'noopener');
      el.setAttribute('target', '_blank');
    }
    if (tag === 'input') {
      el.setAttribute('type', 'checkbox');
      el.setAttribute('disabled', '');
    }
  }
}

export const renderMarkdown: ViewRenderer = (host, raw) => {
  const d = raw as MarkdownData;
  const preview = h('div.md-preview');
  preview.innerHTML = d.html;
  sanitizeTree(preview);
  host.append(preview);
  if (d.showHtml) host.append(h('pre.md-source', {}, d.html));
};
