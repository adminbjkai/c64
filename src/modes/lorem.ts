/**
 * Lorem Ipsum / Fake Data mode. A generator: empty input produces `count`
 * items of `kind` using the `seed` option (random when blank). Non-empty
 * input is used as the seed instead, so the same text always regenerates
 * the same output.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';
import { Rng, words, sentence, paragraph, title, fullName, email, address, record, randomSeed, LOREM_WORDS } from '../lib/lorem.js';

export type LoremKind = 'words' | 'sentences' | 'paragraphs' | 'title' | 'names' | 'emails' | 'addresses' | 'json-records';
const KINDS: LoremKind[] = ['words', 'sentences', 'paragraphs', 'title', 'names', 'emails', 'addresses', 'json-records'];
const COUNTS = [1, 3, 5, 10, 25, 50];
const LOREM_START = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

export function generateLorem(kind: LoremKind, count: number, seed: string, startLorem: boolean, pretty = true): string {
  const rng = new Rng(seed);
  switch (kind) {
    case 'words': {
      if (startLorem) {
        const lead = LOREM_START.replace(',', '').split(' ').slice(0, count);
        return lead.concat(words(rng, Math.max(0, count - lead.length))).join(' ');
      }
      return words(rng, count).join(' ');
    }
    case 'sentences': {
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(sentence(rng));
      if (startLorem) out[0] = `${LOREM_START}, ${words(rng, rng.int(3, 6)).join(' ')}.`;
      return out.join(' ');
    }
    case 'paragraphs': {
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(paragraph(rng));
      if (startLorem) out[0] = `${LOREM_START}, ${words(rng, rng.int(3, 6)).join(' ')}. ${out[0]}`;
      return out.join('\n\n');
    }
    case 'title': {
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(title(rng));
      return out.join('\n');
    }
    case 'names': {
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(fullName(rng));
      return out.join('\n');
    }
    case 'emails': {
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(email(rng));
      return out.join('\n');
    }
    case 'addresses': {
      const out: string[] = [];
      for (let i = 0; i < count; i++) out.push(address(rng));
      return out.join('\n');
    }
    case 'json-records': {
      const out = [];
      for (let i = 0; i < count; i++) out.push(record(rng, i + 1));
      return pretty ? JSON.stringify(out, null, 2) : JSON.stringify(out);
    }
  }
}

export function runLorem(input: string, ctx: RunContext): ModeResult {
  const kindOpt = ctx.options['kind'];
  const kind: LoremKind = KINDS.includes(kindOpt as LoremKind) ? (kindOpt as LoremKind) : 'paragraphs';
  const countN = Number(ctx.options['count']);
  const count = COUNTS.includes(countN) ? countN : 3;
  const startLorem = ctx.options['startLorem'] !== false;
  const seedOpt = typeof ctx.options['seed'] === 'string' ? ctx.options['seed'].trim() : '';
  const fromInput = input.trim() !== '';
  const seed = fromInput ? input.trim() : seedOpt !== '' ? seedOpt : randomSeed();
  const output = generateLorem(kind, count, seed, startLorem, ctx.pretty);
  const unit = kind === 'json-records' ? 'record' : kind === 'title' ? 'title' : kind.replace(/s$/, '');
  const notes = [fromInput ? `Seeded from the input text — same input, same output.` : seedOpt !== '' ? `Seeded with "${seedOpt}" — deterministic.` : `Random seed ${seed} — set a seed (or type one as input) to make it repeatable.`];
  return {
    output,
    notes,
    status: `Generated ${count} ${unit}${count === 1 ? '' : 's'}${kind === 'words' || kind === 'sentences' || kind === 'paragraphs' ? ` · ${output.split(/\s+/).length} words` : ''} · ${LOREM_WORDS.length}-word vocabulary`,
  };
}

export const loremMode: ToolMode = {
  id: 'lorem',
  label: 'Lorem Ipsum / Fake Data',
  description: 'Generate placeholder text, titles, names, emails, addresses or JSON records, optionally from a seed.',
  category: 'Generators',
  icon: 'lorem',
  keywords: ['lorem', 'ipsum', 'placeholder', 'fake', 'dummy', 'mock', 'data', 'names', 'json', 'generate'],
  emptyHint: 'Leave empty to generate with the options above — or type any text to use it as the seed for repeatable output.',
  sample: 'c64',
  sampleOptions: { kind: 'paragraphs', count: '3' },
  supportsPretty: true,
  outputLanguage: (ctx) => (ctx.options['kind'] === 'json-records' ? 'json' : undefined),
  controls: [
    {
      kind: 'select',
      key: 'kind',
      label: 'Kind',
      default: 'paragraphs',
      options: [
        { value: 'words', label: 'Words' },
        { value: 'sentences', label: 'Sentences' },
        { value: 'paragraphs', label: 'Paragraphs' },
        { value: 'title', label: 'Titles' },
        { value: 'names', label: 'Names' },
        { value: 'emails', label: 'Emails' },
        { value: 'addresses', label: 'Addresses' },
        { value: 'json-records', label: 'JSON records' },
      ],
    },
    {
      kind: 'select',
      key: 'count',
      label: 'Count',
      default: '3',
      options: COUNTS.map((n) => ({ value: String(n), label: String(n) })),
    },
    { kind: 'toggle', key: 'startLorem', label: 'Start with "Lorem ipsum"', default: true },
    { kind: 'text', key: 'seed', label: 'Seed', placeholder: 'random', default: '' },
  ],
  run: runLorem,
};
