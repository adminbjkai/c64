/**
 * Lorem ipsum and fake-data generation from small built-in word lists,
 * driven by a seedable LCG so a given seed always yields the same output.
 * Implements: words / sentences / paragraphs / titles / names / emails /
 * addresses / JSON records. Nothing here is real personal data.
 */

export const LOREM_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ' +
  'enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in ' +
  'reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa ' +
  'qui officia deserunt mollit anim id est laborum at vero eos accusamus iusto odio dignissimos ducimus blanditiis praesentium ' +
  'voluptatum deleniti atque corrupti quos dolores quas molestias recusandae itaque earum rerum hic tenetur sapiente delectus ' +
  'reiciendis voluptatibus maiores alias perferendis doloribus asperiores repellat nam libero tempore cum soluta nobis eligendi ' +
  'optio cumque nihil impedit quo minus quod maxime placeat facere possimus omnis voluptas assumenda repellendus temporibus ' +
  'autem quibusdam officiis debitis necessitatibus saepe eveniet voluptates repudiandae molestiae'
).split(' ');

export const FIRST_NAMES = [
  'Ada', 'Alan', 'Amara', 'Ben', 'Carla', 'Chen', 'Dana', 'Diego', 'Elena', 'Emil', 'Farah', 'Felix', 'Grace', 'Hana', 'Hugo', 'Ines',
  'Ivan', 'Jade', 'Jonas', 'Kai', 'Lena', 'Liam', 'Maya', 'Mateo', 'Nadia', 'Noah', 'Olga', 'Omar', 'Priya', 'Rafael', 'Rosa', 'Sam',
  'Sofia', 'Tariq', 'Tessa', 'Uma', 'Victor', 'Wren', 'Yara', 'Zoe',
];
export const LAST_NAMES = [
  'Adams', 'Alvarez', 'Baker', 'Bauer', 'Chen', 'Costa', 'Dubois', 'Evans', 'Fischer', 'Garcia', 'Haddad', 'Hansen', 'Ibrahim', 'Ito',
  'Jensen', 'Kim', 'Kowalski', 'Larsen', 'Lopez', 'Martin', 'Meyer', 'Nakamura', 'Novak', 'Okafor', 'Olsen', 'Patel', 'Quinn', 'Rossi',
  'Santos', 'Schmidt', 'Silva', 'Singh', 'Tanaka', 'Turner', 'Ullah', 'Vasquez', 'Weber', 'Wright', 'Yilmaz', 'Zhang',
];
export const CITIES = [
  'Amsterdam', 'Austin', 'Berlin', 'Bogotá', 'Boston', 'Cape Town', 'Chicago', 'Copenhagen', 'Dublin', 'Helsinki', 'Istanbul', 'Jakarta',
  'Lagos', 'Lima', 'Lisbon', 'London', 'Madrid', 'Melbourne', 'Mexico City', 'Montreal', 'Mumbai', 'Nairobi', 'Oslo', 'Paris', 'Prague',
  'Seoul', 'Singapore', 'Tokyo', 'Toronto', 'Vienna',
];
const STREETS = ['Oak', 'Maple', 'Cedar', 'Elm', 'Pine', 'Birch', 'Willow', 'Ash', 'Harbor', 'Ridge', 'Lake', 'Hill', 'Park', 'River', 'Mill'];
const STREET_TYPES = ['St', 'Ave', 'Rd', 'Ln', 'Blvd', 'Way', 'Dr'];
const DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.test', 'demo.dev'];

/** Deterministic 32-bit LCG. Seed text is hashed (FNV-1a) to the initial state. */
export class Rng {
  private state: number;
  constructor(seed: string) {
    let h = 0x811c9dc5;
    for (const ch of seed) {
      h ^= ch.codePointAt(0) as number;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    this.state = (h || 1) >>> 0;
  }
  /** [0, 1) */
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function words(rng: Rng, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(rng.pick(LOREM_WORDS));
  return out;
}

export function sentence(rng: Rng): string {
  const n = rng.int(6, 14);
  const ws = words(rng, n);
  if (n > 8 && rng.next() < 0.4) ws[rng.int(3, n - 3)] += ',';
  return cap(ws.join(' ')) + '.';
}

export function paragraph(rng: Rng, sentences = rng.int(3, 6)): string {
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) out.push(sentence(rng));
  return out.join(' ');
}

export function title(rng: Rng): string {
  const small = new Set(['et', 'ut', 'in', 'ad', 'ex', 'ea', 'do', 'id', 'at', 'non', 'sed', 'qui', 'cum']);
  return words(rng, rng.int(3, 7)).map((w, i) => (i > 0 && small.has(w) ? w : cap(w))).join(' ');
}

export function fullName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

export function email(rng: Rng, name = fullName(rng)): string {
  const [first, last] = name.toLowerCase().split(' ') as [string, string];
  const style = rng.int(0, 2);
  const local = style === 0 ? `${first}.${last}` : style === 1 ? `${first[0]}${last}` : `${first}${rng.int(1, 99)}`;
  return `${local}@${rng.pick(DOMAINS)}`;
}

export function address(rng: Rng): string {
  return `${rng.int(1, 9999)} ${rng.pick(STREETS)} ${rng.pick(STREET_TYPES)}, ${rng.pick(CITIES)} ${String(rng.int(10000, 99999))}`;
}

export interface FakeRecord {
  id: number;
  name: string;
  email: string;
  city: string;
  createdAt: string;
  active: boolean;
  score: number;
}

export function record(rng: Rng, id: number): FakeRecord {
  const name = fullName(rng);
  // Dates within 2020-01-01 .. 2025-12-31 UTC, whole seconds.
  const start = Date.UTC(2020, 0, 1);
  const end = Date.UTC(2025, 11, 31, 23, 59, 59);
  const t = start + Math.floor(rng.next() * (end - start));
  return {
    id,
    name,
    email: email(rng, name),
    city: rng.pick(CITIES),
    createdAt: new Date(Math.floor(t / 1000) * 1000).toISOString(),
    active: rng.next() < 0.7,
    score: Math.round(rng.next() * 10000) / 100,
  };
}

/** Random seed text (8 hex chars) from crypto. */
export function randomSeed(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
