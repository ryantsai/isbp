/**
 * Value conversions between a remote field and a local field (docs/architecture.md §12.4). Remote HTML is
 * untrusted: it is converted to Markdown or text, never rendered, and scripts, styles and embedded content
 * are dropped. Markdown pushed out is rendered with raw HTML escaped and only http(s)/mailto links kept.
 *
 * The pure helpers are exported for tests; `toLocal`/`toRemote` take a resolver for the two conversions
 * that need data (people by email, parents through the link table).
 */
import { Marked, type Tokens } from 'marked';
import TurndownService from 'turndown';
import type { FieldMapping } from '../contracts';
import { normalize } from '../merge';
import { type FieldType, isEmpty, isTextual, rowsFor } from '../model';

/** The value can't be converted (unknown person, unmapped choice, unlinked parent): skip the field. */
export const UNMAPPABLE: unique symbol = Symbol('unmappable');
export type Converted = unknown | typeof UNMAPPABLE;

/* ───────────────────────────── HTML / Markdown / text ───────────────────────────── */

const DROPPED_ELEMENTS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'head',
  'meta',
  'link',
  'title',
] as const;

const SAFE_HREF = /^(https?:|mailto:)/i;

let turndown: TurndownService | null = null;
function turndownService(): TurndownService {
  if (turndown) return turndown;
  const s = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
  });
  s.remove([...DROPPED_ELEMENTS] as never);
  const attr = (node: unknown, name: string) =>
    (node as { getAttribute(n: string): string | null }).getAttribute(name) ?? '';
  // Links and images to anything but http(s)/mailto keep only their text.
  s.addRule('unsafeLink', {
    filter: (node) => node.nodeName === 'A' && !SAFE_HREF.test(attr(node, 'href')),
    replacement: (content) => content,
  });
  s.addRule('unsafeImage', {
    filter: (node) => node.nodeName === 'IMG' && !/^https?:/i.test(attr(node, 'src')),
    replacement: (_content, node) => attr(node, 'alt'),
  });
  turndown = s;
  return s;
}

/** Remote HTML → Markdown (scripts, styles and embedded content dropped). */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  return turndownService()
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Remote HTML → plain text: block elements become line breaks, everything else is dropped. */
export function htmlToText(html: string): string {
  if (!html.trim()) return '';
  let s = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROPPED_ELEMENTS)
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|blockquote|pre|section|article|table|ul|ol)\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(s)
    .replace(/[ \t\u00a0]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text → HTML: escaped, paragraphs and line breaks kept. */
export function textToHtml(text: string): string {
  if (!text.trim()) return '';
  return text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    // Raw HTML in Markdown is shown as text, never passed on.
    html({ text }) {
      return escapeHtml(text);
    },
    link(token: Tokens.Link) {
      if (SAFE_HREF.test(token.href)) return false;
      return this.parser.parseInline(token.tokens);
    },
    image(token: Tokens.Image) {
      if (/^https?:/i.test(token.href)) return false;
      return escapeHtml(token.text);
    },
  },
});

/** ISBP Markdown → HTML for a remote system (raw HTML escaped, unsafe links dropped). */
export function markdownToHtml(md: string): string {
  if (!md.trim()) return '';
  return (markdown.parse(md.replace(/\r\n?/g, '\n')) as string).trim();
}

/* ───────────────────────────── other shapes ───────────────────────────── */

export function splitTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(';') : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    const t = (typeof x === 'string' ? x : String(x ?? '')).trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

export const joinTags = (tags: readonly string[]) => tags.join('; ');

/** `YYYY-MM-DD` → midnight UTC. */
export function dateToDateTime(d: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : null;
}

/** ISO date-time → its UTC calendar day. */
export function dateTimeToDate(dt: string): string | null {
  const ms = Date.parse(dt);
  return Number.isNaN(ms)
    ? /^\d{4}-\d{2}-\d{2}/.test(dt)
      ? dt.slice(0, 10)
      : null
    : new Date(ms).toISOString().slice(0, 10);
}

