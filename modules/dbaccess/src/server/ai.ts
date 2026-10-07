import { type AiToolHandler, httpErrors, localize } from '@isbp/sdk/server';
import { aiListMyAccessInput, aiRequestAccessInput } from '../contracts';
import { defaultDateFor, todayIn } from '../model';
import { personOf } from './access';
import { personById } from './support';
import { services } from './services';

/** AI tools (the gateway checks permissions, confirms the destructive one and audits every call). */
export const aiTools: Record<string, AiToolHandler> = {
  'dbaccess.list_my_access': async (raw, ctx, auth) => {
    const input = aiListMyAccessInput.parse(raw);
    const locale = auth.user?.locale ?? 'en';
    const s = services(ctx);
    const grants = (await s.grants.mine(auth)).filter(
      (g) => input.includeEnded || !['revoked', 'expired'].includes(g.status),
    );
    const requests = (await s.requests.mine(auth)).filter((r) => r.status === 'pending');
    return {
      access: grants.map((g) => ({
        role: localize(g.role.name, locale),
        databaseRole: g.role.roleName,
        database: g.role.database,
        server: g.server.displayName,
        account: g.accountName,
        status: g.viewStatus,
        expiresAt: g.expiresAt,
        passwordToReveal: Boolean(g.reveal?.available),
      })),
      pendingRequests: requests.map((r) => ({
        reference: r.reference,
        role: localize(r.role.name, locale),
        server: r.server.displayName,
        requestedUntil: r.expiresOn,
      })),
      link: '/dbaccess',
    };
  },

  'dbaccess.request_access': async (raw, ctx, auth) => {
    const input = aiRequestAccessInput.parse(raw);
    const me = personOf(auth);
    if (!me) throw httpErrors.forbidden('Only people can request database access');
    const s = services(ctx);
    const role = await s.requests.findRole(input.role, input.server);
    const person = await personById(ctx.db, me);
    const today = todayIn(auth.user?.timezone ?? person?.timezone ?? 'UTC');
    const expiresOn = input.expiresOn === undefined ? defaultDateFor(role, today) : input.expiresOn;
    const [created] = await s.requests.submit(
      { items: [{ roleId: role.id, expiresOn }], justification: input.justification },
      auth,
    );
    return {
      reference: created!.reference,
      status: created!.status,
      role: localize(created!.role.name, auth.user?.locale ?? 'en'),
      server: created!.server.displayName,
      requestedUntil: created!.expiresOn,
      link: `/dbaccess/requests/${created!.reference}`,
    };
  },
};
