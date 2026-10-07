import { z } from 'zod';

/** Standard list query: `?page=1&pageSize=25&q=term&sort=-createdAt`. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z][\w.]*$/)
    .optional()
    .describe('Field name, prefix with "-" for descending'),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** Stable, translatable error codes shared by API and UI. */
export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  CSRF_INVALID: 'CSRF_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  MODULE_DISABLED: 'MODULE_DISABLED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  INTERNAL: 'INTERNAL',
  /** You tried to grant permissions you do not hold yourself (`details.missing`). */
  PRIVILEGE_ESCALATION: 'PRIVILEGE_ESCALATION',
  /** The action would lock you out (offboard/suspend yourself, drop your own admin role). */
  SELF_LOCKOUT: 'SELF_LOCKOUT',
  SYSTEM_ROLE_READONLY: 'SYSTEM_ROLE_READONLY',
  SYSTEM_GROUP: 'SYSTEM_GROUP',
  SYSTEM_MODULE: 'SYSTEM_MODULE',
  MODULE_DEPENDENCY: 'MODULE_DEPENDENCY',
  PRINCIPAL_OFFBOARDED: 'PRINCIPAL_OFFBOARDED',
  HAS_CHILDREN: 'HAS_CHILDREN',
  INVALID_PARENT: 'INVALID_PARENT',
  INVALID_STATE: 'INVALID_STATE',
  PASSWORD_MANAGED_EXTERNALLY: 'PASSWORD_MANAGED_EXTERNALLY',
  /** No published workflow is bound to a trigger that requires one. */
  WORKFLOW_NOT_CONFIGURED: 'WORKFLOW_NOT_CONFIGURED',
  /** The graph has problems (`details.issues`) and cannot be published. */
  WORKFLOW_INVALID: 'WORKFLOW_INVALID',
  /** The approval task was already decided, delegated or closed. */
  TASK_NOT_PENDING: 'TASK_NOT_PENDING',
  DELEGATION_NOT_ALLOWED: 'DELEGATION_NOT_ALLOWED',
  /** The chosen delegate cannot take the task (requester, inactive, already assigned). */
  INVALID_DELEGATE: 'INVALID_DELEGATE',
  /** Rejections need a comment so the requester knows why. */
  COMMENT_REQUIRED: 'COMMENT_REQUIRED',
  /** Still referenced (e.g. a workflow used by forms or roles); `details` names the users. */
  IN_USE: 'IN_USE',
  NOT_REQUESTABLE: 'NOT_REQUESTABLE',
  /** An open request for the same role and scope already exists (`details.requestId`). */
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  /** The person already holds the role at that scope. */
  ALREADY_GRANTED: 'ALREADY_GRANTED',
  DURATION_TOO_LONG: 'DURATION_TOO_LONG',
  /** The form is not published, paused, archived or not available to you. */
  FORM_NOT_AVAILABLE: 'FORM_NOT_AVAILABLE',
  /** OAuth: unknown client, wrong secret or revoked credentials (RFC 6749 `invalid_client`). */
  INVALID_CLIENT: 'INVALID_CLIENT',
  /** The webhook URL is not HTTPS or points at a private network. */
  WEBHOOK_TARGET_INVALID: 'WEBHOOK_TARGET_INVALID',
  EMAIL_NOT_CONFIGURED: 'EMAIL_NOT_CONFIGURED',
  /** A test notification could not be delivered (`details.reason`). */
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  /** No generative AI model is configured (features fall back to their builtin mode). */
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  /** The AI provider failed or timed out (`details.reason`). */
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  /** The monthly AI budget is spent. */
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  /** A destructive or privileged action needs explicit confirmation (`details.preview`). */
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  /** The record can't move to that status from its current one (`details.allowed`). */
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  /** Resolving or closing needs resolution notes / a resolution code. */
  RESOLUTION_REQUIRED: 'RESOLUTION_REQUIRED',
  /** The relationship is not allowed (self-link, duplicate, wrong classes or a containment cycle). */
  RELATIONSHIP_INVALID: 'RELATIONSHIP_INVALID',
  /** The planned window overlaps a blackout or is in the past (`details`). */
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
  /** The upload was refused: blocked file type, empty file or malware found (`details.reason`). */
  FILE_REJECTED: 'FILE_REJECTED',
  /** The upload is larger than the limit (`details.maxBytes`). */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  /** A production deployment needs an approved change in its window (`details.reason`). */
  CHANGE_REQUIRED: 'CHANGE_REQUIRED',
  /** The connection does not allow this use (`details.purpose`), e.g. admin credentials for a Data API. */
  CONNECTION_PURPOSE: 'CONNECTION_PURPOSE',
  /** The database connection is disabled. */
  CONNECTION_DISABLED: 'CONNECTION_DISABLED',
  /** The connection is read-only and the operation writes. */
  CONNECTION_READ_ONLY: 'CONNECTION_READ_ONLY',
  /** The database refused or failed the statement (`details.kind`, `details.dbCode`, `details.message`). */
  DATABASE_ERROR: 'DATABASE_ERROR',
  /** The host is not allowed (link-local/metadata addresses, or a private address not on the allow-list). */
  TARGET_BLOCKED: 'TARGET_BLOCKED',
  /** An outbound call failed before a response (`details.reason`: `timeout`, `network`, `cancelled`). */
  UPSTREAM_FAILED: 'UPSTREAM_FAILED',
  /** No script sandbox is configured, or the image is not on the allow-list (`details.reason`). */
  SANDBOX_UNAVAILABLE: 'SANDBOX_UNAVAILABLE',
  /** The Data API has no published version yet. */
  ENDPOINT_NOT_PUBLISHED: 'ENDPOINT_NOT_PUBLISHED',
  /** That version of the Data API is retired (HTTP 410). */
  ENDPOINT_RETIRED: 'ENDPOINT_RETIRED',
  /** The SQL changes data (`details.keywords`) but the endpoint does not allow writes. */
  WRITES_NOT_ALLOWED: 'WRITES_NOT_ALLOWED',
  /** Publishing needs a successful test of the current draft. */
  TEST_REQUIRED: 'TEST_REQUIRED',
  /** The job dependencies would form a cycle (`details.path`). */
  JOB_CYCLE: 'JOB_CYCLE',
  /** The job (or run) is running; wait or cancel it first. */
  JOB_RUNNING: 'JOB_RUNNING',
  /** The one-time credential was already revealed or has expired. */
  REVEAL_EXPIRED: 'REVEAL_EXPIRED',
  /** The access review campaign is closed. */
  REVIEW_CLOSED: 'REVIEW_CLOSED',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | (string & {});

/** Error thrown by route handlers; the kernel renders it as `{ error: { code, message } }`. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const httpErrors = {
  badRequest: (message = 'Bad request', details?: unknown) =>
    new HttpError(400, ErrorCodes.BAD_REQUEST, message, details),
  unauthenticated: (message = 'Authentication required') =>
    new HttpError(401, ErrorCodes.UNAUTHENTICATED, message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new HttpError(403, ErrorCodes.FORBIDDEN, message),
  notFound: (message = 'Not found') => new HttpError(404, ErrorCodes.NOT_FOUND, message),
  conflict: (message = 'Conflict', details?: unknown) =>
    new HttpError(409, ErrorCodes.CONFLICT, message, details),
};

/** `%term%` with LIKE wildcards in user input escaped — use with `ilike()`. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