type ValueMap = FieldMapping['values'];

/** A remote choice → the local choice: the value map's pull rows, then an identical choice (case-insensitive). */
export function choiceToLocal(
  value: string,
  map: ValueMap,
  localChoices: readonly { value: string }[] | undefined,
): Converted {
  const v = value.trim();
  const mapped = rowsFor(map, 'pull').find((m) => m.remote.toLowerCase() === v.toLowerCase());
  if (mapped) return mapped.local;
  if (!localChoices) return v;
  return localChoices.find((c) => c.value.toLowerCase() === v.toLowerCase())?.value ?? UNMAPPABLE;
}

/** A local choice → the remote choice: the value map's push rows read backwards, then an identical choice. */
export function choiceToRemote(
  value: string,
  map: ValueMap,
  remoteChoices: readonly { value: string }[] | undefined,
): Converted {
  const v = value.trim();
  const mapped = rowsFor(map, 'push').find((m) => m.local.toLowerCase() === v.toLowerCase());
  if (mapped) return mapped.remote;
  if (!remoteChoices?.length) return v;
  return remoteChoices.find((c) => c.value.toLowerCase() === v.toLowerCase())?.value ?? UNMAPPABLE;
}

/* ───────────────────────────── field conversion ───────────────────────────── */

export interface FieldShape {
  key: string;
  type: FieldType;
  choices?: { value: string }[];
  maxLength?: number;
}

export interface RemotePerson {
  email: string | null;
  name: string;
  id?: string | null;
}

/** The data lookups conversions need. */
export interface ConvertResolver {
  /** Active local user by email (case-insensitive). */
  userIdByEmail(email: string): Promise<string | null>;
  user(id: string): Promise<{ email: string; name: string } | null>;
  /** Local id of the record linked to a remote id (same connection and entity). */
  localParent(remoteId: string): Promise<string | null>;
  remoteParent(localId: string): Promise<string | null>;
}

const asString = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'string'
      ? v
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);

