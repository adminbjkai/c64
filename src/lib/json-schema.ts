/**
 * json-schema.ts — a dependency-free JSON Schema validator covering the
 * core keywords shared by draft-07, 2019-09 and 2020-12 (plus the draft-04
 * boolean `exclusiveMinimum` / `exclusiveMaximum` spelling).
 *
 * Supported keywords
 * ------------------
 *  - Any type: type (string or array; "integer"), enum, const, allOf, anyOf,
 *    oneOf, not, if / then / else, $ref (local `#`, `#/...` pointers into the
 *    root schema, so `$defs` and `definitions` both work), boolean schemas,
 *    $comment / title / description / examples / default (ignored).
 *  - Objects: properties, patternProperties, additionalProperties (boolean
 *    or schema), required, minProperties, maxProperties, propertyNames,
 *    dependentRequired, dependentSchemas, dependencies (draft-07 form).
 *  - Arrays: items (schema or tuple), prefixItems, additionalItems, contains,
 *    minContains, maxContains, minItems, maxItems, uniqueItems.
 *  - Strings: minLength, maxLength (code points), pattern, format for
 *    date, date-time, time, email, uuid, uri, ipv4, ipv6, hostname — other
 *    formats are ignored and reported as a note.
 *  - Numbers: minimum, maximum, exclusiveMinimum, exclusiveMaximum (numeric
 *    or draft-04 boolean), multipleOf.
 *
 * Not supported (ignored): remote / `$id`-based references, `$dynamicRef`,
 * `unevaluatedProperties` / `unevaluatedItems`, `contentEncoding`.
 *
 * Errors are collected exhaustively (every failing keyword, not just the
 * first) and carry the instance location as an RFC 6901 JSON Pointer.
 */

