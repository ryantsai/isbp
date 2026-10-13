import { defineManifest } from '@isbp/sdk';
import { z } from 'zod';
import { aiCreateMinutesInput, aiFindMeetingsInput, aiMyActionItemsInput, PERMISSIONS } from './contracts';

const meetingRef = z.object({ meetingId: z.uuid(), reference: z.string(), title: z.string() });
const itemRef = meetingRef.extend({ itemId: z.uuid(), item: z.string(), ownerId: z.uuid().nullable() });

/**
 * Meeting minutes (Phase 11, `docs/architecture.md` §17.4–17.5): meetings with attendees and notes typed by hand,
 * organised (AI or builtin) into a summary, decisions, open questions and action items. Action items become project
 * tasks through the AI tool registry, as the person sending the minutes, or are tracked here with reminders.
 * Meetings link to any record through `ctx.records`; the module depends on no other.
 */
export const manifest = defineManifest({
  id: 'meetings',
  version: '0.1.0',
  name: 'meetings.meta.name',
  description: 'meetings.meta.description',
  icon: 'notebook-text',
  dependsOn: [],
  navigation: [
    {
      // A personal entry like Knowledge: everyone takes part in meetings. Items reach their owners on My work.
      id: 'meetings',
      label: 'meetings.nav.meetings',
      href: '/meetings',
      icon: 'notebook-text',
      permission: PERMISSIONS.use,
      section: 'main',
      order: 6,
      tabs: [
        {
          id: 'action-items',
          label: 'meetings.nav.actionItems',
          href: '/meetings/action-items',
          icon: 'list-checks',
          permission: PERMISSIONS.use,
        },
      ],
    },
  ],
  work: [
    {
      key: 'action-items',
      label: 'meetings.work.actionItems',
      kind: 'task',
      icon: 'list-checks',
      href: '/meetings/action-items',
    },
  ],
  permissions: [
    { key: PERMISSIONS.use, description: 'meetings.permissions.use' },
    { key: PERMISSIONS.read, description: 'meetings.permissions.read' },
    { key: PERMISSIONS.admin, description: 'meetings.permissions.admin' },
  ],
  roles: [
    {
      key: 'meetings-member',
      name: 'Meeting participant',
      description: 'Record meetings, read the ones you may and work on your action items',
      permissions: [PERMISSIONS.use],
      grantByDefault: true,
    },
    {
      key: 'meetings-reader',
      name: 'Meeting reader',
      description: 'Read every meeting, private ones included',
      permissions: [PERMISSIONS.use, PERMISSIONS.read],
    },
    {
      key: 'meetings-admin',
      name: 'Meetings administrator',
      description: 'Manage every meeting',
      permissions: ['meetings.*'],
    },
  ],
  events: {
    emits: [
      { name: 'meetings.meeting.created', schema: meetingRef },
      { name: 'meetings.meeting.updated', schema: meetingRef.extend({ changes: z.array(z.string()) }) },
      { name: 'meetings.meeting.published', schema: meetingRef.extend({ items: z.number().int() }) },
      { name: 'meetings.meeting.deleted', schema: meetingRef },
      { name: 'meetings.action-item.created', schema: itemRef },
      { name: 'meetings.action-item.updated', schema: itemRef.extend({ changes: z.array(z.string()) }) },
      { name: 'meetings.action-item.routed', schema: itemRef.extend({ taskId: z.uuid(), task: z.string() }) },
      { name: 'meetings.action-item.deleted', schema: itemRef },
    ],
    consumes: [
      'core.user.offboarded',
      // Items that became project tasks follow their task (the task is where the work happens).
      'projects.task.status_changed',
      'projects.task.assigned',
      'projects.task.deleted',
      // Minutes are searchable after commit (items are part of the text, and their owners read the meeting).
      'meetings.meeting.created',
      'meetings.meeting.updated',
      'meetings.meeting.published',
      'meetings.meeting.deleted',
      'meetings.action-item.created',
      'meetings.action-item.updated',
      'meetings.action-item.deleted',
    ],
  },
  notifications: [
    { type: 'meetings.minutes.published', defaultChannels: ['inApp', 'email'] },
    { type: 'meetings.action-item.assigned', defaultChannels: ['inApp', 'email'] },
    { type: 'meetings.action-item.due_soon', defaultChannels: ['inApp', 'email'] },
    { type: 'meetings.action-item.overdue', defaultChannels: ['inApp', 'email'] },
  ],
  ai: {
    tools: [
      {
        name: 'meetings.find_meetings',
        description:
          'Find meetings the caller may read, by words in their minutes and notes, by project (key such as NET, or project ids) and by date range (YYYY-MM-DD). Returns references like MTG-00042, dates, summaries, decisions and action items with owners, due dates and status. Use it for "what did we decide about the firewall?" or "what came out of last week\'s project meetings?".',
        input: aiFindMeetingsInput,
        permission: PERMISSIONS.use,
        readOnly: true,
      },
      {
        name: 'meetings.my_action_items',
        description:
          "The caller's action items from meeting minutes (open by default): what, from which meeting, due when. Items that became project tasks are listed with the task reference.",
        input: aiMyActionItemsInput,
        permission: PERMISSIONS.use,
        readOnly: true,
      },
      {
        name: 'meetings.create_minutes',
        description:
          'Record a meeting as a draft for the caller: title, start (ISO date-time), attendees by email and the notes as taken; optionally link it to a project (key such as NET). Returns the reference and link; the caller organises the notes into decisions and action items and sends the minutes on the meeting page.',
        input: aiCreateMinutesInput,
        permission: PERMISSIONS.use,
      },
    ],
  },
  search: { entities: ['meeting'] },
  records: {
    types: [
      {
        type: 'meeting',
        name: 'meetings.entities.meeting',
        icon: 'notebook-text',
        permission: PERMISSIONS.use,
      },
    ],
  },
});
