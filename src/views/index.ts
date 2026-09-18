/**
 * View registry: ModeView.kind → renderer.
 */

import type { ViewRenderer } from './types.js';
import { renderJsonTree } from './json-tree.js';
import { renderJsonGraph } from './json-graph.js';
import { renderJwt } from './jwt.js';
import { renderTable } from './table.js';
import { renderUrl } from './url.js';
import { renderCaseAll } from './case-all.js';
import { renderHash } from './hash.js';
import { renderBaseN } from './basen.js';
import { renderTimestamp } from './timestamp.js';
import { renderUuid } from './uuid.js';
import { renderDiff } from './diff.js';
import { renderRegex } from './regex.js';
import { renderMarkdown } from './markdown.js';
import { renderStats } from './stats.js';
import { renderCron } from './cron.js';
import { renderColor } from './color.js';

export const VIEWS: Record<string, ViewRenderer> = {
  'json-tree': renderJsonTree,
  'json-path': renderJsonTree,
  'json-graph': renderJsonGraph,
  jwt: renderJwt,
  table: renderTable,
  url: renderUrl,
  'case-all': renderCaseAll,
  hash: renderHash,
  basen: renderBaseN,
  timestamp: renderTimestamp,
  uuid: renderUuid,
  diff: renderDiff,
  regex: renderRegex,
  markdown: renderMarkdown,
  stats: renderStats,
  cron: renderCron,
  color: renderColor,
};

export type { ViewContext, ViewRenderer } from './types.js';
