import type {
  ConflictPolicy,
  Direction,
  FieldMapping,
  FilterCondition,
  Profile,
  ProfileDraftInput,
} from '../../contracts';

/** The profile editor's state (numbers as typed text). */
export interface Draft {
  name: string;
  nameTouched: boolean;
  objectType: string;
  remoteScope: string | null;
  entity: string;
  containerId: string | null;
  containerLabel: string | null;
  direction: Direction;
  createLocal: boolean;
  createRemote: boolean;
  matchRule: { local: string; remote: string } | null;
  pushFilter: FilterCondition[];
  mappings: FieldMapping[];
  conflictPolicy: ConflictPolicy;
  comments: boolean;
  interval: string;
  enabled: boolean;
}

export const emptyDraft = (): Draft => ({
  name: '',
  nameTouched: false,
  objectType: '',
  remoteScope: null,
  entity: '',
  containerId: null,
  containerLabel: null,
  direction: 'pull',
  createLocal: true,
  createRemote: false,
  matchRule: null,
  pushFilter: [],
  mappings: [],
  conflictPolicy: 'manual',
  comments: false,
  interval: '15',
  enabled: true,
});

export const draftOf = (p: Profile): Draft => ({
  name: p.name,
  nameTouched: true,
  objectType: p.objectType,
  remoteScope: p.remoteScope,
  entity: p.entity,
  containerId: p.containerId,
  containerLabel: p.containerLabel,
  direction: p.direction,
  createLocal: p.createLocal,
  createRemote: p.createRemote,
  matchRule: p.matchRule,
  pushFilter: p.pushFilter as FilterCondition[],
  mappings: p.mappings as FieldMapping[],
  conflictPolicy: p.conflictPolicy,
  comments: p.comments,
  interval: String(p.intervalMinutes),
  enabled: p.enabled,
});

export function intervalOf(d: Draft): number | null {
  const n = Number(d.interval);
  return Number.isInteger(n) && n >= 0 && n <= 1_440 ? n : null;
}

/** The body for create, preview and (minus the fixed fields) update. */
export function bodyOf(d: Draft, connectionId: string): ProfileDraftInput {
  return {
    connectionId,
    name: d.name.trim(),
    objectType: d.objectType,
    remoteScope: d.remoteScope,
    entity: d.entity,
    containerId: d.containerId,
    direction: d.direction,
    createLocal: d.createLocal,
    createRemote: d.createRemote,
    matchRule: d.matchRule,
    pushFilter: d.pushFilter,
    mappings: d.mappings,
    conflictPolicy: d.conflictPolicy,
    comments: d.comments,
    intervalMinutes: intervalOf(d) ?? 15,
    enabled: d.enabled,
  };
}

/** What can change after creation. */
export function patchOf(d: Draft) {
  const {
    connectionId: _c,
    objectType: _o,
    remoteScope: _r,
    entity: _e,
    containerId: _ct,
    ...rest
  } = bodyOf(d, '');
  return rest;
}
