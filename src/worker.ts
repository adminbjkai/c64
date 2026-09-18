/**
 * Web Worker entry: receives { id, modeId, input, ctx }, runs the pure mode
 * function, posts { id, result } back. No network, no storage — it only
 * knows about the message channel to the page that created it.
 */

import { getMode, type RunContext, type ModeResult } from './modes/index.js';

interface Request {
  id: number;
  modeId: string;
  input: string;
  ctx: RunContext;
}

self.addEventListener('message', (e: MessageEvent<Request>) => {
  const { id, modeId, input, ctx } = e.data;
  let result: ModeResult;
  try {
    result = getMode(modeId).run(input, ctx);
  } catch (err) {
    result = { output: '', error: { message: `Unexpected error: ${(err as Error).message}` }, status: 'Error' };
  }
  (self as unknown as Worker).postMessage({ id, result });
});
