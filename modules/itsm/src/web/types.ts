import type { z } from 'zod';
import type {
  assignmentGroupSchema,
  calendarSchema,
  categoryRefSchema,
  changeCalendarItemSchema,
  changeCalendarPageSchema,
  changeConflictSchema,
  changeDetailSchema,
  changeTypeSchema,
  channelSchema,
  groupRefSchema,
  problemDetailSchema,
  queueCountsSchema,
  riskSchema,
  slaBadgeSchema,
  slaMetricSchema,
  slaStatusSchema,
  ticketLinkSchema,
} from '../contracts';

/** Wire types the pages work with (what the API sends). */
export type AssignmentGroup = z.input<typeof assignmentGroupSchema>;
export type GroupRef = z.input<typeof groupRefSchema>;
export type CategoryRef = z.input<typeof categoryRefSchema>;
export type QueueCounts = z.input<typeof queueCountsSchema>;
export type SlaBadge = z.input<typeof slaBadgeSchema>;
export type SlaMetric = z.infer<typeof slaMetricSchema>;
export type SlaStatus = z.infer<typeof slaStatusSchema>;
export type TicketLink = z.input<typeof ticketLinkSchema>;
export type ChangeDetail = z.input<typeof changeDetailSchema>;
export type ProblemDetail = z.input<typeof problemDetailSchema>;
export type ChangeType = z.infer<typeof changeTypeSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type CalendarItem = z.input<typeof changeCalendarItemSchema>;
export type CalendarPage = z.input<typeof changeCalendarPageSchema>;
export type ChangeConflict = z.input<typeof changeConflictSchema>;
export type CalendarDto = z.input<typeof calendarSchema>;

/** A CI as the CMDB lists it (`GET /api/v1/cmdb/cis`): enough to pick and show it. */
export interface CmdbCiOption {
  id: string;
  number: number;
  reference?: string;
  name: string;
  class?: { key: string; name: Record<string, string | undefined>; icon?: string } | null;
}

/** A business service (`GET /api/v1/cmdb/services`): visible to everyone. */
export interface CmdbService {
  id: string;
  number: number;
  reference: string;
  name: string;
  description: string | null;
}

/** A knowledge article suggestion (`GET /api/v1/knowledge/search`). */
export interface ArticleHit {
  id: string;
  reference: string;
  title: string;
  summary: string;
  snippet: string;
  href: string;
}
