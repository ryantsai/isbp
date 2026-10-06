import { sessions, users } from '@isbp/db/schema';
import { isLocale } from '@isbp/i18n';
import type { Db, SessionUser } from '@isbp/sdk/server';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Config } from '../config';
import { randomToken, sha256Hex } from './crypto';

export const SESSION_COOKIE = 'isbp_session';

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

export interface ValidatedSession {
  session: SessionRow;
  user: UserRow;
}

export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    locale: isLocale(u.locale) ? u.locale : 'en',
    timezone: u.timezone,
    departmentId: u.departmentId,
    avatarUrl: u.avatarUrl,
  };
}

/**
 * Server-side sessions: the browser holds a 256-bit random token; only its SHA-256 is stored, so a
 * database leak does not leak usable sessions. Sessions have an absolute expiry and an idle timeout,
 * and are revoked immediately on logout, suspension and offboarding.
 */
export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  async create(
    userId: string,
    opts: { remember?: boolean; idpId?: string | null; ip?: string; userAgent?: string },
  ): Promise<{ token: string; session: SessionRow }> {
    const token = randomToken(32);
    const ttlMs = opts.remember
      ? this.config.SESSION_REMEMBER_DAYS * 86_400_000
      : this.config.SESSION_TTL_HOURS * 3_600_000;
    const [session] = await this.db
      .insert(sessions)
      .values({
        tokenHash: sha256Hex(token),
        userId,
        csrfToken: randomToken(24),
        idpId: opts.idpId ?? null,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent?.slice(0, 500) ?? null,
        expiresAt: new Date(Date.now() + ttlMs),
      })
      .returning();
    return { token, session: session! };
  }

  async validate(token: string): Promise<ValidatedSession | null> {
    if (!token || token.length > 100) return null;
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, sha256Hex(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) return null;

    const now = Date.now();
    const idleMs = this.config.SESSION_IDLE_MINUTES * 60_000;
    if (now - row.session.lastSeenAt.getTime() > idleMs) {
      await this.revoke(row.session.id, 'idle_timeout');
      return null;
    }
    if (row.user.status !== 'active') {
      await this.revoke(row.session.id, `user_${row.user.status}`);
      return null;
    }
    if (now - row.session.lastSeenAt.getTime() > 60_000) {
      void this.db
        .update(sessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(sessions.id, row.session.id))
        .catch(() => undefined);
    }
    return row;
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
    tx: Db = this.db,
  ): Promise<number> {
    const conditions = [
      eq(sessions.userId, userId),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
    ];
    if (exceptSessionId) conditions.push(ne(sessions.id, exceptSessionId));
    const res = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(...conditions))
      .returning({ id: sessions.id });
    return res.length;
  }

  async listActive(userId: string): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(sql`${sessions.lastSeenAt} desc`);
  }

  /** Removes sessions that ended more than a week ago. */
  async purge(): Promise<number> {
    const res = await this.db.execute(
      sql`delete from core.sessions where coalesce(revoked_at, expires_at) < now() - interval '7 days'`,
    );
    return res.rowCount ?? 0;
  }

  cookieOptions(session: SessionRow, remember: boolean) {
    return {
      path: '/',
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.cookieSecure,
      ...(remember ? { expires: session.expiresAt } : {}),
    };
  }
}
