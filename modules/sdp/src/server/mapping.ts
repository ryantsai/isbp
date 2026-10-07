/**
 * Default field mappings the connector suggests for each ServiceDesk Plus object and sync entity. Local keys
 * are the sync adapters' (docs/architecture.md §12.8), remote keys the catalogue in `objects.ts`. Value maps
 * translate a fresh ServiceDesk Plus installation's picklist names to ISBP's values. Where several remote values
 * share a local one, the extra rows are `pull` (into ISBP only): each local value goes out through exactly one
 * row, and a `push` row can send a local value out as a remote value that comes in as something else.
 *
 * Fields whose local choices are records of the installation (ticket categories, groups, vendors, Knowledge
 * Base categories: their choice values are ids) are left out: a static value map can't name them. Admins add
 * them in the profile editor, which shows both catalogues' choices.
 *
 * Admins edit all of this per sync profile; the hub validates it against both live catalogues.
 */
import type { FieldMappingSuggestion } from '@isbp/sdk/server';

type Way = 'pull' | 'push';
type Pairs = readonly (readonly [remote: string, local: string, direction?: Way])[];

const v = (pairs: Pairs) =>
  pairs.map(([remote, local, direction]) => (direction ? { remote, local, direction } : { remote, local }));

/** ISBP levels are 1 (high) … 3 (low); priorities P1 … P4. ServiceDesk Plus' default names. */
const IMPACT = v([
  ['Affects Business', '1'],
  ['Affects Department', '2'],
  ['Affects Group', '2', 'pull'],
  ['Affects User', '3'],
]);
const URGENCY = v([
  ['High', '1'],
  ['Urgent', '1', 'pull'],
  ['Normal', '2'],
  ['Low', '3'],
]);
const PRIORITY = v([
  ['High', '1'],
  ['Medium', '2'],
  ['Normal', '3'],
  ['Low', '4'],
]);

const REQUEST_STATUS = v([
  ['Open', 'new'],
  ['In Progress', 'in_progress'],
  ['Assigned', 'in_progress', 'pull'],
  ['On Hold', 'on_hold'],
  // ServiceDesk Plus resolves both kinds; ISBP turns a sync's `resolved` on a service request into `fulfilled`,
  // and a fulfilled service request goes out as Resolved.
  ['Resolved', 'resolved'],
  ['Resolved', 'fulfilled', 'push'],
  ['Closed', 'closed'],
  ['Canceled', 'cancelled'],
]);
const PROBLEM_STATUS = v([
  ['Open', 'new'],
  ['In Progress', 'investigating'],
  ['On Hold', 'investigating', 'pull'],
  ['Resolved', 'resolved'],
  ['Closed', 'closed'],
]);

const ticketCommon = (requesterKey: string): FieldMappingSuggestion[] => [
  { local: 'impact', remote: 'impact', direction: 'both', values: IMPACT },
  { local: 'urgency', remote: 'urgency', direction: 'both', values: URGENCY },
  { local: 'priority', remote: 'priority', direction: 'both', values: PRIORITY },
  { local: 'assignee', remote: 'technician', direction: 'both' },
  { local: 'requester', remote: requesterKey, direction: 'both' },
  { local: 'resolutionNotes', remote: 'resolution', direction: 'both' },
];

