/** Categories of personal or secret data replaced before a prompt leaves the platform. */
export const MASK_CATEGORIES = ['email', 'phone', 'ip', 'card', 'id', 'secret'] as const;
export type MaskCategory = (typeof MASK_CATEGORIES)[number];

const PATTERNS: Record<MaskCategory, RegExp> = {
  email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  // Keys and tokens: well-known prefixes, bearer tokens, long hex/base64-ish secrets after a keyword.
  secret:
    /\b(?:sk|pk|rk|isbp_sk|ghp|gho|xox[abpr]|AKIA)[-_][A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*|(?<=\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)\S{6,}/gi,
  card: /\b(?:\d[ -]?){13,19}\b/g,
  // Taiwan national ID, Japan My Number (12 digits), US SSN.
  id: /\b[A-Z][12]\d{8}\b|\b\d{4}[ -]?\d{4}[ -]?\d{4}\b|\b\d{3}-\d{2}-\d{4}\b/g,
  ip: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b|\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi,
  phone: /(?<![\w.:-])\+?\(?\d[\d\s()-]{7,}\d(?![\w.:])/g,
};

/** Order matters: secrets and emails before numbers so their digits are not split up. */
const ORDER: MaskCategory[] = ['secret', 'email', 'card', 'id', 'ip', 'phone'];

export interface MaskOptions {
  categories: readonly MaskCategory[];
  /** Extra admin-defined patterns (one regex each). */
  custom?: readonly RegExp[];
}

/**
 * Replaces sensitive values with stable placeholders (`[EMAIL_1]`) and returns a restorer for the
 * model's reply. One Masker per request: the same value always maps to the same placeholder.
 */
export class Masker {
  private readonly forward = new Map<string, string>();
  private readonly back = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  constructor(private readonly options: MaskOptions) {}

  get count(): number {
    return this.forward.size;
  }

  private placeholder(label: string, value: string): string {
    const known = this.forward.get(value);
    if (known) return known;
    const n = (this.counters.get(label) ?? 0) + 1;
    this.counters.set(label, n);
    const ph = `[${label}_${n}]`;
    this.forward.set(value, ph);
    this.back.set(ph, value);
    return ph;
  }

  mask(text: string): string {
    let out = text;
    for (const cat of ORDER) {
      if (!this.options.categories.includes(cat)) continue;
      out = out.replace(PATTERNS[cat], (m) => {
        if (cat === 'card' && !luhn(m)) return m;
        // Phones have 9+ digits; dates and times (2026-10-06, 09:30) are not phones.
        if (cat === 'phone' && (m.replace(/\D/g, '').length < 9 || /^\d{4}-\d{2}-\d{2}/.test(m.trim())))
          return m;
        return this.placeholder(cat.toUpperCase(), m);
      });
    }
    for (const re of this.options.custom ?? []) {
      out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), (m) =>
        this.placeholder('REDACTED', m),
      );
    }
    return out;
  }

  unmask(text: string): string {
    if (!this.back.size) return text;
    return text.replace(/\[[A-Z]+_\d+\]/g, (ph) => this.back.get(ph) ?? ph);
  }
}

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Parses the admin's custom patterns, skipping invalid ones. */
export function parseCustomPatterns(text: string | null | undefined): RegExp[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [new RegExp(l, 'g')];
      } catch {
        return [];
      }
    });
}
