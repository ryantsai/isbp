/**
 * Helpdesk AI API contract — shared by the server routes and the web pages.
 *
 * REST endpoints (mounted at /api/v1/helpdesk-ai):
 *
 *   Service desk assist (helpdesk-ai.assist.use)
 *     GET    /tickets/:ticketId/assist        → assistSchema   (mode, triage, similar tickets, articles)
 *     POST   /tickets/:ticketId/triage        → triageInsightSchema   (re-run triage as the agent)
 *     POST   /tickets/:ticketId/reply-draft   → replyDraftSchema
 *     POST   /tickets/:ticketId/summary       → summarySchema   (cached until the ticket changes)
 *     POST   /tickets/:ticketId/kb-draft      → kbDraftSchema   (resolved / closed tickets)
 *     POST   /insights/:id/feedback           insightFeedbackSchema → triageInsightSchema
 *
 *   Virtual agent (helpdesk-ai.chat.use)
 *     GET    /status                          → statusSchema
 *     POST   /conversations                   createConversationSchema → { id } (201)
 *     GET    /conversations                   conversationQuerySchema → page(conversationSchema)
 *                                             (`scope=all` needs helpdesk-ai.insights.read)
 *     GET    /conversations/:id               → conversationDetailSchema
 *     POST   /conversations/:id/messages      postMessageSchema → text/event-stream (ChatStreamEvent)
 *                                             (screenshots: upload to /records/helpdesk-ai.conversation/:id/files
 *                                             first, then send their file ids in `images`)
 *     POST   /conversations/:id/resolve       → conversationSchema   ("that solved it" = deflected)
 *     POST   /conversations/:id/escalate      ticketProposalSchema → escalateResultSchema (creates the ticket)
 *
 *   Insights (helpdesk-ai.insights.read, or itsm.reports.read: metrics only — no conversations)
 *     GET    /insights/overview               overviewQuerySchema → overviewSchema
 *     GET    /insights/pending                overviewQuerySchema → pendingTriageSchema
 */
import { dateTime } from '@isbp/contracts';
import { listQuerySchema } from '@isbp/sdk';
import { z } from 'zod';

const id = z.uuid();

/* ───────────────────────────── enums ───────────────────────────── */

export const CHAT_LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
export const chatLocaleSchema = z.enum(CHAT_LOCALES);
export type ChatLocale = z.infer<typeof chatLocaleSchema>;

/** `builtin` = retrieval / extractive (no chat model configured); `llm` = a generative model wrote it. */
export const aiModeSchema = z.enum(['builtin', 'llm']);
export type AiMode = z.infer<typeof aiModeSchema>;

export const insightKindSchema = z.enum(['triage', 'summary', 'kb_draft']);
export type InsightKind = z.infer<typeof insightKindSchema>;

export const insightStatusSchema = z.enum([
  'suggested',
  'applied',
  'partially_applied',
  'dismissed',
  'auto_applied',
]);
export type InsightStatus = z.infer<typeof insightStatusSchema>;

export const conversationStatusSchema = z.enum(['open', 'resolved', 'escalated']);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

/** Ticket fields a triage suggestion covers (`priority` follows from impact × urgency). */
export const triageFieldSchema = z.enum(['category', 'group', 'impact', 'urgency']);
export type TriageField = z.infer<typeof triageFieldSchema>;

/* ───────────────────────────── shared shapes ───────────────────────────── */

/** Which model (if any) answers: shown honestly in every AI surface. */
export const aiInfoSchema = z.object({
  mode: aiModeSchema,
  provider: z.string(),
  model: z.string().nullable(),
});
export type AiInfo = z.input<typeof aiInfoSchema>;

/** A numbered knowledge-base source (`[1]` in the text). */
export const citationSchema = z.object({
  n: z.number().int().min(1),
  id: z.string().optional(),
  reference: z.string(),
  title: z.string(),
  href: z.string(),
  snippet: z.string().optional(),
  /** The passage is from a file attached to the article. */
  attachment: z.object({ name: z.string(), page: z.number().int().nullable() }).nullable().optional(),
});
export type Citation = z.infer<typeof citationSchema>;

/** A ticket the virtual agent suggests; nothing is created until the user confirms it. */
export const ticketProposalSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20_000),
  urgency: z.number().int().min(1).max(3),
  type: z.enum(['incident', 'service_request']),
});
export type TicketProposal = z.infer<typeof ticketProposalSchema>;

const personSchema = z.object({ id, displayName: z.string(), avatarUrl: z.string().nullable() });

/* ───────────────────────────── triage ───────────────────────────── */

