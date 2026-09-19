/**
 * units.ts — table-driven unit conversion.
 *
 * What it implements
 * ------------------
 * - Categories: length, area, volume, mass, temperature, speed, time, data,
 *   angle, pressure, energy, power, frequency.
 * - Every unit is a linear factor to the category's base unit, except
 *   temperature which is affine (C/F/K/R) and handled with explicit
 *   to-Kelvin / from-Kelvin functions.
 * - Aliases are matched case-insensitively unless the case is what
 *   disambiguates (`mb` = megabyte vs `Mb` = megabit, `m` vs `M`): a
 *   case-sensitive match wins, then a case-insensitive one if unique.
 * - Numbers accept `1e6`, `-3.5`, `1,000` (thousands separators stripped).
 * - Formatting uses significant digits and trims trailing zeros.
 */

export type UnitCategory =
  | 'length' | 'area' | 'volume' | 'mass' | 'temperature' | 'speed' | 'time'
  | 'data' | 'angle' | 'pressure' | 'energy' | 'power' | 'frequency';

export interface UnitDef {
  /** Canonical symbol shown in output. */
  symbol: string;
  /** Human name. */
  name: string;
  /** Factor to the base unit (value * factor = base). Unused for temperature. */
  factor: number;
  aliases: string[];
}

interface CategoryDef {
  units: UnitDef[];
}

const u = (symbol: string, name: string, factor: number, ...aliases: string[]): UnitDef => ({ symbol, name, factor, aliases });

