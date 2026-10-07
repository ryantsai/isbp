/**
 * A small WIQL (Work Item Query Language) engine for flat queries: `SELECT … FROM WorkItems WHERE … ORDER BY …`
 * with `=`, `<>`, `>`, `>=`, `<`, `<=`, `IN`, `UNDER`, `AND`, `OR`, `NOT`, parentheses, `@project`, `@me` and
 * `@today`. Anything else is refused with a syntax error rather than answered wrongly.
 */
import { FIELD_DEFS, type FieldKind, isIdentityValue } from './state';

/** A query the server refuses (400); `typeKey` as the server names it. */
export class WiqlError extends Error {
  constructor(
    message: string,
    readonly typeKey = 'WorkItemTrackingQuerySyntaxException',
  ) {
    super(message);
  }
}

type Token =
  | { t: 'field'; v: string }
  | { t: 'string'; v: string }
  | { t: 'number'; v: number }
  | { t: 'macro'; v: string }
  | { t: 'word'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punct'; v: string };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === '[') {
      const end = text.indexOf(']', i);
      if (end < 0) throw new WiqlError('Expecting a closing bracket for a field name.');
      out.push({ t: 'field', v: text.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (c === "'" || c === '"') {
      let v = '';
      let j = i + 1;
      for (;;) {
        if (j >= text.length) throw new WiqlError('Expecting a closing quote.');
        if (text[j] === c) {
          if (text[j + 1] === c) {
            v += c;
            j += 2;
            continue;
          }
          break;
        }
        v += text[j];
        j++;
      }
      out.push({ t: 'string', v });
      i = j + 1;
    } else if (c === '@') {
      const m = /^@[A-Za-z]+/.exec(text.slice(i));
      if (!m) throw new WiqlError('Expecting a macro name after @.');
      out.push({ t: 'macro', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if (/[0-9-]/.test(c) && /^-?\d/.test(text.slice(i))) {
      const m = /^-?\d+(\.\d+)?/.exec(text.slice(i))!;
      out.push({ t: 'number', v: Number(m[0]) });
      i += m[0].length;
    } else if ('<>=!'.includes(c)) {
      const m = /^(<>|!=|>=|<=|=|<|>)/.exec(text.slice(i));
      if (!m) throw new WiqlError(`Unexpected "${c}".`);
      out.push({ t: 'op', v: m[0] === '!=' ? '<>' : m[0] });
      i += m[0].length;
    } else if ('(),'.includes(c)) {
      out.push({ t: 'punct', v: c });
      i++;
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(i));
      if (!m) throw new WiqlError(`Unexpected "${c}".`);
      out.push({ t: 'word', v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

export type Value =
  { kind: 'string'; v: string } | { kind: 'number'; v: number } | { kind: 'macro'; v: string };

export type Expr =
  | { kind: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr }
  | { kind: 'cmp'; field: string; op: string; value: Value }
  | { kind: 'in'; field: string; values: Value[] }
  | { kind: 'under'; field: string; value: Value };

export interface WiqlQuery {
  fields: string[];
  where: Expr | null;
  orderBy: { field: string; desc: boolean }[];
  asOf: string | null;
}

export function parseWiql(text: string): WiqlQuery {
  const tokens = tokenize(text);
  let p = 0;
  const peek = () => tokens[p];
  const word = (w: string) => {
    const tok = peek();
    return tok?.t === 'word' && tok.v.toUpperCase() === w;
  };
  const expectWord = (w: string) => {
    if (!word(w)) throw new WiqlError(`Expecting ${w}.`);
    p++;
  };
  const field = (): string => {
    const tok = tokens[p++];
    if (tok?.t !== 'field') throw new WiqlError('Expecting a field name in brackets.');
    if (!FIELD_DEFS[tok.v])
      throw new WiqlError(
        `TF51005: The query references a field that does not exist. The error is caused by «${tok.v}».`,
      );
    return tok.v;
  };
  const value = (): Value => {
    const tok = tokens[p++];
    if (tok?.t === 'string') return { kind: 'string', v: tok.v };
    if (tok?.t === 'number') return { kind: 'number', v: tok.v };
    if (tok?.t === 'macro') {
      if (!['@project', '@me', '@today'].includes(tok.v))
        throw new WiqlError(`The macro ${tok.v} is not supported.`);
      return { kind: 'macro', v: tok.v };
    }
    throw new WiqlError('Expecting a value.');
  };

  expectWord('SELECT');
  const fields = [field()];
  while (peek()?.t === 'punct' && peek()!.v === ',') {
    p++;
    fields.push(field());
  }
  expectWord('FROM');
  const from = tokens[p++];
  if (from?.t !== 'word' || from.v.toLowerCase() !== 'workitems')
    throw new WiqlError('Only flat queries (FROM WorkItems) are supported.');

  const primary = (): Expr => {
    if (peek()?.t === 'punct' && peek()!.v === '(') {
      p++;
      const e = or();
      if (!(peek()?.t === 'punct' && peek()!.v === ')'))
        throw new WiqlError('Expecting a closing parenthesis.');
      p++;
      return e;
    }
    if (word('NOT')) {
      p++;
      return { kind: 'not', expr: primary() };
    }
    const f = field();
    if (word('IN')) {
      p++;
      if (!(peek()?.t === 'punct' && peek()!.v === '(')) throw new WiqlError('Expecting ( after IN.');
      p++;
      const values = [value()];
      while (peek()?.t === 'punct' && peek()!.v === ',') {
        p++;
        values.push(value());
      }
      if (!(peek()?.t === 'punct' && peek()!.v === ')'))
        throw new WiqlError('Expecting ) after the IN list.');
      p++;
      return { kind: 'in', field: f, values };
    }
    if (word('UNDER')) {
      p++;
      return { kind: 'under', field: f, value: value() };
    }
    const op = tokens[p++];
    if (op?.t !== 'op') throw new WiqlError(`Unsupported operator after [${f}].`);
    return { kind: 'cmp', field: f, op: op.v, value: value() };
  };
  const and = (): Expr => {
    let left = primary();
    while (word('AND')) {
      p++;
      left = { kind: 'and', left, right: primary() };
    }
    return left;
  };
  const or = (): Expr => {
    let left = and();
    while (word('OR')) {
      p++;
      left = { kind: 'or', left, right: and() };
    }
    return left;
  };

  let where: Expr | null = null;
  if (word('WHERE')) {
    p++;
    where = or();
  }
  const orderBy: WiqlQuery['orderBy'] = [];
  if (word('ORDER')) {
    p++;
    expectWord('BY');
    for (;;) {
      const f = field();
      let desc = false;
      if (word('ASC')) p++;
      else if (word('DESC')) {
        p++;
        desc = true;
      }
      orderBy.push({ field: f, desc });
      if (peek()?.t === 'punct' && peek()!.v === ',') p++;
      else break;
    }
  }
  let asOf: string | null = null;
  if (word('ASOF')) {
    p++;
    const v = value();
    if (v.kind !== 'string') throw new WiqlError('Expecting a date after ASOF.');
    asOf = v.v;
  }
  if (p < tokens.length) throw new WiqlError(`Unexpected "${String(tokens[p]!.v)}".`);
  return { fields, where, orderBy, asOf };
}

/* ───────────────────────────── evaluation ───────────────────────────── */

export interface EvalContext {
  project: string | null;
  /** Identity strings (`uniqueName`, display name, email) of `@me`. */
  me: string[];
  /** Compare date-times to the millisecond (`timePrecision=true`), else by day. */
  timePrecision: boolean;
  /** Identity strings (unique name, display name, email) of a stored identity id. */
  identity(id: string): string[];
  now: number;
}

const HAS_TIME = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function resolve(value: Value, kind: FieldKind, ctx: EvalContext): string | number {
  if (value.kind === 'macro') {
    if (value.v === '@project') {
      if (!ctx.project) throw new WiqlError('The @project macro needs a project in the URL.');
      return ctx.project;
    }
    if (value.v === '@me') return ctx.me[0] ?? '';
    return new Date(ctx.now).toISOString().slice(0, 10);
  }
  if (kind === 'dateTime' && value.kind === 'string') {
    if (!ctx.timePrecision && HAS_TIME.test(value.v))
      throw new WiqlError(
        `You cannot supply a time with the date when running a query using date precision. The error is caused by «'${value.v}'».`,
        'VssPropertyValidationException',
      );
    if (Number.isNaN(Date.parse(value.v))) throw new WiqlError(`The value ${value.v} is not a valid date.`);
  }
  return value.v;
}

const dayOf = (ms: number) => Math.floor(ms / 86_400_000);

function compare(
  kind: FieldKind,
  stored: unknown,
  wanted: string | number,
  op: string,
  ctx: EvalContext,
  field: string,
): boolean {
  if (kind === 'identity') {
    const names = isIdentityValue(stored) ? ctx.identity(stored.$identity).map((s) => s.toLowerCase()) : [];
    const hit = names.includes(String(wanted).toLowerCase()) || (String(wanted) === '' && names.length === 0);
    if (op === '=') return hit;
    if (op === '<>') return !hit;
    throw new WiqlError(`The operator ${op} cannot be used with the identity field [${field}].`);
  }
  if (stored === undefined || stored === null || stored === '') {
    if (op === '=') return wanted === '';
    if (op === '<>') return wanted !== '';
    return false;
  }
  let a: number | string;
  let b: number | string;
  if (kind === 'dateTime') {
    const sa = Date.parse(String(stored));
    const sb = Date.parse(String(wanted));
    a = ctx.timePrecision ? sa : dayOf(sa);
    b = ctx.timePrecision ? sb : dayOf(sb);
  } else if (kind === 'integer' || kind === 'double') {
    a = Number(stored);
    b = Number(wanted);
    if (Number.isNaN(b)) throw new WiqlError(`The value ${String(wanted)} is not a number for [${field}].`);
  } else {
    // String comparisons in WIQL are case-insensitive.
    a = String(stored).toLowerCase();
    b = String(wanted).toLowerCase();
  }
  switch (op) {
    case '=':
      return a === b;
    case '<>':
      return a !== b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    default:
      throw new WiqlError(`Unsupported operator ${op}.`);
  }
}

export function evaluate(expr: Expr | null, fields: Record<string, unknown>, ctx: EvalContext): boolean {
  if (!expr) return true;
  switch (expr.kind) {
    case 'and':
      return evaluate(expr.left, fields, ctx) && evaluate(expr.right, fields, ctx);
    case 'or':
      return evaluate(expr.left, fields, ctx) || evaluate(expr.right, fields, ctx);
    case 'not':
      return !evaluate(expr.expr, fields, ctx);
    case 'cmp': {
      const kind = FIELD_DEFS[expr.field]!.type;
      return compare(kind, fields[expr.field], resolve(expr.value, kind, ctx), expr.op, ctx, expr.field);
    }
    case 'in': {
      const kind = FIELD_DEFS[expr.field]!.type;
      return expr.values.some((v) =>
        compare(kind, fields[expr.field], resolve(v, kind, ctx), '=', ctx, expr.field),
      );
    }
    case 'under': {
      const kind = FIELD_DEFS[expr.field]!.type;
      if (kind !== 'treePath') throw new WiqlError(`UNDER can only be used with area and iteration paths.`);
      const stored = String(fields[expr.field] ?? '').toLowerCase();
      const root = String(resolve(expr.value, kind, ctx)).toLowerCase();
      return stored === root || stored.startsWith(`${root}\\`);
    }
  }
}

/** Sort key comparison for ORDER BY (empty values first, like the server). */
export function compareFieldValues(field: string, a: unknown, b: unknown): number {
  const kind = FIELD_DEFS[field]?.type ?? 'string';
  const empty = (v: unknown) => v === undefined || v === null || v === '';
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? -1 : 1;
  if (kind === 'dateTime') return Date.parse(String(a)) - Date.parse(String(b));
  if (kind === 'integer' || kind === 'double') return Number(a) - Number(b);
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
