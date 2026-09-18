/**
 * json-types.ts — infer a type structure from a JSON value and emit it as
 * TypeScript, Zod, Python TypedDict, Go structs or JSON Schema (2020-12).
 *
 * Inference
 * ---------
 * - Primitives: string (with an ISO-8601 date hint), number (int vs float),
 *   boolean, null. Empty arrays are `unknown[]`.
 * - Arrays unify their element types: objects are merged into one shape
 *   (keys missing in some items become optional when `optionalMissing`),
 *   differing primitives become a union, null joins as `T | null`.
 * - Every object shape is hoisted into a named type. Names are PascalCase
 *   from the key (`address` → `Address`); arrays singularise simple plurals
 *   (`items` → `Item`, `entries` → `Entry`); collisions get a numeric suffix.
 *
 * Emission order: TypeScript / Go / JSON Schema list the root first, then
 * nested types in encounter order; Zod and Python need definition-before-use
 * so they list the nested types first and the root last.
 */

export type Target = 'typescript' | 'zod' | 'python' | 'go' | 'jsonschema';

export interface Field {
  shape: Shape;
  optional: boolean;
}

export type Shape =
  | { kind: 'string'; date: boolean }
  | { kind: 'number'; int: boolean }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'unknown' }
  | { kind: 'array'; elem: Shape }
  | { kind: 'object'; fields: Map<string, Field> }
  | { kind: 'union'; members: Shape[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export interface InferOptions {
  optionalMissing?: boolean;
}

export function inferShape(value: unknown, opts: InferOptions = {}): Shape {
  const optionalMissing = opts.optionalMissing !== false;
  const infer = (v: unknown): Shape => {
    if (v === null || v === undefined) return { kind: 'null' };
    if (typeof v === 'string') return { kind: 'string', date: ISO_DATE.test(v) };
    if (typeof v === 'number') return { kind: 'number', int: Number.isInteger(v) };
    if (typeof v === 'boolean') return { kind: 'boolean' };
    if (Array.isArray(v)) {
      if (v.length === 0) return { kind: 'array', elem: { kind: 'unknown' } };
      let elem: Shape | undefined;
      for (const item of v) {
        const s = infer(item);
        elem = elem ? unify(elem, s) : s;
      }
      return { kind: 'array', elem: elem! };
    }
    if (typeof v === 'object') {
      const fields = new Map<string, Field>();
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields.set(k, { shape: infer(val), optional: false });
      return { kind: 'object', fields };
    }
    return { kind: 'unknown' };
  };

  const unify = (a: Shape, b: Shape): Shape => {
    if (a.kind === 'unknown') return b;
    if (b.kind === 'unknown') return a;
    if (a.kind === 'string' && b.kind === 'string') return { kind: 'string', date: a.date && b.date };
    if (a.kind === 'number' && b.kind === 'number') return { kind: 'number', int: a.int && b.int };
    if (a.kind === 'boolean' && b.kind === 'boolean') return a;
    if (a.kind === 'null' && b.kind === 'null') return a;
    if (a.kind === 'array' && b.kind === 'array') return { kind: 'array', elem: unify(a.elem, b.elem) };
    if (a.kind === 'object' && b.kind === 'object') {
      const fields = new Map<string, Field>();
      for (const [k, fa] of a.fields) {
        const fb = b.fields.get(k);
        if (fb) fields.set(k, { shape: unify(fa.shape, fb.shape), optional: fa.optional || fb.optional });
        else fields.set(k, { shape: fa.shape, optional: optionalMissing || fa.optional });
      }
      for (const [k, fb] of b.fields) {
        if (!a.fields.has(k)) fields.set(k, { shape: fb.shape, optional: optionalMissing || fb.optional });
      }
      return { kind: 'object', fields };
    }
    const members: Shape[] = [];
    const add = (s: Shape): void => {
      if (s.kind === 'union') {
        s.members.forEach(add);
        return;
      }
      const idx = members.findIndex((m) => m.kind === s.kind);
      if (idx < 0) members.push(s);
      else members[idx] = unify(members[idx]!, s);
    };
    add(a);
    add(b);
    return members.length === 1 ? members[0]! : { kind: 'union', members };
  };

  return infer(value);
}

/* --------------------------------------------------------------- naming */

export function pascalCase(s: string): string {
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let out = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  if (!out) out = 'Type';
  if (/^\d/.test(out)) out = 'T' + out;
  return out;
}

export function singularize(s: string): string {
  if (/ies$/i.test(s) && s.length > 4) return s.slice(0, -3) + 'y';
  if (/(ses|xes|zes|ches|shes)$/i.test(s)) return s.slice(0, -2);
  if (/ss$/i.test(s)) return s;
  if (/s$/i.test(s) && s.length > 2) return s.slice(0, -1);
  return s;
}

export interface NamedType {
  name: string;
  shape: Extract<Shape, { kind: 'object' }>;
}

/** Walks the shape, assigning a unique name to every object (pre-order). */
export function collectTypes(root: Shape, rootName: string): { types: NamedType[]; names: Map<Shape, string> } {
  const types: NamedType[] = [];
  const names = new Map<Shape, string>();
  const used = new Set<string>();
  const unique = (base: string): string => {
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}${n++}`;
    used.add(name);
    return name;
  };
  const visit = (shape: Shape, hint: string): void => {
    switch (shape.kind) {
      case 'object': {
        if (names.has(shape)) return;
        const name = unique(hint);
        names.set(shape, name);
        types.push({ name, shape });
        for (const [key, field] of shape.fields) visit(field.shape, hintFor(key, field.shape));
        return;
      }
      case 'array':
        visit(shape.elem, hint);
        return;
      case 'union':
        shape.members.forEach((m) => visit(m, hint));
        return;
      default:
        return;
    }
  };
  const hintFor = (key: string, shape: Shape): string => pascalCase(shape.kind === 'array' || (shape.kind === 'union' && shape.members.some((m) => m.kind === 'array')) ? singularize(key) : key);
  const rootHint = root.kind === 'object' ? rootName : `${rootName}Item`;
  if (root.kind !== 'object') used.add(rootName);
  visit(root, rootHint);
  return { types, names };
}

/* ------------------------------------------------------------- emitters */

export interface GenerateOptions {
  target: Target;
  rootName: string;
  optionalMissing?: boolean;
}

export interface GenerateResult {
  code: string;
  typeCount: number;
}

const isIdent = (s: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
const isPyIdent = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
const withoutNull = (s: Shape): { inner: Shape; nullable: boolean } => {
  if (s.kind === 'null') return { inner: s, nullable: false };
  if (s.kind === 'union' && s.members.some((m) => m.kind === 'null')) {
    const rest = s.members.filter((m) => m.kind !== 'null');
    return { inner: rest.length === 1 ? rest[0]! : { kind: 'union', members: rest }, nullable: true };
  }
  return { inner: s, nullable: false };
};
const isDate = (s: Shape): boolean => s.kind === 'string' && s.date;
const orderedMembers = (u: Extract<Shape, { kind: 'union' }>): Shape[] => [...u.members.filter((m) => m.kind !== 'null'), ...u.members.filter((m) => m.kind === 'null')];

export function generateTypes(value: unknown, opts: GenerateOptions): GenerateResult {
  const rootName = pascalCase(opts.rootName || 'Root');
  const root = inferShape(value, { optionalMissing: opts.optionalMissing });
  const { types, names } = collectTypes(root, rootName);
  const rootIsObject = root.kind === 'object';
  const typeCount = types.length + (rootIsObject ? 0 : 1);
  switch (opts.target) {
    case 'zod':
      return { code: emitZod(root, rootName, types, names), typeCount };
    case 'python':
      return { code: emitPython(root, rootName, types, names), typeCount };
    case 'go':
      return { code: emitGo(root, rootName, types, names), typeCount };
    case 'jsonschema':
      return { code: emitJsonSchema(root, rootName, types, names), typeCount };
    default:
      return { code: emitTypeScript(root, rootName, types, names), typeCount };
  }
}

function emitTypeScript(root: Shape, rootName: string, types: NamedType[], names: Map<Shape, string>): string {
  const expr = (s: Shape): string => {
    switch (s.kind) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'unknown':
        return 'unknown';
      case 'array':
        return s.elem.kind === 'union' ? `(${expr(s.elem)})[]` : `${expr(s.elem)}[]`;
      case 'object':
        return names.get(s) ?? 'Record<string, unknown>';
      case 'union':
        return orderedMembers(s).map(expr).join(' | ');
    }
  };
  const blocks: string[] = [];
  if (root.kind !== 'object') blocks.push(`export type ${rootName} = ${expr(root)};`);
  for (const t of types) {
    const lines = [`export interface ${t.name} {`];
    for (const [key, f] of t.shape.fields) {
      const name = isIdent(key) ? key : JSON.stringify(key);
      lines.push(`  ${name}${f.optional ? '?' : ''}: ${expr(f.shape)};${isDate(f.shape) ? ' // ISO-8601 date' : ''}`);
    }
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n') + '\n';
}

function emitZod(root: Shape, rootName: string, types: NamedType[], names: Map<Shape, string>): string {
  const expr = (s: Shape): string => {
    switch (s.kind) {
      case 'string':
        return 'z.string()';
      case 'number':
        return 'z.number()';
      case 'boolean':
        return 'z.boolean()';
      case 'null':
        return 'z.null()';
      case 'unknown':
        return 'z.unknown()';
      case 'array':
        return `z.array(${expr(s.elem)})`;
      case 'object':
        return `${names.get(s) ?? 'Unknown'}Schema`;
      case 'union': {
        const { inner, nullable } = withoutNull(s);
        if (nullable) return `${expr(inner)}.nullable()`;
        return `z.union([${s.members.map(expr).join(', ')}])`;
      }
    }
  };
  const blocks: string[] = ['import { z } from "zod";'];
  for (const t of [...types].reverse()) {
    const lines = [`export const ${t.name}Schema = z.object({`];
    for (const [key, f] of t.shape.fields) {
      const name = isIdent(key) ? key : JSON.stringify(key);
      lines.push(`  ${name}: ${expr(f.shape)}${f.optional ? '.optional()' : ''},${isDate(f.shape) ? ' // ISO-8601 date' : ''}`);
    }
    lines.push('});', `export type ${t.name} = z.infer<typeof ${t.name}Schema>;`);
    blocks.push(lines.join('\n'));
  }
  if (root.kind !== 'object') blocks.push(`export const ${rootName}Schema = ${expr(root)};\nexport type ${rootName} = z.infer<typeof ${rootName}Schema>;`);
  return blocks.join('\n\n') + '\n';
}

function emitPython(root: Shape, rootName: string, types: NamedType[], names: Map<Shape, string>): string {
  const imports = new Set<string>();
  const expr = (s: Shape): string => {
    switch (s.kind) {
      case 'string':
        return 'str';
      case 'number':
        return s.int ? 'int' : 'float';
      case 'boolean':
        return 'bool';
      case 'null':
        return 'None';
      case 'unknown':
        imports.add('Any');
        return 'Any';
      case 'array':
        return `list[${expr(s.elem)}]`;
      case 'object':
        return names.get(s) ?? 'dict';
      case 'union':
        return orderedMembers(s).map(expr).join(' | ');
    }
  };
  const blocks: string[] = [];
  for (const t of [...types].reverse()) {
    imports.add('TypedDict');
    const lines = [`class ${t.name}(TypedDict):`];
    if (t.shape.fields.size === 0) lines.push('    pass');
    for (const [key, f] of t.shape.fields) {
      let ann = expr(f.shape);
      if (f.optional) {
        imports.add('NotRequired');
        ann = `NotRequired[${ann}]`;
      }
      const comments: string[] = [];
      if (isDate(f.shape)) comments.push('ISO-8601 date');
      if (!isPyIdent(key)) comments.push(`key is ${JSON.stringify(key)} in JSON`);
      const pyKey = isPyIdent(key) ? key : key.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
      lines.push(`    ${pyKey}: ${ann}${comments.length ? '  # ' + comments.join('; ') : ''}`);
    }
    blocks.push(lines.join('\n'));
  }
  if (root.kind !== 'object') blocks.push(`${rootName} = ${expr(root)}`);
  const header = imports.size ? `from typing import ${[...imports].sort().join(', ')}\n\n\n` : '';
  return header + blocks.join('\n\n\n') + '\n';
}

const GO_INITIALISMS = new Set(['id', 'url', 'uri', 'http', 'https', 'api', 'json', 'xml', 'html', 'sql', 'ip', 'uuid', 'ui', 'os', 'db']);

function goFieldName(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let out = words.map((w) => (GO_INITIALISMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1))).join('');
  if (!out) out = 'Field';
  if (/^\d/.test(out)) out = 'F' + out;
  return out;
}

function emitGo(root: Shape, rootName: string, types: NamedType[], names: Map<Shape, string>): string {
  const expr = (s: Shape): string => {
    switch (s.kind) {
      case 'string':
        return 'string';
      case 'number':
        return s.int ? 'int64' : 'float64';
      case 'boolean':
        return 'bool';
      case 'null':
      case 'unknown':
        return 'any';
      case 'array':
        return `[]${expr(s.elem)}`;
      case 'object':
        return names.get(s) ?? 'map[string]any';
      case 'union': {
        const { inner, nullable } = withoutNull(s);
        if (nullable && inner.kind !== 'union') {
          const e = expr(inner);
          return e === 'any' || e.startsWith('[]') ? e : `*${e}`;
        }
        return 'any';
      }
    }
  };
  const blocks: string[] = [];
  if (root.kind !== 'object') blocks.push(`type ${rootName} ${expr(root)}`);
  for (const t of types) {
    const rows: [string, string, string, string][] = [];
    const used = new Set<string>();
    for (const [key, f] of t.shape.fields) {
      let name = goFieldName(key);
      let n = 2;
      while (used.has(name)) name = `${goFieldName(key)}${n++}`;
      used.add(name);
      const tag = `\`json:"${key}${f.optional ? ',omitempty' : ''}"\``;
      rows.push([name, expr(f.shape), tag, isDate(f.shape) ? ' // ISO-8601 date' : '']);
    }
    const nameW = Math.max(0, ...rows.map((r) => r[0].length));
    const typeW = Math.max(0, ...rows.map((r) => r[1].length));
    const lines = [`type ${t.name} struct {`];
    for (const [name, type, tag, comment] of rows) lines.push(`\t${name.padEnd(nameW)} ${type.padEnd(typeW)} ${tag}${comment}`);
    lines.push('}');
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n') + '\n';
}

function emitJsonSchema(root: Shape, rootName: string, types: NamedType[], names: Map<Shape, string>): string {
  const schemaOf = (s: Shape): Record<string, unknown> => {
    switch (s.kind) {
      case 'string':
        return s.date ? { type: 'string', format: 'date-time' } : { type: 'string' };
      case 'number':
        return { type: s.int ? 'integer' : 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'null':
        return { type: 'null' };
      case 'unknown':
        return {};
      case 'array':
        return { type: 'array', items: schemaOf(s.elem) };
      case 'object':
        return s === root ? objectSchema(s) : { $ref: `#/$defs/${names.get(s) ?? 'Unknown'}` };
      case 'union':
        return { anyOf: orderedMembers(s).map(schemaOf) };
    }
  };
  const objectSchema = (s: Extract<Shape, { kind: 'object' }>): Record<string, unknown> => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, f] of s.fields) {
      properties[key] = schemaOf(f.shape);
      if (!f.optional) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  };
  const out: Record<string, unknown> = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: rootName, ...schemaOf(root) };
  const defs: Record<string, unknown> = {};
  for (const t of types) if (t.shape !== root) defs[t.name] = objectSchema(t.shape);
  if (Object.keys(defs).length) out['$defs'] = defs;
  return JSON.stringify(out, null, 2) + '\n';
}