const CATEGORIES: Record<UnitCategory, CategoryDef> = {
  length: {
    units: [
      u('mm', 'millimetre', 0.001, 'millimeter', 'millimeters', 'millimetre', 'millimetres'),
      u('cm', 'centimetre', 0.01, 'centimeter', 'centimeters', 'centimetre', 'centimetres'),
      u('m', 'metre', 1, 'meter', 'meters', 'metre', 'metres'),
      u('km', 'kilometre', 1000, 'kilometer', 'kilometers', 'kilometre', 'kilometres'),
      u('in', 'inch', 0.0254, 'inch', 'inches', '"', '″'),
      u('ft', 'foot', 0.3048, 'foot', 'feet', "'", '′'),
      u('yd', 'yard', 0.9144, 'yard', 'yards'),
      u('mi', 'mile', 1609.344, 'mile', 'miles'),
      u('nmi', 'nautical mile', 1852, 'nautical mile', 'nautical miles', 'nm_nautical'),
      u('μm', 'micrometre', 1e-6, 'um', 'micron', 'microns', 'micrometer', 'micrometre', 'micrometers', 'micrometres'),
    ],
  },
  area: {
    units: [
      u('mm²', 'square millimetre', 1e-6, 'mm2', 'sqmm', 'square millimeter', 'square millimetre'),
      u('cm²', 'square centimetre', 1e-4, 'cm2', 'sqcm', 'square centimeter', 'square centimetre'),
      u('m²', 'square metre', 1, 'm2', 'sqm', 'square meter', 'square metre', 'square meters', 'square metres'),
      u('ha', 'hectare', 10000, 'hectare', 'hectares'),
      u('km²', 'square kilometre', 1e6, 'km2', 'sqkm', 'square kilometer', 'square kilometre'),
      u('in²', 'square inch', 0.00064516, 'in2', 'sqin', 'square inch', 'square inches'),
      u('ft²', 'square foot', 0.09290304, 'ft2', 'sqft', 'square foot', 'square feet'),
      u('yd²', 'square yard', 0.83612736, 'yd2', 'sqyd', 'square yard', 'square yards'),
      u('ac', 'acre', 4046.8564224, 'acre', 'acres'),
      u('mi²', 'square mile', 2589988.110336, 'mi2', 'sqmi', 'square mile', 'square miles'),
    ],
  },
  volume: {
    units: [
      u('mL', 'millilitre', 0.001, 'ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres', 'cc', 'cm3', 'cm³'),
      u('L', 'litre', 1, 'l', 'liter', 'litre', 'liters', 'litres'),
      u('m³', 'cubic metre', 1000, 'm3', 'cubic meter', 'cubic metre', 'cubic meters', 'cubic metres'),
      u('tsp', 'teaspoon', 0.00492892159375, 'teaspoon', 'teaspoons'),
      u('tbsp', 'tablespoon', 0.01478676478125, 'tablespoon', 'tablespoons'),
      u('fl oz', 'US fluid ounce', 0.0295735295625, 'floz', 'fl.oz', 'fluid ounce', 'fluid ounces'),
      u('cup', 'US cup', 0.2365882365, 'cups'),
      u('pt', 'US pint', 0.473176473, 'pint', 'pints'),
      u('qt', 'US quart', 0.946352946, 'quart', 'quarts'),
      u('gal', 'US gallon', 3.785411784, 'gallon', 'gallons'),
      u('ft³', 'cubic foot', 28.316846592, 'ft3', 'cubic foot', 'cubic feet'),
      u('in³', 'cubic inch', 0.016387064, 'in3', 'cubic inch', 'cubic inches'),
    ],
  },
  mass: {
    units: [
      u('mg', 'milligram', 1e-6, 'milligram', 'milligrams'),
      u('g', 'gram', 0.001, 'gram', 'grams', 'gramme', 'grammes'),
      u('kg', 'kilogram', 1, 'kilogram', 'kilograms', 'kilo', 'kilos'),
      u('t', 'tonne', 1000, 'tonne', 'tonnes', 'metric ton', 'metric tons'),
      u('oz', 'ounce', 0.028349523125, 'ounce', 'ounces'),
      u('lb', 'pound', 0.45359237, 'lbs', 'pound', 'pounds'),
      u('st', 'stone', 6.35029318, 'stone', 'stones'),
      u('ton', 'US ton', 907.18474, 'short ton', 'short tons', 'us ton', 'us tons'),
    ],
  },
  temperature: {
    units: [
      u('°C', 'Celsius', 1, 'c', 'celsius', 'centigrade', 'degc', '°c', 'deg c'),
      u('°F', 'Fahrenheit', 1, 'f', 'fahrenheit', 'degf', '°f', 'deg f'),
      u('K', 'Kelvin', 1, 'k', 'kelvin', 'kelvins'),
      u('°R', 'Rankine', 1, 'r', 'rankine', 'degr', '°r', 'deg r', 'ra'),
    ],
  },
  speed: {
    units: [
      u('m/s', 'metre per second', 1, 'mps', 'meters per second', 'metres per second', 'm/sec'),
      u('km/h', 'kilometre per hour', 1000 / 3600, 'kmh', 'kph', 'kmph', 'km/hr', 'kilometers per hour', 'kilometres per hour'),
      u('mph', 'mile per hour', 1609.344 / 3600, 'mi/h', 'miles per hour'),
      u('ft/s', 'foot per second', 0.3048, 'fps', 'ft/sec', 'feet per second'),
      u('kn', 'knot', 1852 / 3600, 'kt', 'kts', 'knot', 'knots'),
      u('Mach', 'Mach (sea level)', 340.29, 'mach'),
    ],
  },
  time: {
    units: [
      u('ns', 'nanosecond', 1e-9, 'nanosecond', 'nanoseconds'),
      u('μs', 'microsecond', 1e-6, 'us', 'microsecond', 'microseconds'),
      u('ms', 'millisecond', 1e-3, 'millisecond', 'milliseconds', 'msec'),
      u('s', 'second', 1, 'sec', 'secs', 'second', 'seconds'),
      u('min', 'minute', 60, 'mins', 'minute', 'minutes'),
      u('h', 'hour', 3600, 'hr', 'hrs', 'hour', 'hours'),
      u('d', 'day', 86400, 'day', 'days'),
      u('wk', 'week', 604800, 'week', 'weeks'),
      u('mo', 'month (30d)', 2592000, 'month', 'months'),
      u('yr', 'year (365d)', 31536000, 'y', 'year', 'years'),
    ],
  },
  data: {
    units: [
      u('bit', 'bit', 1, 'b', 'bits'),
      u('B', 'byte', 8, 'byte', 'bytes'),
      u('kb', 'kilobit', 1e3, 'kbit', 'kilobit', 'kilobits'),
      u('kB', 'kilobyte', 8e3, 'KB', 'kilobyte', 'kilobytes'),
      u('Mb', 'megabit', 1e6, 'mbit', 'megabit', 'megabits'),
      u('MB', 'megabyte', 8e6, 'megabyte', 'megabytes'),
      u('Gb', 'gigabit', 1e9, 'gbit', 'gigabit', 'gigabits'),
      u('GB', 'gigabyte', 8e9, 'gigabyte', 'gigabytes'),
      u('Tb', 'terabit', 1e12, 'tbit', 'terabit', 'terabits'),
      u('TB', 'terabyte', 8e12, 'terabyte', 'terabytes'),
      u('KiB', 'kibibyte', 8 * 1024, 'kibibyte', 'kibibytes'),
      u('MiB', 'mebibyte', 8 * 1024 ** 2, 'mebibyte', 'mebibytes'),
      u('GiB', 'gibibyte', 8 * 1024 ** 3, 'gibibyte', 'gibibytes'),
      u('TiB', 'tebibyte', 8 * 1024 ** 4, 'tebibyte', 'tebibytes'),
      u('Kib', 'kibibit', 1024, 'kibit', 'kibibit', 'kibibits'),
      u('Mib', 'mebibit', 1024 ** 2, 'mibit', 'mebibit', 'mebibits'),
      u('Gib', 'gibibit', 1024 ** 3, 'gibit', 'gibibit', 'gibibits'),
    ],
  },
  angle: {
    units: [
      u('°', 'degree', 1, 'deg', 'degree', 'degrees'),
      u('rad', 'radian', 180 / Math.PI, 'radian', 'radians'),
      u('grad', 'gradian', 0.9, 'gon', 'gradian', 'gradians'),
      u('turn', 'turn', 360, 'turns', 'rev', 'revolution', 'revolutions'),
      u('arcmin', 'arcminute', 1 / 60, 'arcminute', 'arcminutes', 'moa'),
      u('arcsec', 'arcsecond', 1 / 3600, 'arcsecond', 'arcseconds'),
    ],
  },
  pressure: {
    units: [
      u('Pa', 'pascal', 1, 'pa', 'pascal', 'pascals'),
      u('hPa', 'hectopascal', 100, 'hpa', 'hectopascal', 'hectopascals'),
      u('kPa', 'kilopascal', 1000, 'kpa', 'kilopascal', 'kilopascals'),
      u('MPa', 'megapascal', 1e6, 'mpa', 'megapascal', 'megapascals'),
      u('bar', 'bar', 1e5, 'bars'),
      u('mbar', 'millibar', 100, 'millibar', 'millibars'),
      u('atm', 'atmosphere', 101325, 'atmosphere', 'atmospheres'),
      u('psi', 'pound per square inch', 6894.757293168, 'lbf/in2', 'lbf/in²'),
      u('mmHg', 'millimetre of mercury', 133.322387415, 'mmhg', 'torr'),
      u('inHg', 'inch of mercury', 3386.389, 'inhg'),
    ],
  },
  energy: {
    units: [
      u('J', 'joule', 1, 'j', 'joule', 'joules'),
      u('kJ', 'kilojoule', 1000, 'kj', 'kilojoule', 'kilojoules'),
      u('MJ', 'megajoule', 1e6, 'mj', 'megajoule', 'megajoules'),
      u('cal', 'calorie', 4.184, 'calorie', 'calories'),
      u('kcal', 'kilocalorie', 4184, 'kilocalorie', 'kilocalories', 'Cal'),
      u('Wh', 'watt-hour', 3600, 'wh', 'watt hour', 'watt-hour', 'watt hours'),
      u('kWh', 'kilowatt-hour', 3.6e6, 'kwh', 'kilowatt hour', 'kilowatt-hour', 'kilowatt hours'),
      u('eV', 'electronvolt', 1.602176634e-19, 'ev', 'electronvolt', 'electronvolts'),
      u('BTU', 'British thermal unit', 1055.05585262, 'btu', 'btus'),
      u('ft·lbf', 'foot-pound', 1.3558179483314004, 'ftlb', 'ft-lb', 'ft·lb', 'foot-pound', 'foot pound', 'foot-pounds'),
    ],
  },
  power: {
    units: [
      u('mW', 'milliwatt', 0.001, 'mw', 'milliwatt', 'milliwatts'),
      u('W', 'watt', 1, 'w', 'watt', 'watts'),
      u('kW', 'kilowatt', 1000, 'kw', 'kilowatt', 'kilowatts'),
      u('MW', 'megawatt', 1e6, 'megawatt', 'megawatts'),
      u('hp', 'horsepower (mechanical)', 745.69987158227, 'horsepower', 'bhp'),
      u('PS', 'metric horsepower', 735.49875, 'ps', 'metric horsepower'),
      u('BTU/h', 'BTU per hour', 0.29307107, 'btu/h', 'btu/hr', 'btuh'),
    ],
  },
  frequency: {
    units: [
      u('Hz', 'hertz', 1, 'hz', 'hertz', '1/s'),
      u('kHz', 'kilohertz', 1e3, 'khz', 'kilohertz'),
      u('MHz', 'megahertz', 1e6, 'mhz', 'megahertz'),
      u('GHz', 'gigahertz', 1e9, 'ghz', 'gigahertz'),
      u('rpm', 'revolutions per minute', 1 / 60, 'r/min', 'rev/min'),
      u('bpm', 'beats per minute', 1 / 60, 'beats per minute'),
    ],
  },
};