const MAPPINGS: Record<string, FieldMappingSuggestion[]> = {
  'request→itsm.ticket': [
    { local: 'title', remote: 'subject', direction: 'both' },
    { local: 'description', remote: 'description', direction: 'both' },
    {
      local: 'type',
      remote: 'request_type',
      direction: 'both',
      values: v([
        ['Incident', 'incident'],
        ['Service Request', 'service_request'],
      ]),
    },
    { local: 'status', remote: 'status', direction: 'both', values: REQUEST_STATUS },
    ...ticketCommon('requester'),
  ],
  'problem→itsm.ticket': [
    // A problem always becomes a ticket of type problem (the connector reports the type as a constant).
    { local: 'type', remote: 'record_type', direction: 'pull', values: v([['Problem', 'problem']]) },
    { local: 'title', remote: 'title', direction: 'both' },
    { local: 'description', remote: 'description', direction: 'both' },
    { local: 'status', remote: 'status', direction: 'both', values: PROBLEM_STATUS },
    ...ticketCommon('reported_by'),
  ],
  // No status mapping: ServiceDesk Plus ties change statuses to its own stages and approvals, and ISBP
  // refuses sync writes past CAB authorization (the approval happens in ISBP). See the README.
  'change→itsm.change': [
    { local: 'title', remote: 'title', direction: 'both' },
    { local: 'description', remote: 'description', direction: 'both' },
    {
      local: 'changeType',
      remote: 'change_type',
      direction: 'both',
      values: v([
        ['Standard', 'standard'],
        ['Minor', 'normal'],
        ['Major', 'normal', 'pull'],
        ['Significant', 'normal', 'pull'],
        ['Emergency', 'emergency'],
      ]),
    },
    {
      local: 'risk',
      remote: 'risk',
      direction: 'both',
      values: v([
        ['Low', 'low'],
        ['Medium', 'medium'],
        ['High', 'high'],
        ['Very High', 'high', 'pull'],
      ]),
    },
    { local: 'plannedStart', remote: 'scheduled_start_time', direction: 'both' },
    { local: 'plannedEnd', remote: 'scheduled_end_time', direction: 'both' },
    { local: 'implementationPlan', remote: 'roll_out_plan', direction: 'both' },
    { local: 'backoutPlan', remote: 'back_out_plan', direction: 'both' },
    { local: 'assignee', remote: 'change_owner', direction: 'both' },
  ],
  'asset→itam.asset': [
    { local: 'name', remote: 'name', direction: 'both' },
    {
      // Create-only in ServiceDesk Plus (it follows the product), so later changes only flow to ISBP.
      local: 'category',
      remote: 'product_type',
      direction: 'both',
      values: v([
        ['Laptop', 'laptop'],
        ['Workstation', 'desktop'],
        ['Monitor', 'monitor'],
        ['Server', 'server'],
        ['Switch', 'network'],
        ['Router', 'network', 'pull'],
        ['Firewall', 'network', 'pull'],
        ['Access Point', 'network', 'pull'],
        ['Storage', 'storage'],
        ['Printer', 'printer'],
        ['Smart Phone', 'phone'],
        ['Tablet', 'tablet'],
      ]),
    },
    { local: 'serialNumber', remote: 'serial_number', direction: 'both' },
    {
      // "Disposed" is refused by ISBP unless the disposal approval ran there first (409 INVALID_TRANSITION).
      local: 'status',
      remote: 'state',
      direction: 'both',
      values: v([
        ['In Use', 'deployed'],
        ['In Store', 'in_stock'],
        ['In Repair', 'in_repair'],
        ['Expired', 'retired'],
        ['Disposed', 'disposed'],
      ]),
    },
    { local: 'assignedTo', remote: 'user', direction: 'both' },
    { local: 'location', remote: 'location', direction: 'pull' },
    { local: 'purchaseDate', remote: 'acquisition_date', direction: 'both' },
    { local: 'purchaseCost', remote: 'purchase_cost', direction: 'both' },
    { local: 'warrantyEnd', remote: 'warranty_expiry', direction: 'both' },
  ],
  'solution→knowledge.article': [
    { local: 'title', remote: 'title', direction: 'both' },
    { local: 'body', remote: 'description', direction: 'both' },
    { local: 'tags', remote: 'keywords', direction: 'both' },
    {
      local: 'status',
      remote: 'approval_status',
      direction: 'both',
      values: v([
        ['Approved', 'published'],
        ['UnApproved', 'draft'],
        ['Rejected', 'draft', 'pull'],
        ['Approval Pending', 'in_review'],
        ['Expired', 'retired'],
      ]),
    },
    {
      // ServiceDesk Plus only lets approved solutions be public, so visibility flows to ISBP only.
      local: 'audience',
      remote: 'visibility',
      direction: 'pull',
      values: v([
        ['Public', 'everyone'],
        ['Technicians only', 'agents'],
      ]),
    },
  ],
};

/** The suggested mapping between a ServiceDesk Plus object and a sync entity ([] for other pairs). */
export function defaultMapping(objectType: string, entity: string): FieldMappingSuggestion[] {
  return (MAPPINGS[`${objectType}→${entity}`] ?? []).map((m) => ({
    ...m,
    ...(m.values ? { values: m.values.map((x) => ({ ...x })) } : {}),
  }));
}

/** Object → entity pairs with a default mapping. */
export const MAPPED_PAIRS = Object.keys(MAPPINGS).map((k) => {
  const [objectType, entity] = k.split('→') as [string, string];
  return { objectType, entity };
});
