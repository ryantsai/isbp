import { departments, roleAssignments, roles, users, uuidv7 } from '@isbp/db/schema';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { buildApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { bindKernel } from '../../src/core/kernel-ref';
import { installedModules } from '../../src/generated/modules';
import { createKernel, type Kernel } from '../../src/kernel/kernel';
import { hashPassword } from '../../src/kernel/passwords';

export const PASSWORD = 'Integration-Test-1!';

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

/** Tests assert on loosely-shaped JSON bodies. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseJson = any;

export interface Harness {
  kernel: Kernel;
  app: Awaited<ReturnType<typeof buildApp>>;
  ids: { admin: string; hr: string; outsider: string; sales: string; salesTpe: string; finance: string };
  login(username: string, password?: string): Promise<Session>;
  call(
    session: Session | null,
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ status: number; body: LooseJson }>;
  close(): Promise<void>;
}

/**
 * Fresh platform on a throwaway database: drops every ISBP schema, migrates, and creates a minimal
 * org (admin, a department-scoped HR partner, an outsider). Refuses to touch non-test databases.
 */
export async function createHarness(): Promise<Harness> {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  const dbName = new URL(config.DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test'))
    throw new Error(`Refusing to reset database "${dbName}" — integration tests need a *_test database`);

  const kernel = await createKernel(config, pino({ level: 'silent' }), installedModules);
  bindKernel(kernel);
  for (const m of kernel.registry.modules) {
    await kernel.db.execute(
      sql.raw(
        `drop schema if exists "${m.manifest.id === 'core' ? 'core' : m.manifest.id.replaceAll('-', '_')}" cascade`,
      ),
    );
  }
  await kernel.db.execute(sql`drop table if exists public.isbp_migrations`);
  await kernel.redis.flushdb();
  await kernel.migrate();
  await kernel.registry.loadState();

  // Fixtures
  const hash = await hashPassword(PASSWORD);
  const mkDept = async (code: string, parent?: { id: string; path: string }) => {
    const id = uuidv7();
    const path = `${parent?.path ?? '/'}${id}/`;
    await kernel.db.insert(departments).values({ id, code, name: code, parentId: parent?.id ?? null, path });
    return { id, path };
  };
  const sales = await mkDept('SALES');
  const salesTpe = await mkDept('SALES-TPE', sales);
  const finance = await mkDept('FIN');
  const mkUser = async (username: string, departmentId: string | null) => {
    const [u] = await kernel.db
      .insert(users)
      .values({
        email: `${username}@test.example`,
        username,
        displayName: username,
        passwordHash: hash,
        departmentId,
      })
      .returning();
    return u!.id;
  };
  const admin = await mkUser('admin', null);
  const hr = await mkUser('hr', finance.id);
  const outsider = await mkUser('outsider', finance.id);
  const roleId = async (key: string) =>
    (await kernel.db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)))[0]!.id;
  await kernel.db.insert(roleAssignments).values({ roleId: await roleId('platform-admin'), userId: admin });
  await kernel.db.insert(roleAssignments).values({
    roleId: await roleId('identity-admin'),
    userId: hr,
    scopeType: 'department',
    scopeDepartmentId: sales.id,
  });
  await kernel.rbac.bump();

  const app = await buildApp(kernel);
  await app.ready();

  const call: Harness['call'] = async (session, method, url, body) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      payload: body as object | undefined,
      headers: session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {},
    });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : undefined };
  };

  return {
    kernel,
    app,
    ids: { admin, hr, outsider, sales: sales.id, salesTpe: salesTpe.id, finance: finance.id },
    call,
    async login(username, password = PASSWORD) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username, password },
      });
      if (res.statusCode !== 200)
        throw new Error(`login failed for ${username}: ${res.statusCode} ${res.body}`);
      const cookie = res.cookies.find((c) => c.name === 'isbp_session')!;
      const body = res.json() as { csrfToken: string; user: { id: string } };
      return { cookie: `isbp_session=${cookie.value}`, csrf: body.csrfToken, userId: body.user.id };
    },
    async close() {
      await app.close();
      await kernel.close();
    },
  };
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
