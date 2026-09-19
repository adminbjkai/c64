/**
 * Query String ↔ JSON mode: turn `?a=1&b=x&b=y&c[k]=v` (or a full URL, or a
 * bare `a=1&b=2`) into a JSON object, or a JSON object back into a query
 * string using bracket notation. Pretty = indented JSON; Raw = minified.
 */

import { type ToolMode, type ModeResult, type RunContext, failure } from './types.js';
import { parseQueryString, stringifyQuery, type QueryObject } from '../lib/query-string.js';
import { parseJson } from './json.js';

export function runQueryString(input: string, ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  const dirOpt = ctx.options['direction'];
  const trimmed = input.trim();
  const direction = dirOpt === 'toJson' || dirOpt === 'toQuery' ? dirOpt : trimmed.startsWith('{') ? 'toQuery' : 'toJson';

  if (direction === 'toQuery') {
    let value: unknown;
    try {
      value = parseJson(trimmed).value;
    } catch (e) {
      return failure('JSON', e);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { output: '', error: { message: 'Query strings need a JSON object at the top level', hint: 'Wrap the value in an object, e.g. {"items": [1, 2]}.' }, status: 'Invalid input' };
    }
    const output = stringifyQuery(value as QueryObject);
    const pairs = output === '' ? 0 : output.split('&').length;
    return { output, status: `Query string · ${pairs} pair${pairs === 1 ? '' : 's'}` };
  }

  const typed = ctx.options['typed'] === true;
  const { value, pairs } = parseQueryString(input, { typed });
  const keys = Object.keys(value).length;
  return {
    output: ctx.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value),
    status: `JSON · ${pairs} pair${pairs === 1 ? '' : 's'} → ${keys} key${keys === 1 ? '' : 's'}${typed ? ' · typed' : ''}`,
  };
}

export const queryStringMode: ToolMode = {
  id: 'query-string',
  label: 'Query String ↔ JSON',
  description: 'Convert a URL query string to a JSON object and back, with nested bracket keys.',
  category: 'Web',
  icon: 'link',
  keywords: ['querystring', 'params', 'form', 'search', 'urlencoded', 'qs'],
  emptyHint: 'Paste a query string, a full URL or a JSON object — the direction is auto-detected.',
  sample: 'https://example.com/list?page=2&sort=name&tag=a&tag=b&filter[status]=open&filter[owner]=me&ids[]=7&ids[]=9&q=hello+world&empty=',
  outputLanguage: (ctx) => (typeof ctx.options['direction'] === 'string' && ctx.options['direction'] === 'toQuery' ? undefined : 'json'),
  supportsPretty: true,
  controls: [
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'toJson', label: 'Query → JSON' },
        { value: 'toQuery', label: 'JSON → Query' },
      ],
    },
    { kind: 'toggle', key: 'typed', label: 'Typed values', default: false },
  ],
  run: runQueryString,
};
