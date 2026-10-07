export type SqlErrorKind =
  | 'connect'
  | 'auth'
  | 'timeout'
  | 'cancelled'
  | 'syntax'
  | 'permission'
  | 'constraint'
  | 'not_found'
  | 'parameter'
  | 'read_only'
  | 'other';

/**
 * A database failure in words safe to show an administrator: the server's message and code, never the
 * connection string or credentials.
 */
export class SqlError extends Error {
  constructor(
    readonly kind: SqlErrorKind,
    message: string,
    /** The engine's own code (`28P01`, `18456`, `ORA-01017`, `ER_ACCESS_DENIED_ERROR`). */
    readonly dbCode: string | null = null,
  ) {
    super(message);
    this.name = 'SqlError';
  }
}

const PATTERNS: [SqlErrorKind, RegExp][] = [
  [
    'auth',
    /^(28P01|28000|18456|18452|ORA-01017|ORA-28000|ER_ACCESS_DENIED_ERROR|ER_DBACCESS_DENIED_ERROR|ELOGIN)$/,
  ],
  ['timeout', /^(57014|ETIMEOUT|ORA-01013|NJS-123|DPI-1067|PROTOCOL_SEQUENCE_TIMEOUT|ER_QUERY_TIMEOUT)$/],
  ['cancelled', /^(ECANCEL)$/],
  [
    'connect',
    /^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|ESOCKET|ETIMEDOUT|NJS-500|NJS-501|NJS-503|NJS-511|ORA-12514|ORA-12541|3D000|08\d{3})$/,
  ],
  ['syntax', /^(42601|42000|102|156|ORA-00900|ORA-00933|ORA-00936|ER_PARSE_ERROR)$/],
  [
    'permission',
    /^(42501|229|230|262|ORA-01031|ORA-00942|ER_TABLEACCESS_DENIED_ERROR|ER_SPECIFIC_ACCESS_DENIED_ERROR)$/,
  ],
  ['not_found', /^(42P01|42883|208|2812|ORA-04043|ORA-06550|ER_NO_SUCH_TABLE|ER_SP_DOES_NOT_EXIST)$/],
  [
    'constraint',
    /^(23\d{3}|2627|2601|547|ORA-00001|ORA-02291|ORA-02292|ER_DUP_ENTRY|ER_NO_REFERENCED_ROW_2)$/,
  ],
  ['read_only', /^(25006|3906|ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION|ORA-01456)$/],
];

/** Maps a driver error to a `SqlError`, keeping the server's message. */
export function toSqlError(err: unknown): SqlError {
  if (err instanceof SqlError) return err;
  const e = (err ?? {}) as {
    code?: unknown;
    number?: unknown;
    errorNum?: unknown;
    message?: unknown;
    originalError?: { info?: { number?: number; message?: string } };
  };
  const info = e.originalError?.info;
  let code: string | null = null;
  if (typeof e.code === 'string') code = e.code;
  if (typeof e.number === 'number') code = String(e.number);
  if (info?.number) code = String(info.number);
  const message = String(info?.message ?? e.message ?? 'Database error');
  const ora = /^(ORA-\d{5}|NJS-\d{3}|DPI-\d{4})/.exec(message)?.[1];
  if (ora) code = ora;
  if (typeof e.errorNum === 'number' && e.errorNum > 0 && !ora)
    code = `ORA-${String(e.errorNum).padStart(5, '0')}`;
  if (code === 'EREQUEST' && info?.number) code = String(info.number);
  const kind = code ? (PATTERNS.find(([, re]) => re.test(code))?.[0] ?? 'other') : 'other';
  return new SqlError(kind, message.split('\n')[0]!.slice(0, 2_000), code);
}