export const UNIT_CATEGORIES = Object.keys(CATEGORIES) as UnitCategory[];

export function unitsOf(category: UnitCategory): UnitDef[] {
  return CATEGORIES[category].units;
}

export interface UnitMatch {
  category: UnitCategory;
  unit: UnitDef;
}

interface IndexEntry extends UnitMatch {
  key: string;
}

const INDEX: IndexEntry[] = (() => {
  const out: IndexEntry[] = [];
  for (const category of UNIT_CATEGORIES) {
    for (const unit of CATEGORIES[category].units) {
      out.push({ key: unit.symbol, category, unit });
      for (const a of unit.aliases) out.push({ key: a, category, unit });
    }
  }
  return out;
})();

/**
 * Look a unit up by symbol or alias. Exact (case-sensitive) matches win;
 * otherwise a case-insensitive match is accepted when it is unambiguous.
 * `within` restricts the search to one category (used for the `target`).
 */
export function findUnit(name: string, within?: UnitCategory): UnitMatch | null {
  const q = name.trim().replace(/\s+/g, ' ');
  if (q === '') return null;
  const pool = within ? INDEX.filter((e) => e.category === within) : INDEX;
  const exact = pool.find((e) => e.key === q);
  if (exact) return { category: exact.category, unit: exact.unit };
  const lower = q.toLowerCase();
  const ci = pool.filter((e) => e.key.toLowerCase() === lower);
  const distinct = new Set(ci.map((e) => `${e.category}/${e.unit.symbol}`));
  if (distinct.size === 1) return { category: ci[0]!.category, unit: ci[0]!.unit };
  return null;
}

