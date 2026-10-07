import { createHash } from 'node:crypto';

/* ───────────────────────────── state ───────────────────────────── */

export interface AdoIdentity {
  id: string;
  displayName: string;
  /** `CONTOSO\jdoe` (Active Directory) or an email. */
  uniqueName: string;
  mail: string | null;
}

export type ProcessName = 'Agile' | 'Scrum' | 'Basic';

export interface AdoProjectState {
  id: string;
  name: string;
  description: string;
  process: ProcessName;
  visibility: 'private' | 'public';
  revision: number;
  lastUpdateTime: string;
  areas: string[];
  iterations: string[];
}

/** A link: to another work item (`target`, its URL is built when read) or to anything else (`url`). */
export interface AdoRelation {
  rel: string;
  target?: number;
  url?: string;
  attributes: Record<string, unknown>;
}

/** An identity in a stored field value; read as a full identity reference. */
export interface IdentityValue {
  $identity: string;
}

export const isIdentityValue = (v: unknown): v is IdentityValue =>
  typeof v === 'object' && v !== null && typeof (v as IdentityValue).$identity === 'string';

export interface WorkItemRevision {
  rev: number;
  fields: Record<string, unknown>;
  relations: AdoRelation[];
}

export interface AdoComment {
  id: number;
  text: string;
  /** Markdown only when added with `format=markdown` (7.1). */
  format?: 'html' | 'markdown';
  /** The work item revision the comment was added in (the 2019 discussion API lists by revision). */
  rev?: number;
  createdBy: string;
  createdDate: string;
  modifiedDate: string;
  isDeleted: boolean;
}

export interface WorkItemState {
  id: number;
  projectId: string;
  /** In the recycle bin. */
  deleted: boolean;
  revisions: WorkItemRevision[];
  comments: AdoComment[];
}

export interface GitPerson {
  name: string;
  email: string;
  date: string;
}

export interface AdoCommitState {
  sha: string;
  parents: string[];
  message: string;
  author: GitPerson;
  committer: GitPerson;
}

export interface AdoRepoState {
  id: string;
  name: string;
  projectId: string;
  defaultBranch: string;
  isDisabled: boolean;
  /** `refs/heads/main` → commit sha. */
  refs: Record<string, string>;
  commits: Record<string, AdoCommitState>;
  pushes: number;
}

export interface AdoPullRequestState {
  id: number;
  repoId: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'abandoned';
  isDraft: boolean;
  createdBy: string;
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
}

export interface AdoState {
  collection: { id: string; name: string };
  serverId: string;
  /** Identity the demo personal access token belongs to. */
  patIdentity: string;
  identities: AdoIdentity[];
  projects: AdoProjectState[];
  workItems: Record<string, WorkItemState>;
  nextWorkItemId: number;
  repos: AdoRepoState[];
  pullRequests: AdoPullRequestState[];
  nextPullRequestId: number;
  /** Throttling toggle (`POST /_mock/ado/rate-limit`): requests left to refuse (-1: until turned off). */
  rateLimit: { remaining: number; retryAfter: number } | null;
  notifications: number;
}

/* ───────────────────────────── ids ───────────────────────────── */

