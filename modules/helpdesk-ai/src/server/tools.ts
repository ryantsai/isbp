import {
  type AiTicket,
  type AiTriageOptions,
  aiTicketSchema,
  aiTriageOptionsSchema,
} from '@isbp/module-itsm/contracts';
import type { AiArticle, AiArticleHit, AiCreateDraftOutput } from '@isbp/module-knowledge/contracts';
import { type AuthContext, ErrorCodes, HttpError, type ModuleContext } from '@isbp/sdk/server';
import type { ChatLocale } from '../contracts';

/**
 * Typed access to the ITSM and knowledge tools through the AI gateway's registry — the only way this
 * module reaches tickets and articles. Every call carries an identity: the signed-in user (interactive
 * features) or the module's agent identity (background triage). The registry checks the permission,
 * validates the input and audits the call.
 */
export class Tools {
  constructor(private readonly ctx: ModuleContext) {}

  private invoke<T>(name: string, input: unknown, auth: AuthContext, confirmed?: boolean) {
    return this.ctx.ai.tools.invoke<T>(name, input, { auth, confirmed });
  }

  /** Whether `auth` may call `name` (enabled module and permission), without calling it. */
  available(name: string, auth: AuthContext): boolean {
    return this.ctx.ai.tools.list(auth).some((t) => t.name === name);
  }

  async ticket(auth: AuthContext, ref: { id?: string; reference?: string }): Promise<AiTicket> {
    const raw = await this.invoke<unknown>('itsm.get_ticket', ref, auth);
    return aiTicketSchema.parse(raw);
  }

  async triageOptions(auth: AuthContext): Promise<AiTriageOptions> {
    return aiTriageOptionsSchema.parse(await this.invoke<unknown>('itsm.get_triage_options', {}, auth));
  }

  triageTicket(auth: AuthContext, input: Record<string, unknown>) {
    return this.invoke<unknown>('itsm.triage_ticket', input, auth);
  }

  async createTicket(
    auth: AuthContext,
    input: {
      type: 'incident' | 'service_request';
      title: string;
      description: string;
      urgency?: number;
      channel: 'chat' | 'portal' | 'ai';
    },
  ): Promise<{ id: string; reference: string; href: string }> {
    const res = await this.invoke<Record<string, unknown>>('itsm.create_ticket', input, auth);
    const ticket = (res?.ticket as Record<string, unknown> | undefined) ?? res;
    const reference = String(ticket?.reference ?? '');
    const id = String(ticket?.id ?? '');
    if (!reference || !id)
      throw new HttpError(502, ErrorCodes.INTERNAL, 'itsm.create_ticket returned no ticket');
    return { id, reference, href: String(ticket?.href ?? `/itsm/tickets/${reference}`) };
  }

  /** Articles the caller may read; an unavailable knowledge base yields no articles, not an error. */
  async searchArticles(
    auth: AuthContext,
    query: string,
    opts: { limit?: number; locale?: ChatLocale; categoryIds?: readonly string[] } = {},
  ): Promise<AiArticleHit[]> {
    const q = query.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!q || !this.available('knowledge.search_articles', auth)) return [];
    try {
      const res = await this.invoke<{ items?: AiArticleHit[] }>(
        'knowledge.search_articles',
        {
          query: q,
          limit: opts.limit ?? 5,
          ...(opts.locale ? { locale: opts.locale } : {}),
          ...(opts.categoryIds?.length ? { categoryIds: [...opts.categoryIds] } : {}),
        },
        auth,
      );
      return res?.items ?? [];
    } catch (err) {
      this.ctx.logger.warn({ err }, 'knowledge.search_articles failed');
      return [];
    }
  }

  async article(auth: AuthContext, ref: { id?: string; reference?: string }): Promise<AiArticle | null> {
    try {
      return await this.invoke<AiArticle>('knowledge.get_article', ref, auth);
    } catch (err) {
      this.ctx.logger.warn({ err }, 'knowledge.get_article failed');
      return null;
    }
  }

  createDraft(auth: AuthContext, input: Record<string, unknown>) {
    return this.invoke<AiCreateDraftOutput>('knowledge.create_draft', input, auth);
  }

  /** Raw tool call for the virtual agent's model-requested read tools. */
  call(name: string, input: unknown, auth: AuthContext) {
    return this.invoke<unknown>(name, input, auth);
  }
}

/** Items of a list-shaped tool result (`[...]` or `{ items: [...] }`). */
export function itemsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const items = (result as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}
