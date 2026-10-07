import { ErrorCodes, HttpError, httpErrors, localize, type ModuleContext } from '@isbp/sdk/server';
import { asc, count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { createClassSchema, updateClassSchema } from '../contracts';
import { type ClassRow } from './refs';
import { ciClasses, cis } from './schema';

const ENTITY = 'cmdb.class';

function toDto(c: ClassRow, ciCount: number) {
  return {
    key: c.key,
    name: c.name,
    description: c.description,
    icon: c.icon,
    system: c.system,
    sortOrder: c.sortOrder,
    ciCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** CI classes: system ones come from the migration; admins add their own, rename and re-icon any. */
export class ClassService {
  constructor(private readonly ctx: ModuleContext) {}

  async list() {
    const [rows, counts] = await Promise.all([
      this.ctx.db.select().from(ciClasses).orderBy(asc(ciClasses.sortOrder), asc(ciClasses.key)),
      this.ctx.db.select({ key: cis.classKey, n: count() }).from(cis).groupBy(cis.classKey),
    ]);
    const used = new Map(counts.map((c) => [c.key, c.n]));
    return rows.map((r) => toDto(r, used.get(r.key) ?? 0));
  }

  async find(key: string) {
    const [row] = await this.ctx.db.select().from(ciClasses).where(eq(ciClasses.key, key));
    if (!row) throw httpErrors.notFound('Class not found');
    const [used] = await this.ctx.db.select({ n: count() }).from(cis).where(eq(cis.classKey, key));
    return toDto(row, used!.n);
  }

  async create(input: z.output<typeof createClassSchema>) {
    const [existing] = await this.ctx.db
      .select({ key: ciClasses.key })
      .from(ciClasses)
      .where(eq(ciClasses.key, input.key));
    if (existing)
      throw new HttpError(409, ErrorCodes.CONFLICT, 'A class with this key already exists', {
        issues: [{ path: 'key', message: 'Already taken' }],
      });
    await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(ciClasses)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon,
          sortOrder: input.sortOrder,
          system: false,
        })
        .returning();
      await this.ctx.audit.record(
        {
          action: 'cmdb.class.created',
          entityType: ENTITY,
          entityId: row!.key,
          entityLabel: localize(row!.name, 'en'),
          metadata: { icon: row!.icon },
        },
        { tx },
      );
    });
    return this.find(input.key);
  }

  async update(key: string, input: z.output<typeof updateClassSchema>) {
    const [before] = await this.ctx.db.select().from(ciClasses).where(eq(ciClasses.key, key));
    if (!before) throw httpErrors.notFound('Class not found');
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    if (Object.keys(changes).length)
      await this.ctx.transaction(async (tx) => {
        const [row] = await tx.update(ciClasses).set(input).where(eq(ciClasses.key, key)).returning();
        await this.ctx.audit.record(
          {
            action: 'cmdb.class.updated',
            entityType: ENTITY,
            entityId: key,
            entityLabel: localize(row!.name, 'en'),
            changes,
          },
          { tx },
        );
      });
    return this.find(key);
  }

  /** System classes stay; a class with CIs can't go (`IN_USE` names how many). */
  async remove(key: string) {
    const found = await this.find(key);
    if (found.system)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'System classes cannot be deleted', { key });
    if (found.ciCount > 0)
      throw new HttpError(409, ErrorCodes.IN_USE, 'Configuration items still use this class', {
        key,
        ciCount: found.ciCount,
      });
    await this.ctx.transaction(async (tx) => {
      await tx.delete(ciClasses).where(eq(ciClasses.key, key));
      await this.ctx.audit.record(
        {
          action: 'cmdb.class.deleted',
          entityType: ENTITY,
          entityId: key,
          entityLabel: localize(found.name, 'en'),
        },
        { tx },
      );
    });
  }
}
