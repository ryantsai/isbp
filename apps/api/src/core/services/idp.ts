import {
  type createIdpSchema,
  ldapConfigSchema,
  oidcConfigSchema,
  samlConfigSchema,
  type updateIdpSchema,
} from '@isbp/contracts';
import { identityProviders, userIdentities, users } from '@isbp/db/schema';
import { type AuthContext, httpErrors, type ModuleContext } from '@isbp/sdk/server';
import { and, count, eq, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { getKernel } from '../kernel-ref';
import { ldapDirectory, ldapTest } from '../sso/ldap';
import { testOidc } from '../sso/oidc';
import { type IdpRow, syncMappedGroups } from '../sso/provisioning';
import { samlEndpoints, testSaml } from '../sso/saml';

const configSchemas = { oidc: oidcConfigSchema, saml: samlConfigSchema, ldap: ldapConfigSchema } as const;

/** Identity provider configuration, connection tests and LDAP directory sync. */
export class IdpService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  endpoints(idp: Pick<IdpRow, 'key' | 'type'>): Record<string, string> {
    const publicUrl = getKernel().config.PUBLIC_URL;
    if (idp.type === 'oidc') return { redirectUri: `${publicUrl}/api/v1/auth/sso/${idp.key}/callback` };
    if (idp.type === 'saml') return samlEndpoints(publicUrl, idp.key);
    return {};
  }

  secrets(idp: IdpRow): Record<string, string> {
    return getKernel().box.decryptJson(idp.secrets);
  }

  private dto(idp: IdpRow, linkedUsers: number) {
    return {
      id: idp.id,
      key: idp.key,
      name: idp.name,
      type: idp.type,
      enabled: idp.enabled,
      config: idp.config as unknown as Record<string, unknown>,
      secretKeys: Object.keys(this.secrets(idp)),
      jitProvisioning: idp.jitProvisioning,
      defaultDepartmentId: idp.defaultDepartmentId,
      groupMappings: idp.groupMappings,
      syncEnabled: idp.syncEnabled,
      syncCron: idp.syncCron,
      lastSyncAt: idp.lastSyncAt,
      lastSyncStatus: idp.lastSyncStatus,
      lastSyncMessage: idp.lastSyncMessage,
      displayOrder: idp.displayOrder,
      linkedUsers,
      endpoints: this.endpoints(idp),
      updatedAt: idp.updatedAt,
    };
  }

  async find(id: string): Promise<IdpRow> {
    const [idp] = await this.db.select().from(identityProviders).where(eq(identityProviders.id, id));
    if (!idp) throw httpErrors.notFound('Identity provider not found');
    return idp;
  }

  async findEnabledByKey(key: string): Promise<IdpRow> {
    const [idp] = await this.db
      .select()
      .from(identityProviders)
      .where(and(eq(identityProviders.key, key), eq(identityProviders.enabled, true)));
    if (!idp) throw httpErrors.notFound('Sign-in provider not found');
    return idp;
  }

  async list() {
    const linked = this.db
      .select({ idpId: userIdentities.idpId, n: count().as('n') })
      .from(userIdentities)
      .groupBy(userIdentities.idpId)
      .as('linked');
    const rows = await this.db
      .select({ idp: identityProviders, n: linked.n })
      .from(identityProviders)
      .leftJoin(linked, eq(linked.idpId, identityProviders.id))
      .orderBy(identityProviders.displayOrder, identityProviders.name);
    return rows.map((r) => this.dto(r.idp, Number(r.n ?? 0)));
  }

  async get(id: string) {
    const idp = await this.find(id);
    const [n] = await this.db.select({ n: count() }).from(userIdentities).where(eq(userIdentities.idpId, id));
    return this.dto(idp, n!.n);
  }

  async create(input: z.output<typeof createIdpSchema>, _auth: AuthContext) {
    const { secrets, ...rest } = input;
    const box = getKernel().box;
    const idp = await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(identityProviders)
        .values({
          ...rest,
          defaultDepartmentId: rest.defaultDepartmentId ?? null,
          syncCron: rest.syncCron ?? null,
          secrets:
            secrets && Object.keys(secrets).length
              ? box.encryptJson(secrets as Record<string, string>)
              : null,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'core.idp.created',
          category: 'security',
          entityType: 'identity_provider',
          entityId: row!.id,
          entityLabel: row!.name,
          metadata: { type: row!.type },
        },
        { tx },
      );
      return row!;
    });
    await getKernel().queues.forModule('core').enqueue('refresh-sync-schedules', {});
    return this.get(idp.id);
  }

  async update(id: string, input: z.output<typeof updateIdpSchema>, _auth: AuthContext) {
    const before = await this.find(id);
    const box = getKernel().box;
    let config = before.config;
    if (input.config) {
      const merged = { ...(before.config as unknown as Record<string, unknown>), ...input.config };
      const parsed = configSchemas[before.type].safeParse(merged);
      if (!parsed.success)
        throw httpErrors.badRequest('Invalid provider configuration', { issues: parsed.error.issues });
      config = parsed.data as typeof before.config;
    }
    let secrets = before.secrets;
    if (input.secrets && Object.keys(input.secrets).length) {
      secrets = box.encryptJson({ ...this.secrets(before), ...input.secrets });
    }
    const { config: _c, secrets: _s, ...rest } = input;
    const patch = { ...rest, config, secrets };
    const changes = this.ctx.audit.diff(
      { ...before, secrets: null } as unknown as Record<string, unknown>,
      { ...patch, secrets: undefined } as Record<string, unknown>,
    );
    if (input.secrets && Object.keys(input.secrets).length) changes.secrets = ['[redacted]', '[redacted]'];
    await this.ctx.transaction(async (tx) => {
      await tx.update(identityProviders).set(patch).where(eq(identityProviders.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.idp.updated',
          category: 'security',
          entityType: 'identity_provider',
          entityId: id,
          entityLabel: before.name,
          changes,
        },
        { tx },
      );
    });
    await getKernel().queues.forModule('core').enqueue('refresh-sync-schedules', {});
    return this.get(id);
  }

  async remove(id: string) {
    const idp = await this.find(id);
    await this.ctx.transaction(async (tx) => {
      await tx.delete(identityProviders).where(eq(identityProviders.id, id));
      await this.ctx.audit.record(
        {
          action: 'core.idp.deleted',
          category: 'security',
          entityType: 'identity_provider',
          entityId: id,
          entityLabel: idp.name,
        },
        { tx },
      );
    });
    await getKernel().queues.forModule('core').enqueue('refresh-sync-schedules', {});
  }

  async test(id: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
    const idp = await this.find(id);
    const secrets = this.secrets(idp);
    try {
      const details =
        idp.type === 'oidc'
          ? await testOidc(idp, secrets.clientSecret)
          : idp.type === 'saml'
            ? testSaml(idp)
            : await ldapTest(idp, secrets.bindPassword ?? '');
      return { ok: true, message: 'Connection succeeded', details };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /** Reads the whole LDAP directory and reconciles users + mapped groups. Missing users are suspended. */
  async syncDirectory(id: string) {
    const idp = await this.find(id);
    if (idp.type !== 'ldap') throw httpErrors.badRequest('Only LDAP providers support directory sync');
    const started = Date.now();
    try {
      const people = await ldapDirectory(idp, this.secrets(idp).bindPassword ?? '');
      let created = 0;
      let updated = 0;
      const seen: string[] = [];
      for (const person of people) {
        if (!person.email) continue;
        seen.push(person.subject);
        const email = person.email.toLowerCase();
        const [link] = await this.db
          .select({ userId: userIdentities.userId })
          .from(userIdentities)
          .where(and(eq(userIdentities.idpId, idp.id), eq(userIdentities.subject, person.subject)));
        let userId = link?.userId;
        if (!userId) {
          const [byEmail] = await this.db
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`);
          if (byEmail) userId = byEmail.id;
          else {
            const [u] = await this.db
              .insert(users)
              .values({
                email,
                username: (person.username ?? email.split('@')[0]!).slice(0, 100),
                displayName: person.displayName ?? email,
                givenName: person.givenName ?? null,
                familyName: person.familyName ?? null,
                jobTitle: person.jobTitle ?? null,
                authSource: 'ldap',
                status: 'active',
                onboardedAt: new Date(),
                departmentId: idp.defaultDepartmentId,
              })
              .onConflictDoNothing()
              .returning({ id: users.id });
            if (!u) continue;
            userId = u.id;
            created++;
          }
          await this.db
            .insert(userIdentities)
            .values({ userId, idpId: idp.id, subject: person.subject, email })
            .onConflictDoNothing();
        } else {
          await this.db
            .update(users)
            .set({ displayName: person.displayName ?? undefined, jobTitle: person.jobTitle ?? undefined })
            .where(eq(users.id, userId));
          updated++;
        }
        await syncMappedGroups(this.ctx, idp, userId, person.groups);
      }
      // Users linked to this directory but no longer present are suspended (never deleted).
      const missing = await this.db
        .select({ userId: userIdentities.userId })
        .from(userIdentities)
        .innerJoin(users, eq(users.id, userIdentities.userId))
        .where(
          and(
            eq(userIdentities.idpId, idp.id),
            eq(users.status, 'active'),
            eq(users.authSource, 'ldap'),
            seen.length ? notInArray(userIdentities.subject, seen) : undefined,
          ),
        );
      for (const m of missing) {
        await this.db.update(users).set({ status: 'suspended' }).where(eq(users.id, m.userId));
        await getKernel().sessions.revokeAllForUser(m.userId, 'directory_removed');
      }
      const message = `${people.length} entries · ${created} created · ${updated} updated · ${missing.length} suspended`;
      await this.db
        .update(identityProviders)
        .set({ lastSyncAt: new Date(), lastSyncStatus: 'success', lastSyncMessage: message })
        .where(eq(identityProviders.id, id));
      await this.ctx.audit.record({
        action: 'core.directory.synced',
        category: 'system',
        entityType: 'identity_provider',
        entityId: id,
        entityLabel: idp.name,
        metadata: { created, updated, suspended: missing.length, ms: Date.now() - started },
      });
      await this.ctx.events.publish('core.directory.synced', {
        idpId: id,
        created,
        updated,
        suspended: missing.length,
      });
      if (missing.length) await getKernel().rbac.bump();
      return { created, updated, suspended: missing.length };
    } catch (err) {
      await this.db
        .update(identityProviders)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: 'failed',
          lastSyncMessage: (err as Error).message.slice(0, 1000),
        })
        .where(eq(identityProviders.id, id));
      throw err;
    }
  }
}