/** A stable GUID derived from a name, so seeded ids are the same on every machine. */
export function guidFrom(name: string): string {
  const h = createHash('sha1').update(`isbp-ado-mock:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const shaFrom = (name: string) =>
  createHash('sha1').update(`isbp-ado-mock-commit:${name}`).digest('hex');

/* ───────────────────────────── processes ───────────────────────────── */

/** Fields every work item type has. */
export const COMMON_FIELDS = [
  'System.Id',
  'System.Rev',
  'System.AreaPath',
  'System.TeamProject',
  'System.IterationPath',
  'System.WorkItemType',
  'System.State',
  'System.Reason',
  'System.AssignedTo',
  'System.CreatedDate',
  'System.CreatedBy',
  'System.ChangedDate',
  'System.ChangedBy',
  'System.CommentCount',
  'System.Title',
  'System.Description',
  'System.Tags',
  'System.History',
  'System.Parent',
  'Microsoft.VSTS.Common.StateChangeDate',
];

const P = 'Microsoft.VSTS.Common.Priority';
const S = 'Microsoft.VSTS.Scheduling.';

export interface TypeDef {
  name: string;
  referenceName: string;
  color: string;
  icon: string;
  /** States in workflow order with their category. */
  states: [string, 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed'][];
  fields: string[];
}

const type = (
  _process: ProcessName,
  name: string,
  color: string,
  icon: string,
  states: TypeDef['states'],
  fields: string[],
): TypeDef => ({
  name,
  referenceName: `Microsoft.VSTS.WorkItemTypes.${name.replace(/ /g, '')}`,
  color,
  icon,
  states,
  fields: [...COMMON_FIELDS, ...fields],
});

const AGILE_STATES: TypeDef['states'] = [
  ['New', 'Proposed'],
  ['Active', 'InProgress'],
  ['Resolved', 'InProgress'],
  ['Closed', 'Completed'],
  ['Removed', 'Removed'],
];

/**
 * Work item types of the three processes the demo projects use, with the fields each type has (a subset of
 * the real ones, enough for the connector). Agile Epics and Features carry a custom field, as an inherited
 * process would.
 */
export const PROCESS_TYPES: Record<ProcessName, TypeDef[]> = {
  Agile: [
    type('Agile', 'Epic', 'E06C00', 'icon_crown', AGILE_STATES, [
      P,
      `${S}StartDate`,
      `${S}TargetDate`,
      `${S}Effort`,
      'Custom.CostCenter',
    ]),
    type('Agile', 'Feature', '773B93', 'icon_trophy', AGILE_STATES, [
      P,
      `${S}StartDate`,
      `${S}TargetDate`,
      `${S}Effort`,
      'Custom.CostCenter',
    ]),
    type('Agile', 'User Story', '009CCC', 'icon_book', AGILE_STATES, [
      P,
      `${S}StoryPoints`,
      'Microsoft.VSTS.Common.AcceptanceCriteria',
    ]),
    type(
      'Agile',
      'Task',
      'F2CB1D',
      'icon_clipboard',
      [
        ['New', 'Proposed'],
        ['Active', 'InProgress'],
        ['Closed', 'Completed'],
        ['Removed', 'Removed'],
      ],
      [P, 'Microsoft.VSTS.Common.Activity', `${S}OriginalEstimate`, `${S}RemainingWork`, `${S}CompletedWork`],
    ),
    type(
      'Agile',
      'Bug',
      'CC293D',
      'icon_insect',
      [
        ['New', 'Proposed'],
        ['Active', 'InProgress'],
        ['Resolved', 'Resolved'],
        ['Closed', 'Completed'],
      ],
      [
        P,
        'Microsoft.VSTS.TCM.ReproSteps',
        `${S}StoryPoints`,
        `${S}OriginalEstimate`,
        `${S}RemainingWork`,
        `${S}CompletedWork`,
      ],
    ),
    type(
      'Agile',
      'Issue',
      'B4009E',
      'icon_traffic_cone',
      [
        ['Active', 'InProgress'],
        ['Closed', 'Completed'],
      ],
      [P, `${S}DueDate`],
    ),
    type(
      'Agile',
      'Test Case',
      '004B50',
      'icon_test_case',
      [
        ['Design', 'Proposed'],
        ['Ready', 'InProgress'],
        ['Closed', 'Completed'],
      ],
      [P],
    ),
  ],
  Scrum: [
    type(
      'Scrum',
      'Epic',
      'FF7B00',
      'icon_crown',
      [
        ['New', 'Proposed'],
        ['In Progress', 'InProgress'],
        ['Done', 'Completed'],
        ['Removed', 'Removed'],
      ],
      [P, `${S}StartDate`, `${S}TargetDate`, `${S}Effort`],
    ),
    type(
      'Scrum',
      'Feature',
      '773B93',
      'icon_trophy',
      [
        ['New', 'Proposed'],
        ['In Progress', 'InProgress'],
        ['Done', 'Completed'],
        ['Removed', 'Removed'],
      ],
      [P, `${S}StartDate`, `${S}TargetDate`, `${S}Effort`],
    ),
    type(
      'Scrum',
      'Product Backlog Item',
      '009CCC',
      'icon_list',
      [
        ['New', 'Proposed'],
        ['Approved', 'Proposed'],
        ['Committed', 'InProgress'],
        ['Done', 'Completed'],
        ['Removed', 'Removed'],
      ],
      [P, `${S}Effort`, 'Microsoft.VSTS.Common.AcceptanceCriteria'],
    ),
    type(
      'Scrum',
      'Task',
      'F2CB1D',
      'icon_clipboard',
      [
        ['To Do', 'Proposed'],
        ['In Progress', 'InProgress'],
        ['Done', 'Completed'],
        ['Removed', 'Removed'],
      ],
      ['Microsoft.VSTS.Common.Activity', `${S}RemainingWork`],
    ),
    type(
      'Scrum',
      'Bug',
      'CC293D',
      'icon_insect',
      [
        ['New', 'Proposed'],
        ['Approved', 'Proposed'],
        ['Committed', 'InProgress'],
        ['Done', 'Completed'],
        ['Removed', 'Removed'],
      ],
      [P, `${S}Effort`, 'Microsoft.VSTS.TCM.ReproSteps', 'Microsoft.VSTS.Common.AcceptanceCriteria'],
    ),
    type(
      'Scrum',
      'Impediment',
      'B4009E',
      'icon_traffic_cone',
      [
        ['Open', 'InProgress'],
        ['Closed', 'Completed'],
      ],
      [P],
    ),
  ],
  Basic: [
    type(
      'Basic',
      'Epic',
      'FF7B00',
      'icon_crown',
      [
        ['To Do', 'Proposed'],
        ['Doing', 'InProgress'],
        ['Done', 'Completed'],
      ],
      [P, `${S}StartDate`, `${S}TargetDate`, `${S}Effort`],
    ),
    type(
      'Basic',
      'Issue',
      '339947',
      'icon_clipboard_issue',
      [
        ['To Do', 'Proposed'],
        ['Doing', 'InProgress'],
        ['Done', 'Completed'],
      ],
      [P, `${S}Effort`],
    ),
    type(
      'Basic',
      'Task',
      'F2CB1D',
      'icon_clipboard',
      [
        ['To Do', 'Proposed'],
        ['Doing', 'InProgress'],
        ['Done', 'Completed'],
      ],
      [P, 'Microsoft.VSTS.Common.Activity', `${S}RemainingWork`],
    ),
  ],
};

export function typeOf(process: ProcessName, name: string): TypeDef | undefined {
  const lower = name.toLowerCase();
  return PROCESS_TYPES[process].find((t) => t.name.toLowerCase() === lower);
}

export type FieldKind =
  'string' | 'integer' | 'double' | 'dateTime' | 'html' | 'plainText' | 'identity' | 'treePath' | 'boolean';

export interface FieldDef {
  name: string;
  type: FieldKind;
  readOnly?: boolean;
}

/** The collection's field definitions (`_apis/wit/fields`). */
export const FIELD_DEFS: Record<string, FieldDef> = {
  'System.Id': { name: 'ID', type: 'integer', readOnly: true },
  'System.Rev': { name: 'Rev', type: 'integer', readOnly: true },
  'System.AreaPath': { name: 'Area Path', type: 'treePath' },
  'System.TeamProject': { name: 'Team Project', type: 'string', readOnly: true },
  'System.IterationPath': { name: 'Iteration Path', type: 'treePath' },
  'System.WorkItemType': { name: 'Work Item Type', type: 'string' },
  'System.State': { name: 'State', type: 'string' },
  'System.Reason': { name: 'Reason', type: 'string' },
  'System.AssignedTo': { name: 'Assigned To', type: 'identity' },
  'System.CreatedDate': { name: 'Created Date', type: 'dateTime', readOnly: true },
  'System.CreatedBy': { name: 'Created By', type: 'identity', readOnly: true },
  'System.ChangedDate': { name: 'Changed Date', type: 'dateTime', readOnly: true },
  'System.ChangedBy': { name: 'Changed By', type: 'identity', readOnly: true },
  'System.CommentCount': { name: 'Comment Count', type: 'integer', readOnly: true },
  'System.Title': { name: 'Title', type: 'string' },
  'System.Description': { name: 'Description', type: 'html' },
  'System.Tags': { name: 'Tags', type: 'plainText' },
  'System.History': { name: 'History', type: 'html' },
  'System.Parent': { name: 'Parent', type: 'integer', readOnly: true },
  'Microsoft.VSTS.Common.StateChangeDate': { name: 'State Change Date', type: 'dateTime', readOnly: true },
  'Microsoft.VSTS.Common.Priority': { name: 'Priority', type: 'integer' },
  'Microsoft.VSTS.Common.Activity': { name: 'Activity', type: 'string' },
  'Microsoft.VSTS.Common.AcceptanceCriteria': { name: 'Acceptance Criteria', type: 'html' },
  'Microsoft.VSTS.TCM.ReproSteps': { name: 'Repro Steps', type: 'html' },
  'Microsoft.VSTS.Scheduling.StartDate': { name: 'Start Date', type: 'dateTime' },
  'Microsoft.VSTS.Scheduling.TargetDate': { name: 'Target Date', type: 'dateTime' },
  'Microsoft.VSTS.Scheduling.DueDate': { name: 'Due Date', type: 'dateTime' },
  'Microsoft.VSTS.Scheduling.Effort': { name: 'Effort', type: 'double' },
  'Microsoft.VSTS.Scheduling.StoryPoints': { name: 'Story Points', type: 'double' },
  'Microsoft.VSTS.Scheduling.OriginalEstimate': { name: 'Original Estimate', type: 'double' },
  'Microsoft.VSTS.Scheduling.RemainingWork': { name: 'Remaining Work', type: 'double' },
  'Microsoft.VSTS.Scheduling.CompletedWork': { name: 'Completed Work', type: 'double' },
  'Custom.CostCenter': { name: 'Cost Center', type: 'string' },
};
