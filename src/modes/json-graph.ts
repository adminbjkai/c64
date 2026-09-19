/**
 * JSON Graph mode: builds the card graph (src/lib/graph-layout.ts) with
 * source spans so clicking a card selects the value in the editor.
 */

import { type ToolMode, type ModeResult, type RunContext, failure, formatBytes, byteLength } from './types.js';
import { parseJsonWithSpans, describeShape } from './json.js';
import { buildGraph, type Graph } from '../lib/graph-layout.js';

export interface GraphData {
  graph: Graph;
  spans: Map<string, [number, number]>;
}

export function runJsonGraph(input: string, _ctx: RunContext): ModeResult {
  if (input.trim() === '') return { output: '', status: '' };
  try {
    const { value, notes, spans } = parseJsonWithSpans(input);
    const graph = buildGraph(value, { maxNodes: 4000 });
    const data: GraphData = { graph, spans };
    const n = graph.nodes.length;
    return {
      output: JSON.stringify(value, null, 2),
      view: { kind: 'json-graph', data },
      notes: [...notes, ...(graph.truncated ? [`Large document: showing the first ${n} containers (breadth-first). Use Tree View for the rest.`] : [])],
      status: `${describeShape(value)} · ${n} card${n === 1 ? '' : 's'} · ${formatBytes(byteLength(input))}`,
    };
  } catch (e) {
    return failure('JSON', e);
  }
}

export const jsonGraphMode: ToolMode = {
  id: 'json-graph',
  label: 'JSON Graph',
  description: 'See the structure as a tidy tree of cards: zoom, pan, search, collapse branches and inspect any value.',
  category: 'JSON',
  icon: 'graph',
  emptyHint: 'Paste JSON to see it as a tidy tree of cards. Scroll to zoom, drag to pan, press / to search, click a card for its path and raw value, ⊟ to collapse a branch.',
  sample: JSON.stringify({
    order: { id: 'A-1042', total: 149.5, customer: { name: 'Ada', tags: ['vip', 'newsletter'] } },
    items: [
      { sku: 'K-1', name: 'Keyboard', qty: 1 },
      { sku: 'M-2', name: 'Mouse', qty: 2 },
    ],
    paid: true,
  }),
  supportsPretty: false,
  controls: [],
  run: runJsonGraph,
};