export const triageNeighbourSchema = z.object({
  id: z.string(),
  reference: z.string(),
  title: z.string(),
  /** Cosine similarity 0–1. */
  similarity: z.number(),
  categoryId: z.string().nullable(),
  assignmentGroupId: z.string().nullable(),
  resolutionCode: z.string().nullable(),
  href: z.string().nullable(),
});
export type TriageNeighbour = z.infer<typeof triageNeighbourSchema>;

export const triageSuggestionSchema = z.object({
  categoryId: id.nullable(),
  categoryPath: z.string().nullable(),
  assignmentGroupId: id.nullable(),
  assignmentGroupName: z.string().nullable(),
  impact: z.number().int().min(1).max(3),
  urgency: z.number().int().min(1).max(3),
  priority: z.number().int().min(1).max(4),
});
export type TriageSuggestion = z.infer<typeof triageSuggestionSchema>;

export const triageDataSchema = z.object({
  suggestion: triageSuggestionSchema,
  /** Per-field confidence 0–1 (the insight's `confidence` is the overall one). */
  fieldConfidence: z.object({
    category: z.number(),
    group: z.number(),
    impact: z.number(),
    urgency: z.number(),
  }),
  /**
   * Written by the model (LLM mode), or the builtin explanation in the requester's language. The panel renders
   * builtin explanations from `neighbours` and `keywords` in the viewer's language instead; this text is the
   * fallback (and what auto-triage writes on the ticket).
   */
  rationale: z.string(),
  /** The most similar resolved tickets the vote used. */
  neighbours: z.array(triageNeighbourSchema),
  /** Keywords that raised impact or urgency. */
  keywords: z.object({ impact: z.array(z.string()), urgency: z.array(z.string()) }),
  /** The model was configured but failed or answered with invalid ids, so the builtin vote was used. */
  fallback: z.boolean().default(false),
});
export type TriageData = z.infer<typeof triageDataSchema>;

export const insightFeedbackRecordSchema = z.object({
  action: insightStatusSchema,
  fields: z.array(z.string()),
  by: z.object({ id: id.nullable(), name: z.string() }).nullable(),
  at: z.string(),
});
export type InsightFeedbackRecord = z.infer<typeof insightFeedbackRecordSchema>;

