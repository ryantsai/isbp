/**
 * Seeded randomness for flows. Every flow run gets its own generator, derived from the run's seed, the iteration and
 * the flow's name, so a run is reproducible whatever the concurrency (`--seed 42` makes the same choices again).
 * Unique suffixes also carry a per-run token, so records stay unique across runs against the same database.
 */

/** 32-bit FNV-1a of the parts (the seed of a derived generator). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('\u0001')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const EN_WORDS = [
  'printer',
  'laptop',
  'network',
  'switch',
  'firewall',
  'backup',
  'database',
  'mailbox',
  'license',
  'monitor',
  'keyboard',
  'server',
  'storage',
  'quota',
  'certificate',
  'gateway',
  'cluster',
  'patch',
  'release',
  'replica',
  'router',
  'tablet',
  'phone',
  'account',
  'password',
  'portal',
  'invoice',
  'report',
  'dashboard',
  'pipeline',
  'deployment',
  'timeout',
  'latency',
  'outage',
  'upgrade',
  'migration',
  'scanner',
  'projector',
  'headset',
  'docking',
  'wireless',
  'calendar',
  'archive',
  'export',
  'sync',
  'login',
  'badge',
  'cable',
  'rack',
  'power',
];
/** Some Traditional Chinese and Japanese, so search, sorting and rendering see more than ASCII. */
const ZH_WORDS = ['印表機', '網路', '筆電', '備份', '資料庫', '權限', '郵件', '螢幕', '伺服器', '帳號'];
const JA_WORDS = [
  'プリンター',
  'ネットワーク',
  'ノート PC',
  'バックアップ',
  'データベース',
  'メール',
  '権限',
];

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of a date (UTC). */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export class Rand {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private counter = 0;
  private readonly seed: number;

  /**
   * @param seed any number or string (hashed)
   * @param suffixBase prefix of {@link suffix}: unique per run, iteration and flow
   */
  constructor(
    seed: number | string,
    private readonly suffixBase = 'x',
  ) {
    const s = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    this.seed = s;
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = s;
    for (let i = 0; i < 15; i++) this.next();
  }

  /** A float in [0, 1) (sfc32). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** An integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`rand.int: max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  /** True with probability `p`. */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('rand.pick: empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** One of the values, by weight: `rand.weighted([['low', 3], ['high', 1]])`. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((n, [, w]) => n + w, 0);
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r < 0) return v;
    }
    return entries.at(-1)![0];
  }

  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Between `min` and `max` distinct items (as many as there are, at most). */
  sample<T>(items: readonly T[], min: number, max = min): T[] {
    const n = Math.min(items.length, this.int(Math.min(min, items.length), Math.min(max, items.length)));
    return this.shuffle(items).slice(0, n);
  }

  /** A word: mostly English, sometimes Traditional Chinese or Japanese. */
  word(): string {
    const r = this.next();
    if (r < 0.08) return this.pick(ZH_WORDS);
    if (r < 0.12) return this.pick(JA_WORDS);
    return this.pick(EN_WORDS);
  }

  /** `min`–`max` words separated by spaces. */
  words(min: number, max = min): string {
    return Array.from({ length: this.int(min, max) }, () => this.word()).join(' ');
  }

  /** A sentence of `min`–`max` words, capitalised, with a full stop. */
  sentence(min = 4, max = 12): string {
    const text = this.words(min, max);
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }

  paragraph(min = 2, max = 4): string {
    return Array.from({ length: this.int(min, max) }, () => this.sentence()).join(' ');
  }

  /**
   * A suffix unique to this run, iteration, flow and call (`k3x9a-7-q2a0`): lowercase letters, digits and dashes, so
   * it fits keys, usernames and search queries. Put it in names and titles, then find your records with `q`.
   */
  suffix(): string {
    return `${this.suffixBase}${(this.counter++).toString(36)}`;
  }

  /** `YYYY-MM-DD`, between `minDays` and `maxDays` from today (negative = past). */
  date(minDays: number, maxDays = minDays): string {
    return isoDate(new Date(Date.now() + this.int(minDays, maxDays) * DAY_MS));
  }

  /** A date range: starting in `startIn` days, lasting `length` days (0 = the same day). */
  dateRange(opts: { startIn: readonly [number, number]; length: readonly [number, number] }): {
    start: string;
    end: string;
  } {
    const startDays = this.int(opts.startIn[0], opts.startIn[1]);
    const endDays = startDays + this.int(opts.length[0], opts.length[1]);
    return {
      start: isoDate(new Date(Date.now() + startDays * DAY_MS)),
      end: isoDate(new Date(Date.now() + endDays * DAY_MS)),
    };
  }

  /** An ISO date-time between `minMinutes` and `maxMinutes` from now. */
  instant(minMinutes: number, maxMinutes = minMinutes): string {
    return new Date(Date.now() + this.int(minMinutes, maxMinutes) * 60_000).toISOString();
  }

  /** A child generator for `label`: the same for the same seed, however much this one has been used. */
  fork(label: string): Rand {
    return new Rand(hashSeed(this.seed, label), `${this.suffixBase}${label.slice(0, 1)}`);
  }
}