export interface SchemaError {
  /** RFC 6901 pointer into the instance ("" is the root). */
  instancePath: string;
  /** RFC 6901 pointer into the schema, e.g. "/properties/age/minimum". */
  schemaPath: string;
  keyword: string;
  message: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: SchemaError[];
  /** Things that were not checked (unknown formats, unsupported keywords). */
  notes: string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Human type name used in messages. */
export function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function escapePointer(seg: string | number): string {
  return String(seg).replace(/~/g, '~0').replace(/\//g, '~1');
}

function unescapePointer(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a local `#/a/b` pointer against `root`. Returns undefined when missing. */
export function resolvePointer(root: unknown, ref: string): unknown {
  if (ref === '#' || ref === '') return root;
  if (!ref.startsWith('#/')) return undefined;
  let cur: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    let seg = raw;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    seg = unescapePointer(seg);
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isObj(cur)) cur = cur[seg];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Deep structural equality for enum / const / uniqueItems (order-insensitive keys). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function short(v: unknown): string {
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 40 ? s.slice(0, 37) + '…' : s;
}

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/* ------------------------------------------------------------------------ */
/* Formats                                                                   */
/* ------------------------------------------------------------------------ */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:[zZ]|[+-](\d{2}):(\d{2}))$/;
const EMAIL_RE = /^[^\s@"]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

function validDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[mo - 1]!;
}

function validTime(s: string): boolean {
  const m = TIME_RE.exec(s);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const se = Number(m[3]);
  if (h > 23 || mi > 59 || se > 60) return false;
  if (m[5] !== undefined && (Number(m[5]) > 23 || Number(m[6]) > 59)) return false;
  return true;
}

function validIpv6(s: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(s) || s.length < 2) return false;
  const parts = s.split('::');
  if (parts.length > 2) return false;
  const groups = (p: string) => (p === '' ? [] : p.split(':'));
  const head = groups(parts[0]!);
  const tail = parts.length === 2 ? groups(parts[1]!) : [];
  const all = [...head, ...tail];
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const g = all[i]!;
    if (i === all.length - 1 && g.includes('.')) {
      if (!IPV4_RE.test(g)) return false;
      count += 2;
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
    count++;
  }
  return parts.length === 2 ? count < 8 : count === 8;
}

/** Returns true when valid, false when invalid, undefined when the format is unknown. */
export function checkFormat(format: string, s: string): boolean | undefined {
  switch (format) {
    case 'date':
      return validDate(s);
    case 'time':
      return validTime(s);
    case 'date-time': {
      const i = s.search(/[Tt ]/);
      return i > 0 && validDate(s.slice(0, i)) && validTime(s.slice(i + 1));
    }
    case 'email':
      return EMAIL_RE.test(s);
    case 'uuid':
      return UUID_RE.test(s);
    case 'uri':
      return URI_RE.test(s);
    case 'ipv4':
      return IPV4_RE.test(s);
    case 'ipv6':
      return validIpv6(s);
    case 'hostname':
      return HOSTNAME_RE.test(s);
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------------ */
/* Validator                                                                 */
/* ------------------------------------------------------------------------ */

const MAX_DEPTH = 256;

class Validator {
  errors: SchemaError[] = [];
  notes = new Set<string>();
  private regexCache = new Map<string, RegExp | null>();

  constructor(private root: unknown) {}

  private regex(pattern: string): RegExp | null {
    let re = this.regexCache.get(pattern);
    if (re === undefined) {
      try {
        re = new RegExp(pattern, 'u');
      } catch {
        try {
          re = new RegExp(pattern);
        } catch {
          re = null;
        }
      }
      this.regexCache.set(pattern, re);
    }
    return re;
  }

  private fail(errors: SchemaError[], instancePath: string, schemaPath: string, keyword: string, message: string): void {
    errors.push({ instancePath, schemaPath, keyword, message });
  }

  /** Validate and return the errors for this subschema (also appended to `into`). */
  validate(schema: unknown, inst: unknown, ip: string, sp: string, into: SchemaError[], depth = 0): SchemaError[] {
    const errs: SchemaError[] = [];
    const push = (kw: string, msg: string, spx = `${sp}/${kw}`) => this.fail(errs, ip, spx, kw, msg);
    if (depth > MAX_DEPTH) {
      push('$ref', 'schema recursion too deep (circular $ref?)', sp);
      into.push(...errs);
      return errs;
    }
    if (schema === true) return errs;
    if (schema === false) {
      push('false', 'no value is allowed here (schema is false)', sp);
      into.push(...errs);
      return errs;
    }
    if (!isObj(schema)) {
      push('schema', `invalid schema (expected object or boolean, got ${typeName(schema)})`, sp);
      into.push(...errs);
      return errs;
    }
    const s = schema;
    const sub = (sch: unknown, v: unknown, ipx: string, spx: string) => this.validate(sch, v, ipx, spx, errs, depth + 1);
    const passes = (sch: unknown, v: unknown, ipx: string, spx: string) => this.validate(sch, v, ipx, spx, [], depth + 1).length === 0;

    // ---- $ref
    if (typeof s['$ref'] === 'string') {
      const ref = s['$ref'];
      const target = resolvePointer(this.root, ref);
      if (target === undefined) push('$ref', `cannot resolve $ref "${ref}"`);
      else sub(target, inst, ip, ref === '#' ? '' : ref.slice(1));
    }
    for (const kw of ['$dynamicRef', 'unevaluatedProperties', 'unevaluatedItems', 'contentEncoding', 'contentMediaType']) {
      if (kw in s) this.notes.add(`"${kw}" is not supported and was ignored.`);
    }

    // ---- type
    if (s['type'] !== undefined) {
      const types = Array.isArray(s['type']) ? (s['type'] as unknown[]) : [s['type']];
      const actual = typeName(inst);
      const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
      if (!ok) push('type', `must be ${types.map(String).join(' or ')} (got ${actual})`);
    }
    if (Array.isArray(s['enum'])) {
      if (!(s['enum'] as unknown[]).some((e) => deepEqual(e, inst))) push('enum', `must be one of ${(s['enum'] as unknown[]).map(short).join(', ')} (got ${short(inst)})`);
    }
    if ('const' in s && !deepEqual(s['const'], inst)) push('const', `must be ${short(s['const'])} (got ${short(inst)})`);

    // ---- numbers
    if (typeof inst === 'number') {
      const n = inst;
      const d4min = s['exclusiveMinimum'] === true;
      const d4max = s['exclusiveMaximum'] === true;
      if (typeof s['minimum'] === 'number') {
        if (d4min ? n <= s['minimum'] : n < s['minimum']) push('minimum', `must be ${d4min ? '>' : '>='} ${s['minimum']} (got ${n})`);
      }
      if (typeof s['maximum'] === 'number') {
        if (d4max ? n >= s['maximum'] : n > s['maximum']) push('maximum', `must be ${d4max ? '<' : '<='} ${s['maximum']} (got ${n})`);
      }
      if (typeof s['exclusiveMinimum'] === 'number' && n <= s['exclusiveMinimum']) push('exclusiveMinimum', `must be > ${s['exclusiveMinimum']} (got ${n})`);
      if (typeof s['exclusiveMaximum'] === 'number' && n >= s['exclusiveMaximum']) push('exclusiveMaximum', `must be < ${s['exclusiveMaximum']} (got ${n})`);
      if (typeof s['multipleOf'] === 'number' && s['multipleOf'] > 0) {
        const q = n / s['multipleOf'];
        if (Math.abs(q - Math.round(q)) > 1e-9) push('multipleOf', `must be a multiple of ${s['multipleOf']} (got ${n})`);
      }
    }

    // ---- strings
    if (typeof inst === 'string') {
      const str = inst;
      if (typeof s['minLength'] === 'number' && codePoints(str) < s['minLength']) push('minLength', `must be at least ${s['minLength']} characters (got ${codePoints(str)})`);
      if (typeof s['maxLength'] === 'number' && codePoints(str) > s['maxLength']) push('maxLength', `must be at most ${s['maxLength']} characters (got ${codePoints(str)})`);
      if (typeof s['pattern'] === 'string') {
        const re = this.regex(s['pattern']);
        if (!re) this.notes.add(`pattern ${short(s['pattern'])} is not a valid regular expression and was ignored.`);
        else if (!re.test(str)) push('pattern', `must match pattern ${short(s['pattern'])}`);
      }
      if (typeof s['format'] === 'string') {
        const r = checkFormat(s['format'], str);
        if (r === undefined) this.notes.add(`format "${s['format']}" is not checked.`);
        else if (!r) push('format', `must be a valid ${s['format']} (got ${short(str)})`);
      }
    }

    // ---- arrays
    if (Array.isArray(inst)) {
      const arr = inst;
      if (typeof s['minItems'] === 'number' && arr.length < s['minItems']) push('minItems', `must have at least ${s['minItems']} items (got ${arr.length})`);
      if (typeof s['maxItems'] === 'number' && arr.length > s['maxItems']) push('maxItems', `must have at most ${s['maxItems']} items (got ${arr.length})`);
      if (s['uniqueItems'] === true) {
        outer: for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            if (deepEqual(arr[i], arr[j])) {
              push('uniqueItems', `items must be unique (items ${i} and ${j} are equal)`);
              break outer;
            }
          }
        }
      }
      let prefixLen = 0;
      if (Array.isArray(s['prefixItems'])) {
        const tuple = s['prefixItems'] as unknown[];
        prefixLen = tuple.length;
        tuple.forEach((t, i) => {
          if (i < arr.length) sub(t, arr[i], `${ip}/${i}`, `${sp}/prefixItems/${i}`);
        });
      }
      if (Array.isArray(s['items'])) {
        const tuple = s['items'] as unknown[];
        prefixLen = Math.max(prefixLen, tuple.length);
        tuple.forEach((t, i) => {
          if (i < arr.length) sub(t, arr[i], `${ip}/${i}`, `${sp}/items/${i}`);
        });
        if (s['additionalItems'] !== undefined) {
          for (let i = tuple.length; i < arr.length; i++) {
            if (s['additionalItems'] === false) push('additionalItems', `must not have more than ${tuple.length} items (got ${arr.length})`);
            else sub(s['additionalItems'], arr[i], `${ip}/${i}`, `${sp}/additionalItems`);
            if (s['additionalItems'] === false) break;
          }
        }
      } else if (s['items'] !== undefined) {
        for (let i = prefixLen; i < arr.length; i++) {
          if (s['items'] === false) {
            push('items', `must not have more than ${prefixLen} items (got ${arr.length})`);
            break;
          }
          sub(s['items'], arr[i], `${ip}/${i}`, `${sp}/items`);
        }
      }
      if (s['contains'] !== undefined) {
        let count = 0;
        arr.forEach((v, i) => {
          if (passes(s['contains'], v, `${ip}/${i}`, `${sp}/contains`)) count++;
        });
        const min = typeof s['minContains'] === 'number' ? s['minContains'] : 1;
        const max = typeof s['maxContains'] === 'number' ? s['maxContains'] : Infinity;
        if (count < min) push(typeof s['minContains'] === 'number' ? 'minContains' : 'contains', min === 1 ? 'must contain at least one matching item' : `must contain at least ${min} matching items (got ${count})`);
        if (count > max) push('maxContains', `must contain at most ${max} matching items (got ${count})`);
      }
    }

    // ---- objects
    if (isObj(inst)) {
      const obj = inst;
      const keys = Object.keys(obj);
      if (Array.isArray(s['required'])) {
        for (const k of s['required'] as unknown[]) {
          if (typeof k === 'string' && !(k in obj)) push('required', `missing required property "${k}"`);
        }
      }
      if (typeof s['minProperties'] === 'number' && keys.length < s['minProperties']) push('minProperties', `must have at least ${s['minProperties']} properties (got ${keys.length})`);
      if (typeof s['maxProperties'] === 'number' && keys.length > s['maxProperties']) push('maxProperties', `must have at most ${s['maxProperties']} properties (got ${keys.length})`);
      const props = isObj(s['properties']) ? s['properties'] : {};
      const patterns = isObj(s['patternProperties']) ? s['patternProperties'] : {};
      const patternRes = Object.keys(patterns).map((p) => [p, this.regex(p)] as const);
      for (const k of keys) {
        let matched = false;
        if (Object.prototype.hasOwnProperty.call(props, k)) {
          matched = true;
          sub(props[k], obj[k], `${ip}/${escapePointer(k)}`, `${sp}/properties/${escapePointer(k)}`);
        }
        for (const [p, re] of patternRes) {
          if (re && re.test(k)) {
            matched = true;
            sub(patterns[p], obj[k], `${ip}/${escapePointer(k)}`, `${sp}/patternProperties/${escapePointer(p)}`);
          }
        }
        if (!matched && s['additionalProperties'] !== undefined) {
          if (s['additionalProperties'] === false) this.fail(errs, `${ip}/${escapePointer(k)}`, `${sp}/additionalProperties`, 'additionalProperties', `unexpected property "${k}"`);
          else sub(s['additionalProperties'], obj[k], `${ip}/${escapePointer(k)}`, `${sp}/additionalProperties`);
        }
      }
      if (s['propertyNames'] !== undefined) {
        for (const k of keys) {
          const inner = this.validate(s['propertyNames'], k, ip, `${sp}/propertyNames`, [], depth + 1);
          for (const e of inner) errs.push({ ...e, message: `property name "${k}": ${e.message}` });
        }
      }
      const depReq = isObj(s['dependentRequired']) ? s['dependentRequired'] : {};
      const depSch = isObj(s['dependentSchemas']) ? s['dependentSchemas'] : {};
      const legacy = isObj(s['dependencies']) ? s['dependencies'] : {};
      const checkDep = (kw: string, k: string, dep: unknown) => {
        if (!(k in obj)) return;
        if (Array.isArray(dep)) {
          for (const r of dep as unknown[]) {
            if (typeof r === 'string' && !(r in obj)) push(kw, `property "${r}" is required when "${k}" is present`, `${sp}/${kw}/${escapePointer(k)}`);
          }
        } else sub(dep, obj, ip, `${sp}/${kw}/${escapePointer(k)}`);
      };
      for (const k of Object.keys(depReq)) checkDep('dependentRequired', k, depReq[k]);
      for (const k of Object.keys(depSch)) checkDep('dependentSchemas', k, depSch[k]);
      for (const k of Object.keys(legacy)) checkDep('dependencies', k, legacy[k]);
    }

    // ---- combinators
    if (Array.isArray(s['allOf'])) {
      (s['allOf'] as unknown[]).forEach((sch, i) => sub(sch, inst, ip, `${sp}/allOf/${i}`));
    }
    if (Array.isArray(s['anyOf'])) {
      const list = s['anyOf'] as unknown[];
      if (!list.some((sch, i) => passes(sch, inst, ip, `${sp}/anyOf/${i}`))) push('anyOf', `must match at least one of ${list.length} schemas in anyOf`);
    }
    if (Array.isArray(s['oneOf'])) {
      const list = s['oneOf'] as unknown[];
      const matches = list.filter((sch, i) => passes(sch, inst, ip, `${sp}/oneOf/${i}`)).length;
      if (matches !== 1) push('oneOf', `must match exactly one schema in oneOf (matched ${matches} of ${list.length})`);
    }
    if (s['not'] !== undefined && passes(s['not'], inst, ip, `${sp}/not`)) push('not', 'must not match the schema in not');
    if (s['if'] !== undefined) {
      if (passes(s['if'], inst, ip, `${sp}/if`)) {
        if (s['then'] !== undefined) sub(s['then'], inst, ip, `${sp}/then`);
      } else if (s['else'] !== undefined) sub(s['else'], inst, ip, `${sp}/else`);
    }

    into.push(...errs);
    return errs;
  }
}

/** Validate `instance` against `schema`, collecting every error. */
export function validateSchema(schema: unknown, instance: unknown): ValidateResult {
  const v = new Validator(schema);
  const errors: SchemaError[] = [];
  v.validate(schema, instance, '', '', errors);
  return { valid: errors.length === 0, errors, notes: [...v.notes] };
}
