/**
 * View registry: ModeView.kind → renderer.
 */

import type { ViewRenderer } from './types.js';
import { renderJsonTree } from './json-tree.js';
import { renderJsonGraph } from './json-graph.js';
import { renderJwt } from './jwt.js';
import { renderTable } from './table.js';

export const VIEWS: Record<string, ViewRenderer> = {
  'json-tree': renderJsonTree,
  'json-path': renderJsonTree,
  'json-graph': renderJsonGraph,
  jwt: renderJwt,
  table: renderTable,
};

export type { ViewContext, ViewRenderer } from './types.js';
