import { departments } from '@isbp/db/schema';
import { likePattern, type ModuleContext, type ModuleRouter, pageSchema } from '@isbp/sdk/server';
import { asc, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  activitySchema,
  addDependencySchema,
  addMemberSchema,
  boardQuerySchema,
  boardSchema,
  commentInputSchema,
  commentSchema,
  createMilestoneSchema,
  createProjectSchema,
  createTaskSchema,
  lookupQuerySchema,
  memberSchema,
  milestoneSchema,
  moveTaskSchema,
  myTasksSchema,
  projectDetailSchema,
  projectHealthChangeSchema,
  projectQuerySchema,
  projectStatusChangeSchema,
  projectSummarySchema,
  reorderMilestonesSchema,
  taskDetailSchema,
  taskListItemSchema,
  taskQuerySchema,
  taskRefParam,
  taskStatusSchema,
  timelineQuerySchema,
  timelineSchema,
  updateMemberSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateTaskSchema,
  workloadQuerySchema,
  workloadSchema,
} from '../contracts';
import { PERMISSIONS } from '../model';
import { services } from './services';
import { statusRoutes } from './status-routes';

const USE = PERMISSIONS.use;
const CREATE = PERMISSIONS.create;

/** A project key (`NET`) or id. */
const keyParams = z.object({ key: z.string().min(1).max(64) });
const taskParams = z.object({ ref: taskRefParam });
const tags = ['Projects'];
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/**
 * REST API mounted at /api/v1/projects. Routes need `projects.projects.use` (or `create`); the services
 * then check the caller's role in the project on every read and write.
 */
