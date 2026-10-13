import { type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { z } from 'zod';
import {
  actionItemQuerySchema,
  actionItemSchema,
  applyMinutesSchema,
  createActionItemSchema,
  createMeetingSchema,
  followUpSchema,
  meetingDetailSchema,
  meetingQuerySchema,
  meetingSummarySchema,
  organiseInputSchema,
  organiseResultSchema,
  PERMISSIONS,
  publishResultSchema,
  routedSchema,
  updateActionItemSchema,
  updateMeetingSchema,
} from '../contracts';
import { services } from './services';

const USE = PERMISSIONS.use;
const tags = ['Meetings'];
const refParams = z.object({ ref: z.string().min(1).max(64) });
const idParams = z.object({ id: z.uuid() });

/**
 * REST API mounted at /api/v1/meetings. Every route needs `meetings.meetings.use`; the services then check what the
 * caller may do with the meeting (organiser, attendee, reader of every meeting, admin).
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);

  /* ───────────── meetings ───────────── */

  app.get(
    '/meetings',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Meetings you may see (yours by default), newest first',
        querystring: meetingQuerySchema,
        response: { 200: pageSchema(meetingSummarySchema) },
      },
    },
    async (req) => s.meetings.list(req.query, req.auth),
  );

  app.post(
    '/meetings',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Record a meeting (you organise and attend it); links the records it is about',
        body: createMeetingSchema,
        response: { 201: meetingDetailSchema },
      },
    },
    async (req, reply) => reply.status(201).send(await s.meetings.create(req.body, req.auth)),
  );

  app.get(
    '/meetings/:ref',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'A meeting by reference (MTG-00042) or id: attendees, notes, minutes, action items, earlier open items',
        params: refParams,
        response: { 200: meetingDetailSchema },
      },
    },
    async (req) => s.meetings.detail(req.params.ref, req.auth),
  );

  app.patch(
    '/meetings/:ref',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Change a meeting: details, attendees, notes or minutes (organiser and attendees)',
        params: refParams,
        body: updateMeetingSchema,
        response: { 200: meetingDetailSchema },
      },
    },
    async (req) => s.meetings.update(req.params.ref, req.body, req.auth),
  );

  app.delete(
    '/meetings/:ref',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Delete a meeting (organiser)',
        params: refParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.meetings.remove(req.params.ref, req.auth);
      return reply.status(204).send();
    },
  );

  app.post(
    '/meetings/:ref/organise',
    {
      config: { permission: USE, rateLimit: { max: 20, timeWindow: 60_000 } },
      schema: {
        tags,
        summary:
          'Propose minutes from the notes (AI or builtin): summary, decisions, questions, action items; nothing is stored',
        params: refParams,
        body: organiseInputSchema,
        response: { 200: organiseResultSchema },
      },
    },
    async (req) => s.meetings.organise(req.params.ref, req.body, req.auth),
  );

  app.post(
    '/meetings/:ref/minutes',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'Save the accepted minutes: replaces summary, decisions and questions; adds the action items',
        params: refParams,
        body: applyMinutesSchema,
        response: { 200: meetingDetailSchema },
      },
    },
    async (req) => s.meetings.applyMinutes(req.params.ref, req.body, req.auth),
  );

  app.post(
    '/meetings/:ref/publish',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'Send the minutes: tells the attendees, starts the action items and creates the project tasks (as you)',
        params: refParams,
        response: { 200: publishResultSchema },
      },
    },
    async (req) => s.meetings.publish(req.params.ref, req.auth),
  );

  app.post(
    '/meetings/:ref/follow-up',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'A follow-up meeting (draft) with the same attendees and links; it lists the open items before it',
        params: refParams,
        body: followUpSchema,
        response: { 201: meetingDetailSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await s.meetings.followUp(req.params.ref, req.body, req.auth)),
  );

  /* ───────────── action items ───────────── */

  app.get(
    '/action-items',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Your action items (view=mine) or those of meetings you organised (view=assigned)',
        querystring: actionItemQuerySchema,
        response: { 200: pageSchema(actionItemSchema) },
      },
    },
    async (req) => s.items.list(req.query, req.auth),
  );

  app.post(
    '/meetings/:ref/action-items',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'Add an action item; on sent minutes it starts at once (a task item is created in its project)',
        params: refParams,
        body: createActionItemSchema,
        response: { 201: z.object({ id: z.uuid(), routed: routedSchema.nullable() }) },
      },
    },
    async (req, reply) => {
      const { meeting } = await s.meetings.editable(req.params.ref, req.auth);
      return reply.status(201).send(await s.items.create(meeting, req.body, req.auth));
    },
  );

  app.patch(
    '/action-items/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Change an action item; its owner may mark it done or reopen it',
        params: idParams,
        body: updateActionItemSchema,
        response: { 200: z.object({ id: z.uuid(), routed: routedSchema.nullable() }) },
      },
    },
    async (req) => s.items.update(req.params.id, req.body, req.auth),
  );

  app.delete(
    '/action-items/:id',
    {
      config: { permission: USE },
      schema: { tags, summary: 'Remove an action item', params: idParams, response: { 204: z.undefined() } },
    },
    async (req, reply) => {
      await s.items.remove(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );
}