export const triageInsightSchema = z.object({
  id,
  ticketId: id,
  ticketRef: z.string(),
  confidence: z.number().nullable(),
  mode: aiModeSchema,
  model: z.string().nullable(),
  status: insightStatusSchema,
  feedback: insightFeedbackRecordSchema.nullable(),
  data: triageDataSchema,
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type TriageInsight = z.input<typeof triageInsightSchema>;

export const insightFeedbackSchema = z.object({
  action: z.enum(['applied', 'partially_applied', 'dismissed']),
  fields: z.array(triageFieldSchema).max(4).optional(),
});
export type InsightFeedbackInput = z.input<typeof insightFeedbackSchema>;

/* ───────────────────────────── assist panel ───────────────────────────── */

/** Similar tickets and articles below this similarity are noise and are not shown to agents. */
export const SHOW_SIMILARITY = 0.25;
/** Similar tickets and articles listed before "Show more". */
export const SHOW_FIRST = 3;
/** Confidence below which a triage suggestion says "check before applying" and doesn't push "Apply all". */
export const LOW_CONFIDENCE = 0.4;

export const similarTicketSchema = z.object({
  id: z.string(),
  reference: z.string(),
  title: z.string(),
  snippet: z.string(),
  similarity: z.number(),
  resolutionCode: z.string().nullable(),
  href: z.string(),
  /** Ticket type (`incident`, …) when known. */
  type: z.string().nullable(),
  /** Still being worked (problems also list open incidents): its status; null for resolved ones. */
  status: z.string().nullable(),
});
export type SimilarTicket = z.input<typeof similarTicketSchema>;

export const suggestedArticleSchema = z.object({
  id: z.string(),
  reference: z.string(),
  title: z.string(),
  summary: z.string(),
  snippet: z.string(),
  href: z.string(),
  similarity: z.number(),
});
export type SuggestedArticle = z.input<typeof suggestedArticleSchema>;

export const summaryUpdateSchema = z.object({
  author: z.string().nullable(),
  at: z.string(),
  body: z.string(),
  public: z.boolean(),
  kind: z.string(),
});

/** Extractive summary parts; the web renders the headings in the viewer's language. */
export const summarySectionsSchema = z.object({
  issue: z.string(),
  updates: z.array(summaryUpdateSchema),
  state: z.object({
    status: z.string(),
    priority: z.number().int(),
    group: z.string().nullable(),
    assignee: z.string().nullable(),
    resolutionCode: z.string().nullable(),
    resolutionNotes: z.string().nullable(),
  }),
});
export type SummarySections = z.infer<typeof summarySectionsSchema>;

export const summarySchema = z.object({
  mode: aiModeSchema,
  model: z.string().nullable(),
  locale: chatLocaleSchema,
  /** LLM mode: abstractive Markdown. */
  text: z.string().nullable(),
  /** Builtin mode: extractive sections. */
  sections: summarySectionsSchema.nullable(),
  generatedAt: dateTime,
  cached: z.boolean(),
  fallback: z.boolean(),
});
export type TicketSummary = z.input<typeof summarySchema>;

export const kbDraftSchema = z.object({
  articleId: z.string(),
  reference: z.string(),
  href: z.string(),
  title: z.string(),
  mode: aiModeSchema,
  model: z.string().nullable(),
  createdAt: dateTime,
  /** A draft was already generated from this ticket earlier (no duplicate is created). */
  existing: z.boolean(),
});
export type KbDraft = z.input<typeof kbDraftSchema>;

export const replyDraftSchema = z.object({
  text: z.string(),
  /** `text` plus a "Sources" list for the cited articles, in the requester's language — what goes in the reply. */
  insertText: z.string(),
  citations: z.array(citationSchema),
  mode: aiModeSchema,
  model: z.string().nullable(),
  /** The requester's language the reply is written in. */
  locale: chatLocaleSchema,
  fallback: z.boolean(),
});
export type ReplyDraft = z.input<typeof replyDraftSchema>;

export const assistSchema = z.object({
  ai: aiInfoSchema,
  settings: z.object({ triageEnabled: z.boolean(), suggestReplies: z.boolean() }),
  /** Only for incidents and service requests that are still being worked. */
  triage: triageInsightSchema.nullable(),
  /** The cached summary when it is still current. */
  summary: summarySchema.nullable(),
  kbDraft: kbDraftSchema.nullable(),
  /**
   * Clearly similar tickets (at least `SHOW_SIMILARITY`), best first: resolved ones; on a problem, its
   * candidate incidents — open ones first, then resolved. None on changes.
   */
  similar: z.array(similarTicketSchema),
  /** Clearly relevant articles (at least `SHOW_SIMILARITY`), best first. None on changes. */
  articles: z.array(suggestedArticleSchema),
});
export type Assist = z.input<typeof assistSchema>;

export const ticketParams = z.object({ ticketId: id });

/* ───────────────────────────── virtual agent ───────────────────────────── */

export const statusSchema = z.object({
  ai: aiInfoSchema,
  virtualAgentEnabled: z.boolean(),
  /** Screenshots can be attached (an image description model is set, or the chat model may look at images). */
  images: z.boolean(),
});
export type HelpdeskAiStatus = z.input<typeof statusSchema>;

export const conversationSchema = z.object({
  id,
  title: z.string(),
  locale: chatLocaleSchema,
  status: conversationStatusSchema,
  ticketId: id.nullable(),
  ticketRef: z.string().nullable(),
  deflected: z.boolean(),
  mode: aiModeSchema,
  messageCount: z.number().int(),
  user: personSchema.nullable(),
  createdAt: dateTime,
  updatedAt: dateTime,
});
export type Conversation = z.input<typeof conversationSchema>;

/** A screenshot attached to a question: a file on the conversation, and (once read) what it shows. */
export interface ChatImageRef {
  fileId: string;
  name: string;
  /** The image description model's text, used for search and sent to a chat model that may not see images. */
  description?: string | null;
}

/** The `tool` stream event shown while a question's screenshots are read. */
export const READ_IMAGES_TOOL = 'read_images';

/** Screenshots per question, and the image types and size a vision model reads. */
export const MAX_CHAT_IMAGES = 3;
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

export const chatImageSchema = z.object({ id, name: z.string(), href: z.string() });
export type ChatImage = z.input<typeof chatImageSchema>;

export const chatMessageSchema = z.object({
  id,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  images: z.array(chatImageSchema),
  citations: z.array(citationSchema),
  proposal: ticketProposalSchema.nullable(),
  mode: aiModeSchema.nullable(),
  model: z.string().nullable(),
  createdAt: dateTime,
});
export type ChatMessage = z.input<typeof chatMessageSchema>;

export const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(chatMessageSchema),
});
export type ConversationDetail = z.input<typeof conversationDetailSchema>;

export const conversationQuerySchema = listQuerySchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: conversationStatusSchema.optional(),
});
export type ConversationQuery = z.input<typeof conversationQuerySchema>;