export function routes(app: ModuleRouter, ctx: ModuleContext) {
  const s = services(ctx);

  /* ───────────── projects ───────────── */

  app.get(
    '/projects',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Projects you can see, with task counts, progress, overdue tasks and the next milestone',
        querystring: projectQuerySchema,
        response: { 200: pageSchema(projectSummarySchema) },
      },
    },
    async (req) => s.projects.list(req.query, req.auth),
  );

  app.post(
    '/projects',
    {
      config: { permission: CREATE },
      schema: {
        tags,
        summary: 'Propose a project (you and the owner become its managers)',
        body: createProjectSchema,
        response: { 201: projectDetailSchema },
      },
    },
    async (req, reply) => {
      const project = await s.projects.create(req.body, req.auth);
      return reply.status(201).send(await s.projects.detail(project.id, req.auth));
    },
  );

  app.get(
    '/projects/:key',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'A project by key (NET) or id: members, milestones, KPIs, health history and approval',
        params: keyParams,
        response: { 200: projectDetailSchema },
      },
    },
    async (req) => s.projects.detail(req.params.key, req.auth),
  );

  app.patch(
    '/projects/:key',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Edit a project (managers); the key only changes while there are no tasks',
        params: keyParams,
        body: updateProjectSchema,
        response: { 200: projectDetailSchema },
      },
    },
    async (req) => {
      const project = await s.projects.update(req.params.key, req.body, req.auth);
      return s.projects.detail(project.id, req.auth);
    },
  );

  app.delete(
    '/projects/:key',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Delete a project: managers while it is empty, admins always',
        params: keyParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.projects.remove(req.params.key, req.auth);
      return reply.status(204).send();
    },
  );

  app.post(
    '/projects/:key/start',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Start a proposed project: submits it to the projects.proposal approval workflow',
        params: keyParams,
        response: { 200: projectDetailSchema },
      },
    },
    async (req) => {
      const project = await s.projects.start(req.params.key, req.auth);
      return s.projects.detail(project.id, req.auth);
    },
  );

  app.post(
    '/projects/:key/status',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Hold, resume, complete (all tasks closed, or force with a comment) or cancel a project',
        params: keyParams,
        body: projectStatusChangeSchema,
        response: { 200: projectDetailSchema },
      },
    },
    async (req) => {
      const project = await s.projects.changeStatus(req.params.key, req.body, req.auth);
      return s.projects.detail(project.id, req.auth);
    },
  );

  app.post(
    '/projects/:key/health',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Set the health with a note (members are notified when at risk or off track)',
        params: keyParams,
        body: projectHealthChangeSchema,
        response: { 200: projectDetailSchema },
      },
    },
    async (req) => {
      const project = await s.projects.setHealth(req.params.key, req.body, req.auth);
      return s.projects.detail(project.id, req.auth);
    },
  );

  /* ───────────── members ───────────── */

  app.get(
    '/projects/:key/members',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Members with role and allocation',
        params: keyParams,
        response: { 200: items(memberSchema) },
      },
    },
    async (req) => ({ items: await s.projects.members(req.params.key, req.auth) }),
  );

  app.post(
    '/projects/:key/members',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Add a member (managers)',
        params: keyParams,
        body: addMemberSchema,
        response: { 201: items(memberSchema) },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ items: await s.projects.addMember(req.params.key, req.body, req.auth) }),
  );

  app.patch(
    '/projects/:key/members/:userId',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: "Change a member's role or allocation (managers)",
        params: keyParams.extend({ userId: z.uuid() }),
        body: updateMemberSchema,
        response: { 200: items(memberSchema) },
      },
    },
    async (req) => ({
      items: await s.projects.updateMember(req.params.key, req.params.userId, req.body, req.auth),
    }),
  );

  app.delete(
    '/projects/:key/members/:userId',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary:
          'Remove a member (managers) or leave the project (yourself); their open tasks are unassigned',
        params: keyParams.extend({ userId: z.uuid() }),
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.projects.removeMember(req.params.key, req.params.userId, req.auth);
      return reply.status(204).send();
    },
  );

  /* ───────────── milestones ───────────── */

  app.get(
    '/projects/:key/milestones',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Milestones in order, with task progress',
        params: keyParams,
        response: { 200: items(milestoneSchema) },
      },
    },
    async (req) => ({ items: await s.projects.milestones(req.params.key, req.auth) }),
  );

  app.post(
    '/projects/:key/milestones',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Add a milestone (managers)',
        params: keyParams,
        body: createMilestoneSchema,
        response: { 201: items(milestoneSchema) },
      },
    },
    async (req, reply) =>
      reply.status(201).send({ items: await s.projects.createMilestone(req.params.key, req.body, req.auth) }),
  );

  app.post(
    '/projects/:key/milestones/reorder',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Reorder milestones (managers): ids in their new order',
        params: keyParams,
        body: reorderMilestonesSchema,
        response: { 200: items(milestoneSchema) },
      },
    },
    async (req) => ({ items: await s.projects.reorderMilestones(req.params.key, req.body.ids, req.auth) }),
  );

  app.patch(
    '/projects/:key/milestones/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Edit or complete a milestone (managers)',
        params: keyParams.extend({ id: z.uuid() }),
        body: updateMilestoneSchema,
        response: { 200: items(milestoneSchema) },
      },
    },
    async (req) => ({
      items: await s.projects.updateMilestone(req.params.key, req.params.id, req.body, req.auth),
    }),
  );

  app.delete(
    '/projects/:key/milestones/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Delete a milestone (managers); its tasks keep going without one',
        params: keyParams.extend({ id: z.uuid() }),
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.projects.deleteMilestone(req.params.key, req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  /* ───────────── board, timeline, workload ───────────── */

  app.get(
    '/projects/:key/board',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Kanban board: tasks per status column in rank order, with filters',
        params: keyParams,
        querystring: boardQuerySchema,
        response: { 200: boardSchema },
      },
    },
    async (req) => s.tasks.board(req.params.key, req.query, req.auth),
  );

  app.get(
    '/projects/:key/timeline',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Gantt data: dated tasks, unscheduled tasks, dependencies and milestones',
        params: keyParams,
        querystring: timelineQuerySchema,
        response: { 200: timelineSchema },
      },
    },
    async (req) => s.tasks.timeline(req.params.key, req.query, req.auth),
  );

  app.get(
    '/projects/:key/workload',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: "Members' planned hours per ISO week against their allocation to this project",
        params: keyParams,
        querystring: workloadQuerySchema,
        response: { 200: workloadSchema },
      },
    },
    async (req) => s.workload.forProject(req.params.key, req.query, req.auth),
  );

  app.get(
    '/workload',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Workload across the projects you manage (every live project for admins and the PMO)',
        querystring: workloadQuerySchema,
        response: { 200: workloadSchema },
      },
    },
    async (req) => s.workload.forPortfolio(req.query, req.auth),
  );

  /* ───────────── tasks ───────────── */

  app.get(
    '/tasks',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Tasks you can see (filters: project, assignee=me, status, due=overdue|week, q)',
        querystring: taskQuerySchema,
        response: { 200: pageSchema(taskListItemSchema) },
      },
    },
    async (req) => s.tasks.list(req.query, req.auth),
  );

  app.post(
    '/projects/:key/tasks',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Create a task (members and managers)',
        params: keyParams,
        body: createTaskSchema,
        response: { 201: taskDetailSchema },
      },
    },
    async (req, reply) => {
      const { task } = await s.tasks.create(req.params.key, req.body, req.auth);
      return reply.status(201).send(await s.tasks.detail(task.id, req.auth));
    },
  );

  app.get(
    '/tasks/:ref',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'A task by reference (NET-12) or id: hierarchy, dependencies and what you may do',
        params: taskParams,
        response: { 200: taskDetailSchema },
      },
    },
    async (req) => s.tasks.detail(req.params.ref, req.auth),
  );

  app.patch(
    '/tasks/:ref',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Edit a task; it cannot start (in_progress) while a dependency is not done',
        params: taskParams,
        body: updateTaskSchema,
        response: { 200: taskDetailSchema },
      },
    },
    async (req) => {
      const task = await s.tasks.update(req.params.ref, req.body, req.auth);
      return s.tasks.detail(task.id, req.auth);
    },
  );

  app.delete(
    '/tasks/:ref',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Delete a task (managers)',
        params: taskParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.tasks.remove(req.params.ref, req.auth);
      return reply.status(204).send();
    },
  );

  app.post(
    '/tasks/:ref/move',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Board move: new column and neighbours (before/after); the rank is computed server-side',
        params: taskParams,
        body: moveTaskSchema,
        response: {
          200: z.object({ id: z.uuid(), reference: z.string(), status: taskStatusSchema, rank: z.string() }),
        },
      },
    },
    async (req) => {
      const task = await s.tasks.move(req.params.ref, req.body, req.auth);
      const { task: row, project } = await s.tasks.findRow(task.id);
      return { id: row.id, reference: `${project.key}-${row.number}`, status: row.status, rank: row.rank };
    },
  );

  app.post(
    '/tasks/:ref/dependencies',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Add a finish-to-start dependency (same project; loops are refused)',
        params: taskParams,
        body: addDependencySchema,
        response: { 201: taskDetailSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await s.tasks.addDependency(req.params.ref, req.body.dependsOn, req.auth)),
  );

  app.delete(
    '/tasks/:ref/dependencies/:dependsOn',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Remove a dependency',
        params: taskParams.extend({ dependsOn: taskRefParam }),
        response: { 200: taskDetailSchema },
      },
    },
    async (req) => s.tasks.removeDependency(req.params.ref, req.params.dependsOn, req.auth),
  );

  app.get(
    '/tasks/:ref/comments',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Comments, oldest first',
        params: taskParams,
        response: { 200: items(commentSchema) },
      },
    },
    async (req) => ({ items: await s.tasks.comments(req.params.ref, req.auth) }),
  );

  app.post(
    '/tasks/:ref/comments',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Comment on a task (members, managers and viewers)',
        params: taskParams,
        body: commentInputSchema,
        response: { 201: commentSchema },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await s.tasks.addComment(req.params.ref, req.body.body, req.auth)),
  );

  app.patch(
    '/comments/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Edit your comment',
        params: z.object({ id: z.uuid() }),
        body: commentInputSchema,
        response: { 200: commentSchema },
      },
    },
    async (req) => s.tasks.editComment(req.params.id, req.body.body, req.auth),
  );

  app.delete(
    '/comments/:id',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Delete your comment (managers may delete any)',
        params: z.object({ id: z.uuid() }),
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      await s.tasks.deleteComment(req.params.id, req.auth);
      return reply.status(204).send();
    },
  );

  app.get(
    '/tasks/:ref/activity',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: "A task's timeline: creation, status, assignee and field changes, comments, dependencies",
        params: taskParams,
        response: { 200: items(activitySchema) },
      },
    },
    async (req) => ({ items: await s.tasks.activity(req.params.ref, req.auth) }),
  );

  /* ───────────── me ───────────── */

  app.get(
    '/me/tasks',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Your open tasks across projects, grouped: overdue, today, this week, later, no date',
        querystring: z.object({ project: z.string().max(10).optional() }),
        response: { 200: myTasksSchema },
      },
    },
    async (req) => s.tasks.myTasks(req.auth, { project: req.query.project }),
  );

  /* ───────────── lookups ───────────── */

  app.get(
    '/lookups/departments',
    {
      config: { permission: USE },
      schema: {
        tags,
        summary: 'Departments to pick a project department from (id, name, code)',
        querystring: lookupQuerySchema,
        response: { 200: items(z.object({ id: z.uuid(), name: z.string(), hint: z.string() })) },
      },
    },
    async (req) => {
      const rows = await ctx.db
        .select({ id: departments.id, name: departments.name, hint: departments.code })
        .from(departments)
        .where(
          req.query.q
            ? or(
                ilike(departments.name, likePattern(req.query.q)),
                ilike(departments.code, likePattern(req.query.q)),
              )
            : undefined,
        )
        .orderBy(asc(departments.name))
        .limit(200);
      return { items: rows };
    },
  );

  /* ───────────── status reporting (Phase 11) ───────────── */

  statusRoutes(app, ctx);
}
