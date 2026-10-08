import type { AiMessage, AiToolCall } from '@isbp/sdk/server';

/** The columns of a stored conversation turn that matter to the model. */
export interface StoredTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: AiToolCall[] | null;
  toolCallId: string | null;
  isError: boolean;
  native: AiMessage['native'] | null;
}

/**
 * Stored turns → `AiMessage[]` for the gateway, in order. Assistant turns keep their native content so
 * the same model replays them unchanged. A turn interrupted mid-tool-loop (a call without a stored
 * result) is repaired: unanswered calls are dropped (and the native copy with them, since it contains
 * them), and stray tool results are skipped, so providers never see a dangling tool call.
 */
export function toAiMessages(turns: readonly StoredTurn[]): AiMessage[] {
  const answered = new Set(turns.filter((t) => t.role === 'tool' && t.toolCallId).map((t) => t.toolCallId!));
  const out: AiMessage[] = [];
  let open = new Set<string>();
  for (const t of turns) {
    if (t.role === 'user') {
      open = new Set();
      out.push({ role: 'user', content: t.content });
    } else if (t.role === 'assistant') {
      const calls = t.toolCalls ?? [];
      const kept = calls.filter((c) => answered.has(c.id));
      const intact = kept.length === calls.length;
      open = new Set(kept.map((c) => c.id));
      if (!t.content && !kept.length) continue;
      out.push({
        role: 'assistant',
        content: t.content,
        ...(kept.length ? { toolCalls: kept } : {}),
        ...(t.native && intact ? { native: t.native } : {}),
      });
    } else {
      if (!t.toolCallId || !open.has(t.toolCallId)) continue;
      open.delete(t.toolCallId);
      out.push({
        role: 'tool',
        toolCallId: t.toolCallId,
        content: t.content,
        ...(t.isError ? { isError: true } : {}),
      });
    }
  }
  return out;
}