export const createConversationSchema = z.object({ locale: chatLocaleSchema.optional() });
export const postMessageSchema = z
  .object({
    content: z.string().trim().max(4_000),
    /** Files already uploaded to the conversation (`/records/helpdesk-ai.conversation/:id/files`). */
    images: z.array(id).max(MAX_CHAT_IMAGES).optional(),
  })
  .refine((v) => v.content.length > 0 || (v.images?.length ?? 0) > 0, {
    path: ['content'],
    message: 'Ask a question or attach a screenshot',
  });

export const escalateResultSchema = z.object({
  ticket: z.object({ id: z.string(), reference: z.string(), href: z.string() }),
  conversation: conversationSchema,
  /**
   * The ticket was raised and linked, but "I've raised …" could not be added to the conversation (nor audited):
   * the escalation still succeeded. A later retry of the request adds it.
   */
  warning: z.enum(['not_recorded']).nullable(),
});
export type EscalateResult = z.input<typeof escalateResultSchema>;

/**
 * Server-Sent Events of `POST /conversations/:id/messages`: text deltas, the cited articles, an optional
 * ticket proposal, then `done` (or `error` with an error code).
 */
export type ChatStreamEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'tool'; data: { name: string } }
  | { event: 'citations'; data: { items: Citation[] } }
  | { event: 'proposal'; data: TicketProposal }
  | { event: 'done'; data: { messageId: string; mode: AiMode; model: string | null } }
  | { event: 'error'; data: { code: string } };

/* ───────────────────────────── insights ───────────────────────────── */

export const overviewQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) });

export const overviewSchema = z.object({
  days: z.number().int(),
  ai: aiInfoSchema.extend({ embeddings: z.string(), vectorStore: z.string() }),
  settings: z.object({
    triageEnabled: z.boolean(),
    autoTriage: z.boolean(),
    autoTriageThreshold: z.number(),
    virtualAgentEnabled: z.boolean(),
    suggestReplies: z.boolean(),
  }),
  triage: z.object({
    suggestions: z.number().int(),
    pending: z.number().int(),
    applied: z.number().int(),
    partiallyApplied: z.number().int(),
    autoApplied: z.number().int(),
    dismissed: z.number().int(),
    /** Accepted (applied, partly or automatically) ÷ decided; null until something was decided. */
    acceptanceRate: z.number().nullable(),
    averageConfidence: z.number().nullable(),
  }),
  conversations: z.object({
    total: z.number().int(),
    open: z.number().int(),
    deflected: z.number().int(),
    escalated: z.number().int(),
    /** Deflected ÷ conversations with an outcome; null until one has an outcome. */
    deflectionRate: z.number().nullable(),
  }),
  kbDrafts: z.number().int(),
  summaries: z.number().int(),
  usage: z.object({
    calls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    byFeature: z.array(
      z.object({
        feature: z.string(),
        calls: z.number().int(),
        errors: z.number().int(),
        inputTokens: z.number().int(),
        outputTokens: z.number().int(),
        costUsd: z.number(),
      }),
    ),
  }),
  /** One point per day (viewer's time zone). */
  daily: z.array(
    z.object({
      date: z.string(),
      conversations: z.number().int(),
      escalations: z.number().int(),
      deflections: z.number().int(),
      triage: z.number().int(),
    }),
  ),
});
export type Overview = z.input<typeof overviewSchema>;

/** Triage suggestions waiting for an agent on open tickets (`GET /insights/pending`). */
export const pendingTriageSchema = z.object({
  total: z.number().int(),
  items: z.array(
    z.object({
      insightId: id,
      ticketId: id,
      reference: z.string(),
      href: z.string(),
      /** Only for callers who may read every ticket. */
      title: z.string().nullable(),
      status: z.string(),
      suggestion: z.object({
        categoryPath: z.string().nullable(),
        assignmentGroupName: z.string().nullable(),
        priority: z.number().int().nullable(),
      }),
      confidence: z.number().nullable(),
      createdAt: dateTime,
    }),
  ),
});
export type PendingTriage = z.input<typeof pendingTriageSchema>;

/* ───────────────────────────── server-side (output) types ───────────────────────────── */

/** What route handlers return (dates as `Date`); the `z.input` types above are what clients receive. */
export type Out = {
  TriageInsight: z.output<typeof triageInsightSchema>;
  Assist: z.output<typeof assistSchema>;
  ReplyDraft: z.output<typeof replyDraftSchema>;
  TicketSummary: z.output<typeof summarySchema>;
  KbDraft: z.output<typeof kbDraftSchema>;
  Conversation: z.output<typeof conversationSchema>;
  ChatMessage: z.output<typeof chatMessageSchema>;
  ConversationDetail: z.output<typeof conversationDetailSchema>;
  EscalateResult: z.output<typeof escalateResultSchema>;
  Overview: z.output<typeof overviewSchema>;
  PendingTriage: z.output<typeof pendingTriageSchema>;
};