function fit(s: string, maxLength?: number): string {
  if (!maxLength || s.length <= maxLength) return s;
  return `${s.slice(0, Math.max(0, maxLength - 1))}…`;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

function personOf(v: unknown): RemotePerson | null {
  if (!v) return null;
  if (typeof v === 'string')
    return v.includes('@') ? { email: v.trim(), name: v.trim() } : { email: null, name: v };
  if (typeof v === 'object') {
    const p = v as Partial<RemotePerson>;
    return {
      email: typeof p.email === 'string' ? p.email : null,
      name: String(p.name ?? p.email ?? ''),
      id: p.id ?? null,
    };
  }
  return null;
}

/** Text of one textual type → another (HTML only ever leaves as text or Markdown). */
function textToText(s: string, from: FieldType, to: FieldType): string {
  if (from === to) return s;
  if (from === 'html') return to === 'markdown' ? htmlToMarkdown(s) : htmlToText(s);
  if (to === 'html') return from === 'markdown' ? markdownToHtml(s) : textToHtml(s);
  return s;
}

/**
 * A remote value (in the remote field's shape) → the local field's shape. `UNMAPPABLE` when it can't be
 * represented (the caller skips the field and logs why).
 */
export async function toLocal(
  value: unknown,
  remote: FieldShape,
  local: FieldShape,
  mapping: Pick<FieldMapping, 'values'>,
  r: ConvertResolver,
): Promise<Converted> {
  if (isEmpty(value)) return local.type === 'tags' ? [] : null;
  switch (local.type) {
    case 'string':
    case 'text':
    case 'markdown':
    case 'html': {
      let s: string;
      if (isTextual(remote.type)) s = textToText(asString(value), remote.type, local.type);
      else if (remote.type === 'user') s = personOf(value)?.email ?? personOf(value)?.name ?? '';
      else if (remote.type === 'tags') s = joinTags(splitTags(value));
      else if (remote.type === 'choice')
        s = asString(choiceToLocal(asString(value), mapping.values, undefined));
      else s = asString(value);
      if (local.type === 'string') s = oneLine(s);
      return fit(s, local.maxLength);
    }
    case 'choice':
      return choiceToLocal(asString(value), mapping.values, local.choices);
    case 'tags':
      return splitTags(value);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(asString(value).replace(/,/g, ''));
      return Number.isFinite(n) ? n : UNMAPPABLE;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      return ['true', '1', 'yes', 'y'].includes(asString(value).trim().toLowerCase());
    case 'date': {
      const s = asString(value);
      return remote.type === 'date' ? s.slice(0, 10) : (dateTimeToDate(s) ?? UNMAPPABLE);
    }
    case 'datetime': {
      const s = asString(value);
      if (remote.type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(s))
        return dateToDateTime(s.slice(0, 10)) ?? UNMAPPABLE;
      const ms = Date.parse(s);
      return Number.isNaN(ms) ? UNMAPPABLE : new Date(ms).toISOString();
    }
    case 'user': {
      const p = personOf(value);
      if (!p?.email) return UNMAPPABLE;
      return (await r.userIdByEmail(p.email)) ?? UNMAPPABLE;
    }
    case 'parent':
      return (await r.localParent(asString(value))) ?? UNMAPPABLE;
    case 'json':
      if (typeof value === 'string' && remote.type !== 'json') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
  }
}

/** A local value → the remote field's shape (people as `{ email, name }`, parents as remote ids). */
export async function toRemote(
  value: unknown,
  local: FieldShape,
  remote: FieldShape,
  mapping: Pick<FieldMapping, 'values'>,
  r: ConvertResolver,
): Promise<Converted> {
  if (isEmpty(value)) return remote.type === 'tags' ? [] : null;
  switch (remote.type) {
    case 'string':
    case 'text':
    case 'markdown':
    case 'html': {
      if (isTextual(local.type)) {
        const s = textToText(asString(value), local.type, remote.type);
        return remote.type === 'string' ? oneLine(s) : s;
      }
      if (local.type === 'user') return (await r.user(asString(value)))?.email ?? UNMAPPABLE;
      if (local.type === 'tags') return joinTags(splitTags(value));
      if (local.type === 'choice') return choiceToRemote(asString(value), mapping.values, remote.choices);
      return asString(value);
    }
    case 'choice':
      return choiceToRemote(asString(value), mapping.values, remote.choices);
    case 'tags':
      return splitTags(value);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(asString(value));
      return Number.isFinite(n) ? n : UNMAPPABLE;
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? value
        : ['true', '1', 'yes'].includes(asString(value).toLowerCase());
    case 'date':
      return local.type === 'date'
        ? asString(value).slice(0, 10)
        : (dateTimeToDate(asString(value)) ?? UNMAPPABLE);
    case 'datetime': {
      const s = asString(value);
      if (local.type === 'date') return dateToDateTime(s.slice(0, 10)) ?? UNMAPPABLE;
      const ms = Date.parse(s);
      return Number.isNaN(ms) ? UNMAPPABLE : new Date(ms).toISOString();
    }
    case 'user': {
      if (local.type !== 'user') {
        const s = asString(value).trim();
        return s.includes('@') ? { email: s, name: s, id: null } : UNMAPPABLE;
      }
      const u = await r.user(asString(value));
      return u ? { email: u.email, name: u.name, id: null } : UNMAPPABLE;
    }
    case 'parent':
      return (await r.remoteParent(asString(value))) ?? UNMAPPABLE;
    case 'json':
      return value;
  }
}

/** For logs and previews: a short, single-line rendering of a value. */
export function display(type: FieldType, v: unknown, max = 200): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'user' && typeof v === 'object') {
    const p = personOf(v);
    return p ? (p.email ? `${p.name} <${p.email}>`.trim() : p.name) : null;
  }
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max - 1)}…` : v;
  if (Array.isArray(v) || typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max - 1)}…` : v;
  }
  return normalize(type, v) === null ? null : v;
}
