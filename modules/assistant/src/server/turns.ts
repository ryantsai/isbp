import type { Db, ModuleContext } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import { conversations, type MessageRow, messages } from './schema';

/** A turn to store (the conversation and its sequence number are filled in). */
export type NewTurn = Omit<typeof messages.$inferInsert, 'conversationId' | 'seq'>;

/**
 * Appends turns to a conversation in order, numbering them after the last one (the conversation row is locked, so
 * concurrent appends never share a number). Runs in `tx` when given, else in its own transaction.
 */
export async function appendTurns(
  ctx: ModuleContext,
  conversationId: string,
  turns: readonly NewTurn[],
  tx?: Db,
): Promise<MessageRow[]> {
  if (!turns.length) return [];
  const run = async (db: Db) => {
    const [conv] = await db
      .select({ n: conversations.messageCount })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    if (!conv) return [];
    const start = conv.n;
    const rows = await db
      .insert(messages)
      .values(turns.map((t, i) => ({ ...t, conversationId, seq: start + i })))
      .returning();
    await db
      .update(conversations)
      .set({ messageCount: start + turns.length, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return rows;
  };
  return tx ? run(tx) : ctx.transaction(run);
}
