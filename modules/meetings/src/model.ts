/**
 * Pure meeting logic shared by the API, the pages and the tests (Phase 11, `docs/architecture.md` §17.4–17.5):
 * vocabularies, references (`MTG-00042`) and the builtin minutes organiser, which reads the notes' own markers in
 * English, Traditional Chinese and Japanese (actions, decisions, questions, owners and due dates). No I/O, no clock.
 */

/* ───────────────────────────── permissions and vocabularies ───────────────────────────── */

export const PERMISSIONS = {
  /** Record meetings, see the ones you may (internal ones, ones you attend), work on your action items. */
  use: 'meetings.meetings.use',
  /** See every meeting, private ones included (auditors, the PMO). */
  read: 'meetings.meetings.read',
  /** Manage every meeting. */
  admin: 'meetings.meetings.admin',
} as const;

export const MEETING_STATUSES = ['draft', 'published'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** `private`: attendees (and readers of all meetings); `internal`: everyone who uses Meetings. */
export const VISIBILITIES = ['private', 'internal'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const ITEM_STATUSES = ['open', 'done', 'cancelled'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Where an action item is worked on: tracked here, or as a task in a project. */
export const DESTINATIONS = ['meeting', 'task'] as const;
export type Destination = (typeof DESTINATIONS)[number];

/** Why routing an item to a project task didn't happen (it stays a meeting item). */
export const ROUTE_ERRORS = ['forbidden', 'not_found', 'invalid', 'unavailable', 'failed'] as const;
export type RouteError = (typeof ROUTE_ERRORS)[number];

export const MAX_ATTENDEES = 100;
export const MAX_ITEMS = 100;
export const MAX_DECISIONS = 50;

/* ───────────────────────────── references ───────────────────────────── */

export const formatMeetingRef = (number: number) => `MTG-${String(number).padStart(5, '0')}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

/** `MTG-00042` (any case, padding optional) → `{ number }`, a uuid → `{ id }`, anything else → null. */
export function parseMeetingRef(value: string): { number: number } | { id: string } | null {
  const v = value.trim();
  if (isUuid(v)) return { id: v.toLowerCase() };
  const m = /^MTG-(\d{1,9})$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? { number: n } : null;
}

/* ───────────────────────────── dates ───────────────────────────── */

const day = (v: string) => new Date(`${v}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(value: string, days: number): string {
  const d = day(value);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}
/** 0 = Monday … 6 = Sunday. */
const weekdayOf = (v: string) => (day(v).getUTCDay() + 6) % 7;

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? iso(dt) : null;
}

/** A month and day without a year: this year's, or next year's when that is long past. */
function nearYear(month: number, dayOfMonth: number, base: string): string | null {
  const year = Number(base.slice(0, 4));
  const date = validDate(year, month, dayOfMonth);
  if (!date) return null;
  return date < addDays(base, -60) ? validDate(year + 1, month, dayOfMonth) : date;
}

/** The weekday (0 = Monday) on or after tomorrow; `nextWeek` picks the one in the following ISO week. */
function upcoming(base: string, weekday: number, nextWeek = false): string {
  if (nextWeek) return addDays(base, 7 - weekdayOf(base) + weekday);
  let d = addDays(base, 1);
  while (weekdayOf(d) !== weekday) d = addDays(d, 1);
  return d;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES =
  'january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec';
const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const EN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const dayOf = (name: string) => EN_DAYS.indexOf(name.slice(0, 3).toLowerCase());
const BY = String.raw`(?:\b(?:by|due|before|until|on)\s+)?`;
const ZH_DAYS = '一二三四五六日';
const JA_DAYS = '月火水木金土日';

interface DueRule {
  re: RegExp;
  date: (m: RegExpExecArray, base: string) => string | null;
}

/** Phrases giving a due date, most specific first. Each also swallows a leading "by" / trailing "前", "まで". */
const DUE_RULES: DueRule[] = [
  {
    re: /(?:\b(?:by|due|before|until|on)\s+)?(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s*(?:前|之前|まで))?/i,
    date: (m) => validDate(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    re: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]?(?:\s*(?:之前|前|までに|まで))?/,
    date: (m, b) => nearYear(Number(m[1]), Number(m[2]), b),
  },
  {
    re: /(?:\b(?:by|due|before|until|on)\s+)?\b(\d{1,2})\/(\d{1,2})(?!\/|\d)(?:\s*(?:前|之前|まで))?/i,
    date: (m, b) => nearYear(Number(m[1]), Number(m[2]), b),
  },
  {
    re: new RegExp(String.raw`${BY}\b(${MONTH_NAMES})\.?\s+(\d{1,2})\b`, 'i'),
    date: (m, b) => nearYear(monthOf(m[1]!), Number(m[2]), b),
  },
  {
    re: new RegExp(String.raw`${BY}\b(\d{1,2})\s+(${MONTH_NAMES})\b\.?`, 'i'),
    date: (m, b) => nearYear(monthOf(m[2]!), Number(m[1]), b),
  },
  {
    // Full weekday names on their own; abbreviations only after "by", "on", "due"… ("monitor" is not a Monday).
    re: /(?:\b(?:by|due|before|until|on)\s+)?\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    date: (m, b) => upcoming(b, dayOf(m[2]!), Boolean(m[1])),
  },
  {
    re: /\b(?:by|due|before|until|on)\s+(next\s+)?(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\b\.?/i,
    date: (m, b) => upcoming(b, dayOf(m[2]!), Boolean(m[1])),
  },
  {
    re: /(下)?(?:個)?(?:週|周|星期|禮拜|礼拜)([一二三四五六日天])(?:\s*(?:前|之前))?/,
    date: (m, b) => upcoming(b, m[2] === '天' ? 6 : ZH_DAYS.indexOf(m[2]!), Boolean(m[1])),
  },
  {
    re: /(来週の?)?([月火水木金土日])曜日?(?:\s*(?:までに|まで))?/,
    date: (m, b) => upcoming(b, JA_DAYS.indexOf(m[2]!), Boolean(m[1])),
  },
  { re: /\b(?:by\s+)?tomorrow\b|明天|明日まで|明日/i, date: (_m, b) => addDays(b, 1) },
  {
    re: /\b(?:by\s+)?(?:end of (?:the )?week|eow|this week)\b|本週|這週|这周|今週中|今週/i,
    date: (_m, b) => upcoming(addDays(b, -1), 4),
  },
  { re: /\b(?:by\s+)?next week\b|下週|下周|来週中|来週/i, date: (_m, b) => upcoming(b, 4, true) },
  {
    re: /\b(?:by\s+)?(?:end of (?:the )?month|eom)\b|月底|月末/i,
    date: (_m, b) => {
      const d = day(b);
      return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    },
  },
  {
    re: /\bin\s+(\d{1,3})\s+days?\b|(\d{1,3})\s*天內|(\d{1,3})\s*天内|(\d{1,3})\s*日以内/i,
    date: (m, b) => addDays(b, Number(m[1] ?? m[2] ?? m[3] ?? m[4])),
  },
];

/** The first due date a phrase in `text` gives (relative to the meeting's date), and the text without it. */
export function parseDue(text: string, meetingDate: string): { date: string | null; rest: string } {
  for (const rule of DUE_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const date = rule.date(m, meetingDate);
    if (!date) continue;
    return { date, rest: tidy(text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)) };
  }
  return { date: null, rest: text };
}

/* ───────────────────────────── owners ───────────────────────────── */

export interface Attendee {
  id: string;
  name: string;
  email?: string | null;
  username?: string | null;
}

const lower = (s: string) => s.toLocaleLowerCase();

/** The names someone may be called in notes: display name, username, email name, and a Latin first or last name. */
function namesOf(a: Attendee): string[] {
  const out = new Set<string>([a.name]);
  if (a.username) out.add(a.username);
  if (a.email) out.add(a.email.split('@')[0]!);
  const words = a.name.split(/\s+/).filter(Boolean);
  if (words.length > 1)
    for (const w of [words[0]!, words.at(-1)!]) if (/^[\p{Script=Latin}'.-]{3,}$/u.test(w)) out.add(w);
  return [...out].filter((n) => n.length >= 2).sort((x, y) => y.length - x.length);
}

/** The attendee a name at the start of `text` refers to (longest name first), with the length matched. */
function attendeeAt(
  text: string,
  attendees: readonly Attendee[],
): { attendee: Attendee; length: number } | null {
  const t = lower(text);
  let best: { attendee: Attendee; length: number } | null = null;
  for (const a of attendees)
    for (const n of namesOf(a)) {
      const ln = lower(n);
      if (!t.startsWith(ln)) continue;
      // A Latin name must end at a word boundary ("Mei" doesn't match "Meijer").
      const next = text[n.length];
      if (next && /[\p{Script=Latin}\d]/u.test(n.at(-1)!) && /[\p{Script=Latin}\d]/u.test(next)) continue;
      if (!best || n.length > best.length) best = { attendee: a, length: n.length };
    }
  return best;
}

/**
 * Who an action is for: `@name`, `Owner: name` / `負責：name` / `担当：name`, `(name)`, a leading `name:` or
 * `name will/to …`, else an attendee's full name anywhere. Returns the owner (or a hint for a name nobody attending
 * has) and the text without the owner's part.
 */
export function matchOwner(
  text: string,
  attendees: readonly Attendee[],
): { ownerId: string | null; ownerHint: string | null; rest: string } {
  const found = (a: Attendee, start: number, end: number) => ({
    ownerId: a.id,
    ownerHint: null,
    rest: tidy(text.slice(0, start) + ' ' + text.slice(end)),
  });

  const mention = /@([^\s@,，、。:：()（）]+(?:\s[^\s@,，、。:：()（）]+)?)/u.exec(text);
  if (mention) {
    const hit = attendeeAt(mention[1]!, attendees);
    if (hit) return found(hit.attendee, mention.index, mention.index + 1 + hit.length);
  }

  const labelled = /(?:\bowners?|負責人?|负责人?|担当者?|担当)\s*[:：]\s*/iu.exec(text);
  if (labelled) {
    const start = labelled.index + labelled[0].length;
    const hit = attendeeAt(text.slice(start), attendees);
    if (hit) return found(hit.attendee, labelled.index, start + hit.length);
  }

  const bracket = /[(（[]\s*([^()（）[\]]{2,40}?)\s*[)）\]]/u.exec(text);
  if (bracket) {
    const hit = attendeeAt(bracket[1]!, attendees);
    if (hit && hit.length === bracket[1]!.length)
      return found(hit.attendee, bracket.index, bracket.index + bracket[0].length);
  }

  const lead = attendeeAt(text, attendees);
  if (lead) {
    const after = text.slice(lead.length);
    const join =
      /^\s*(?:[:：,，]|\s+(?:will|to|shall|should|must)\b|\s*(?:負責|负责|會|将|將|が|は)|\s+)\s*/iu.exec(
        after,
      );
    if (join) return found(lead.attendee, 0, lead.length + join[0].length);
  }

  const t = lower(text);
  let best: { a: Attendee; n: string } | null = null;
  for (const a of attendees) {
    const n = a.name;
    if (n.length >= 2 && t.includes(lower(n)) && (!best || n.length > best.n.length)) best = { a, n };
  }
  if (best) return { ownerId: best.a.id, ownerHint: null, rest: text };

  if (!mention) return { ownerId: null, ownerHint: null, rest: text };
  // Someone who wasn't at the meeting: keep their name as a hint (the first word after @).
  const hint = mention[1]!.split(/\s/)[0]!;
  return { ownerId: null, ownerHint: hint, rest: tidy(text.replace(`@${hint}`, ' ')) };
}

/* ───────────────────────────── the organiser ───────────────────────────── */

export interface OrganisedItem {
  title: string;
  ownerId: string | null;
  /** A name the notes give that no attendee has. */
  ownerHint: string | null;
  dueDate: string | null;
}

export interface Organised {
  summary: string | null;
  decisions: string[];
  questions: string[];
  actionItems: OrganisedItem[];
}

type Kind = 'action' | 'decision' | 'question' | 'summary';

const SECTION: { kind: Kind | null; re: RegExp }[] = [
  {
    kind: 'action',
    re: /^(?:action\s*items?|actions?|next\s*steps?|to-?dos?|tasks|follow-?ups?|待辦事項|待辦|待办事项|待办|行動項目|行动项目|追蹤事項|後續事項|後續行動|アクション\s*アイテム|アクション|宿題|対応事項|タスク)$/iu,
  },
  {
    kind: 'decision',
    re: /^(?:decisions?|decided|agreements?|resolutions?|決議事項|決議|决议|決定事項|決定|结论|結論|合意事項|合意)$/iu,
  },
  {
    kind: 'question',
    re: /^(?:open\s*questions?|questions?|open\s*issues?|issues|parking\s*lot|risks?|待確認事項|待確認|待确认|未決事項|未決|問題|课题|課題|確認事項)$/iu,
  },
  { kind: 'summary', re: /^(?:summary|overview|tl;?dr|摘要|概要|總結|总结|まとめ|サマリー)$/iu },
  {
    kind: null,
    re: /^(?:notes?|discussion|agenda|attendees|會議記錄|会议记录|討論|讨论|議題|议题|出席者|参加者|議事録|メモ)$/iu,
  },
];

const PREFIX: { kind: Kind; re: RegExp }[] = [
  {
    kind: 'action',
    re: /^(?:action(?:\s*item)?|ai|todo|to-?do|follow-?up|待辦|待办|行動|行动|追蹤|追踪|アクション|宿題|対応)\s*[:：]\s*/iu,
  },
  { kind: 'action', re: /^TODO\b\s*/ },
  {
    kind: 'decision',
    re: /^(?:decision|decided|agreed|resolved|決議|决议|決定|决定|結論|结论|共識|共识|合意)\s*[:：]\s*/iu,
  },
  {
    kind: 'question',
    re: /^(?:open\s*question|question|q|tbd|issue|待確認|待确认|問題|问题|未決|課題|確認事項)\s*[:：]\s*/iu,
  },
];

const BULLET = /^\s*(?:[-*+•・‧▪▫◦]|\d{1,2}[.)、]|[①-⑳])\s*/u;
const CHECKBOX = /^\[( |x|X)\]\s*|^[☐☑✓✔]\s*/u;

/** Trims whitespace and dangling joiners left after cutting a phrase out. */
function tidy(s: string): string {
  return s
    .replace(/[(（[]\s*[)）\]]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,，、。.!！?？:：;；])/gu, '$1')
    .replace(/^[\s,，、:：;；\-–—]+|[\s,，、:：;；\-–—]+$/gu, '')
    .replace(/^(?:to|will)\s+/i, '')
    .trim();
}

/**
 * The builtin organiser: actions, decisions and open questions from the notes' own markers (`Action:`, `TODO`,
 * `- [ ]`, `待辦：`, `アクション：`, `Decision:`, `決議：`, `決定：`, a question mark, or a section heading such as
 * "Action items" / "決議事項" over a list), owners from the attendees and due dates from phrases relative to the
 * meeting's date. Lines that are none of these become the summary (at most five).
 */
export function organiseNotes(
  notes: string,
  opts: { attendees: readonly Attendee[]; meetingDate: string },
): Organised {
  const out: Organised = { summary: null, decisions: [], questions: [], actionItems: [] };
  const summary: string[] = [];
  let section: Kind | null = null;

  for (const raw of notes.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line)?.[1] ?? null;
    const label = (heading ?? line)
      .replace(/[:：]\s*$/u, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .trim();
    const sectionHit = SECTION.find((x) => x.re.test(label));
    if (sectionHit && (heading || /[:：]\s*$/u.test(line) || label === line)) {
      section = sectionHit.kind;
      continue;
    }
    if (heading) {
      section = null;
      continue;
    }

    const bulleted = BULLET.test(line);
    line = line.replace(BULLET, '');
    let kind: Kind | null = null;
    const box = CHECKBOX.exec(line);
    if (box) {
      line = line.slice(box[0].length);
      kind = 'action';
    }
    for (const p of PREFIX) {
      const m = p.re.exec(line);
      if (m) {
        kind = p.kind;
        line = line.slice(m[0].length);
        break;
      }
    }
    // A list item belongs to its section first; a plain line is a question when it asks one, else the section's.
    if (!kind && section && bulleted) kind = section;
    if (!kind && /@\S/u.test(line)) kind = 'action';
    if (!kind && /[?？]\s*$/u.test(line)) kind = 'question';
    if (!kind && section && section !== 'summary') kind = section;
    line = line.trim();
    if (!line) continue;

    switch (kind ?? 'summary') {
      case 'decision':
        if (out.decisions.length < 50) out.decisions.push(tidy(line));
        break;
      case 'question':
        if (out.questions.length < 50) out.questions.push(tidy(line));
        break;
      case 'action': {
        if (out.actionItems.length >= 100) break;
        const owner = matchOwner(line, opts.attendees);
        const due = parseDue(owner.rest, opts.meetingDate);
        const title = tidy(due.rest) || tidy(line);
        out.actionItems.push({
          title: title.slice(0, 300),
          ownerId: owner.ownerId,
          ownerHint: owner.ownerHint,
          dueDate: due.date,
        });
        break;
      }
      default:
        if (summary.length < 5) summary.push(tidy(line));
    }
  }
  out.summary = summary.length ? summary.map((s) => `- ${s}`).join('\n') : null;
  return out;
}

/** The calendar date "now" in a time zone (default Asia/Taipei, the head office). */
export function todayIn(timeZone = 'Asia/Taipei', now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
