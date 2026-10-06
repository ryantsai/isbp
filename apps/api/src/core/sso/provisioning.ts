import { groupMembers, groups, type identityProviders, userIdentities, users } from '@isbp/db/schema';
import { HttpError, type ModuleContext } from '@isbp/sdk/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getKernel } from '../kernel-ref';

export type IdpRow = typeof identityProviders.$inferSelect;
type UserRow = typeof users.$inferSelect;

/** Normalized identity coming back from OIDC, SAML or LDAP. */
export interface ExternalIdentity {
  subject: string;
  email: string | null;
  displayName: string | null;
  username: string | null;
  givenName?: string | null;
  familyName?: string | null;
  jobTitle?: string | null;
  groups: string[];
}

function sanitizeUsername(value: string): string {
  return (
    value
      .replace(/@.*$/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '.')
      .slice(0, 100) || 'user'
  );
}

/**
 * Finds or links the platform user for an external identity:
 *   1. existing link (idp + subject) → 2. same email (link) → 3. JIT create (if enabled) → else refuse.
 * Then reconciles mapped group memberships (only memberships with source "sync" are removed).
 */
export async function resolveExternalUser(
  ctx: ModuleContext,
  idp: IdpRow,
  ext: ExternalIdentity,
): Promise<UserRow> {
  const db = ctx.db;
  const email = ext.email?.trim().toLowerCase() || null;

  const [linked] = await db
    .select({ u: users })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(and(eq(userIdentities.idpId, idp.id), eq(userIdentities.subject, ext.subject)));
  let user = linked?.u ?? null;
  let created = false;

  if (!user && email) {
    const [byEmail] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);
    if (byEmail) {
      user = byEmail;
      await db
        .insert(userIdentities)
        .values({ userId: byEmail.id, idpId: idp.id, subject: ext.subject, email })
        .onConflictDoNothing();
    }
  }

  if (!user) {
    if (!idp.jitProvisioning || !email) {
      throw new HttpError(
        403,
        'ACCOUNT_NOT_PROVISIONED',
        'Your account has not been set up in this platform yet',
      );
    }
    let username = sanitizeUsername(ext.username ?? email);
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()}`);
    if (clash) username = `${username}.${ext.subject.slice(-6).replace(/[^a-zA-Z0-9]/g, '')}`;
    user = await ctx.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email,
          username,
          displayName: ext.displayName || email,
          givenName: ext.givenName ?? null,
          familyName: ext.familyName ?? null,
          jobTitle: ext.jobTitle ?? null,
          authSource: idp.type,
          status: 'active',
          onboardedAt: new Date(),
          departmentId: idp.defaultDepartmentId,
        })
        .returning();
      await tx.insert(userIdentities).values({ userId: u!.id, idpId: idp.id, subject: ext.subject, email });
      await ctx.audit.record(
        {
          action: 'core.user.created',
          entityType: 'user',
          entityId: u!.id,
          entityLabel: u!.displayName,
          metadata: { provisionedBy: idp.key },
        },
        { tx, principal: { type: 'system', id: null, name: `sso:${idp.key}` } },
      );
      await ctx.events.publish('core.user.created', { userId: u!.id, email, status: 'active' }, { tx });
      await ctx.events.publish('core.user.onboarded', { userId: u!.id, email }, { tx });
      return u!;
    });
    created = true;
  }

  if (user.status !== 'active') {
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'This account is not active');
  }

  await syncMappedGroups(ctx, idp, user.id, ext.groups);
  await db
    .update(userIdentities)
    .set({ lastLoginAt: new Date() })
    .where(and(eq(userIdentities.idpId, idp.id), eq(userIdentities.subject, ext.subject)));
  if (!created && ext.displayName && ext.displayName !== user.displayName) {
    await db.update(users).set({ displayName: ext.displayName }).where(eq(users.id, user.id));
  }
  return user;
}

/** Adds/removes "sync" memberships for groups that have an IdP mapping. Manual memberships are untouched. */
export async function syncMappedGroups(
  ctx: ModuleContext,
  idp: IdpRow,
  userId: string,
  externalGroups: string[],
) {
  if (!idp.groupMappings.length) return;
  const incoming = new Set(externalGroups.map((g) => g.toLowerCase()));
  const shouldHave = new Set(
    idp.groupMappings.filter((m) => incoming.has(m.external.toLowerCase())).map((m) => m.groupId),
  );
  const mappedGroupIds = [...new Set(idp.groupMappings.map((m) => m.groupId))];
  const current = await ctx.db
    .select({ groupId: groupMembers.groupId, source: groupMembers.source })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, mappedGroupIds)));
  const have = new Set(current.map((c) => c.groupId));
  const toAdd = [...shouldHave].filter((g) => !have.has(g));
  const toRemove = current
    .filter((c) => c.source === 'sync' && !shouldHave.has(c.groupId))
    .map((c) => c.groupId);
  if (!toAdd.length && !toRemove.length) return;

  const existingGroups = toAdd.length
    ? await ctx.db.select({ id: groups.id }).from(groups).where(inArray(groups.id, toAdd))
    : [];
  await ctx.transaction(async (tx) => {
    if (existingGroups.length) {
      await tx
        .insert(groupMembers)
        .values(existingGroups.map((g) => ({ groupId: g.id, userId, source: 'sync' })))
        .onConflictDoNothing();
    }
    if (toRemove.length) {
      await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, toRemove)));
    }
    await ctx.audit.record(
      {
        action: 'core.user.groups_synced',
        entityType: 'user',
        entityId: userId,
        metadata: { idp: idp.key, added: existingGroups.map((g) => g.id), removed: toRemove },
      },
      { tx, principal: { type: 'system', id: null, name: `sso:${idp.key}` } },
    );
  });
  await getKernel().rbac.bump();
}