/** Levenshtein distance, for "did you mean" hints. */
function distance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Up to `n` closest known unit names (symbols and aliases) to `name`. */
export function closestUnits(name: string, n = 5): string[] {
  const q = name.toLowerCase();
  const scored = new Map<string, number>();
  for (const e of INDEX) {
    const d = distance(q, e.key.toLowerCase());
    const cur = scored.get(e.unit.symbol);
    if (cur === undefined || d < cur) scored.set(e.unit.symbol, d);
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map((e) => e[0]);
}

/* ------------------------------------------------------------ temperature */

function toKelvin(v: number, symbol: string): number {
  switch (symbol) {
    case '°C': return v + 273.15;
    case '°F': return ((v - 32) * 5) / 9 + 273.15;
    case '°R': return (v * 5) / 9;
    default: return v;
  }
}

function fromKelvin(k: number, symbol: string): number {
  switch (symbol) {
    case '°C': return k - 273.15;
    case '°F': return ((k - 273.15) * 9) / 5 + 32;
    case '°R': return (k * 9) / 5;
    default: return k;
  }
}

/** Convert `value` from one unit to another in the same category. */
export function convert(value: number, from: UnitMatch, to: UnitDef): number {
  if (from.category === 'temperature') return fromKelvin(toKelvin(value, from.unit.symbol), to.symbol);
  return (value * from.unit.factor) / to.factor;
}

/* ----------------------------------------------------------------- parse */

export class UnitError extends Error {
  constructor(message: string, public line: number, public col: number, public hint: string) {
    super(message);
  }
}

export interface Quantity {
  value: number;
  raw: string;
  match: UnitMatch;
}

const NUMBER_RE = /^([-+]?(?:\d[\d,_]*\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(.*)$/;

/** Parse `12 km`, `3.5GiB`, `72 °F`, `1e6 ms`, `5'`. */
export function parseQuantity(text: string, line = 1): Quantity {
  const trimmed = text.trim();
  const col = text.indexOf(trimmed) + 1;
  const m = NUMBER_RE.exec(trimmed);
  if (!m) throw new UnitError(`Expected a number followed by a unit, got "${trimmed}"`, line, col, 'Write the quantity as `<number> <unit>`, e.g. `12 km` or `3.5 GiB`.');
  const value = Number(m[1]!.replace(/[,_]/g, ''));
  const unitText = m[2]!.trim();
  if (!Number.isFinite(value)) throw new UnitError(`"${m[1]}" is not a finite number`, line, col, 'Use a plain decimal or scientific notation like 1e6.');
  if (unitText === '') throw new UnitError(`Missing unit after "${m[1]}"`, line, col + m[1]!.length, 'Add a unit, e.g. `km`, `lb`, `°F`, `GiB`.');
  const match = findUnit(unitText);
  if (!match) {
    const near = closestUnits(unitText);
    throw new UnitError(`Unknown unit "${unitText}"`, line, col + m[0].indexOf(m[2]!), `Closest known units: ${near.join(', ')}.`);
  }
  return { value, raw: m[1]!, match };
}

/* ---------------------------------------------------------------- format */

/** Format with `sig` significant digits, trimming trailing zeros, plain notation where sensible. */
export function formatNumber(v: number, sig: number): string {
  if (v === 0) return '0';
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 1e15 || abs < 1e-6) {
    return Number(v.toExponential(sig - 1)).toExponential().replace(/e\+/, 'e');
  }
  const s = Number(v.toPrecision(sig));
  // toPrecision may yield exponent form for large numbers; go through toFixed when needed.
  const str = String(s);
  if (/e/i.test(str)) {
    const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
    return s.toFixed(digits).replace(/\.?0+$/, '');
  }
  return str;
}
