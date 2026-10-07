/**
 * Validation of a sync profile against both field catalogues (the sync entity's and the remote object's).
 * Pure and browser-safe: the API refuses invalid profiles with these issues (400 `VALIDATION_FAILED`,
 * `details.issues`), and the profile editor shows the same ones inline, keyed by `code`.
 */
import { effectiveDirections } from './merge';
import {
  type Direction,
  type FieldType,
  type FilterCondition,
  isCompatible,
  LIMITS,
  type MappingDirection,
} from './model';

export interface CatalogueField {
  key: string;
  type: FieldType;
  choices?: { value: string }[];
  required?: boolean;
  readOnly?: boolean;
  createOnly?: boolean;
}

export interface MappingRow {
  local: string;
  remote: string;
  direction: MappingDirection;
  values?: { remote: string; local: string; direction?: MappingDirection }[];
}

export interface ProfileShape {
  direction: Direction;
  createLocal: boolean;
  createRemote: boolean;
  comments: boolean;
  matchRule: { local: string; remote: string } | null;
  pushFilter: FilterCondition[];
  mappings: MappingRow[];
}

export interface ObjectCapabilities {
  create: boolean;
  update: boolean;
  comments: boolean;
}

export interface EntityTraits {
  comments: boolean;
  matchKeys: string[];
}

/** `code` keys the editor's translations; `params` fill them. `message` is English, for logs and API users. */
export interface MappingIssue {
  path: string;
  code:
    | 'unknown_local'
    | 'unknown_remote'
    | 'duplicate_local'
    | 'duplicate_remote'
    | 'incompatible'
    | 'no_direction'
    | 'unknown_local_choice'
    | 'unknown_remote_choice'
    | 'duplicate_value'
    | 'duplicate_local_value'
    | 'match_unsupported'
    | 'required_unmapped'
    | 'remote_required_unmapped'
    | 'create_local_needs_pull'
    | 'create_remote_needs_push'
    | 'create_unsupported'
    | 'comments_unsupported'
    | 'too_many';
  message: string;
  params?: Record<string, string>;
}

export function validateProfile(
  p: ProfileShape,
  local: readonly CatalogueField[],
  remote: readonly CatalogueField[],
  traits: { object: ObjectCapabilities; entity: EntityTraits },
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const L = new Map(local.map((f) => [f.key, f]));
  const R = new Map(remote.map((f) => [f.key, f]));
  const seenLocal = new Map<string, number>();
  const seenRemote = new Map<string, number>();
  if (p.mappings.length > LIMITS.mappings)
    issues.push({ path: 'mappings', code: 'too_many', message: `At most ${LIMITS.mappings} mappings` });

  const pullable = new Set<string>();
  const pushable = new Set<string>();

  p.mappings.forEach((m, i) => {
    const at = `mappings.${i}`;
    const lf = L.get(m.local);
    const rf = R.get(m.remote);
    if (!lf)
      issues.push({
        path: `${at}.local`,
        code: 'unknown_local',
        message: `Unknown field "${m.local}"`,
        params: { field: m.local },
      });
    if (!rf)
      issues.push({
        path: `${at}.remote`,
        code: 'unknown_remote',
        message: `Unknown remote field "${m.remote}"`,
        params: { field: m.remote },
      });
    if (seenLocal.has(m.local))
      issues.push({
        path: `${at}.local`,
        code: 'duplicate_local',
        message: `"${m.local}" is mapped twice`,
        params: { field: m.local },
      });
    else seenLocal.set(m.local, i);
    if (seenRemote.has(m.remote))
      issues.push({
        path: `${at}.remote`,
        code: 'duplicate_remote',
        message: `"${m.remote}" is mapped twice`,
        params: { field: m.remote },
      });
    else seenRemote.set(m.remote, i);
    if (!lf || !rf) return;
    if (!isCompatible(lf.type, rf.type)) {
      issues.push({
        path: `${at}.remote`,
        code: 'incompatible',
        message: `A ${lf.type} field can't be mapped to a ${rf.type} field`,
        params: { local: lf.type, remote: rf.type },
      });
      return;
    }
    const onCreate = effectiveDirections(p.direction, m.direction, lf, rf, {
      remoteUpdatable: traits.object.update,
      onCreate: true,
    });
    const always = effectiveDirections(p.direction, m.direction, lf, rf, {
      remoteUpdatable: traits.object.update,
    });
    if (onCreate.canPull) pullable.add(lf.key);
    if (onCreate.canPush) pushable.add(rf.key);
    if (!onCreate.canPull && !onCreate.canPush && !always.canPull && !always.canPush)
      issues.push({
        path: `${at}.direction`,
        code: 'no_direction',
        message: 'Nothing can sync this way (read-only fields or the profile’s direction)',
      });
    if (m.values?.length) {
      if (m.values.length > LIMITS.valueMap)
        issues.push({ path: `${at}.values`, code: 'too_many', message: `At most ${LIMITS.valueMap} values` });
      const localChoices =
        lf.type === 'choice' && lf.choices ? new Set(lf.choices.map((c) => c.value)) : null;
      const remoteChoices =
        rf.type === 'choice' && rf.choices?.length ? new Set(rf.choices.map((c) => c.value)) : null;
      // Per direction, a value may have one row: a remote value one pull row, a local value one push row.
      const pulls = new Set<string>();
      const pushes = new Set<string>();
      const mayPull = onCreate.canPull || always.canPull;
      const mayPush = onCreate.canPush || always.canPush;
      m.values.forEach((v, j) => {
        const dir = v.direction ?? 'both';
        // A value that can't occur is harmless one way (it never matches) but wrong the other (it would be
        // written): unknown ISBP values matter for rows that pull, unknown remote values for rows that push.
        if (localChoices && mayPull && dir !== 'push' && !localChoices.has(v.local))
          issues.push({
            path: `${at}.values.${j}.local`,
            code: 'unknown_local_choice',
            message: `"${v.local}" is not a choice of ${lf.key}`,
            params: { value: v.local },
          });
        if (remoteChoices && mayPush && dir !== 'pull' && !remoteChoices.has(v.remote))
          issues.push({
            path: `${at}.values.${j}.remote`,
            code: 'unknown_remote_choice',
            message: `"${v.remote}" is not a choice of ${rf.key}`,
            params: { value: v.remote },
          });
        if (mayPull && dir !== 'push') {
          const k = v.remote.toLowerCase();
          if (pulls.has(k))
            issues.push({
              path: `${at}.values.${j}.remote`,
              code: 'duplicate_value',
              message: `"${v.remote}" comes into ISBP through two rows; make one of them "out of ISBP only"`,
              params: { value: v.remote },
            });
          pulls.add(k);
        }
        if (mayPush && dir !== 'pull') {
          const k = v.local.toLowerCase();
          if (pushes.has(k))
            issues.push({
              path: `${at}.values.${j}.local`,
              code: 'duplicate_local_value',
              message: `"${v.local}" goes out through two rows; make one of them "into ISBP only"`,
              params: { value: v.local },
            });
          pushes.add(k);
        }
      });
    }
  });

  if (p.matchRule) {
    if (!traits.entity.matchKeys.includes(p.matchRule.local))
      issues.push({
        path: 'matchRule.local',
        code: 'match_unsupported',
        message: `Records can't be matched on "${p.matchRule.local}"`,
        params: { field: p.matchRule.local },
      });
    if (!R.has(p.matchRule.remote))
      issues.push({
        path: 'matchRule.remote',
        code: 'unknown_remote',
        message: `Unknown remote field "${p.matchRule.remote}"`,
        params: { field: p.matchRule.remote },
      });
  }

  p.pushFilter.forEach((c, i) => {
    if (!L.has(c.field))
      issues.push({
        path: `pushFilter.${i}.field`,
        code: 'unknown_local',
        message: `Unknown field "${c.field}"`,
        params: { field: c.field },
      });
  });

  if (p.createLocal) {
    if (p.direction === 'push')
      issues.push({
        path: 'createLocal',
        code: 'create_local_needs_pull',
        message: 'Creating records in ISBP needs a pull or two-way profile',
      });
    else
      for (const f of local)
        if (f.required && !f.readOnly && !pullable.has(f.key))
          issues.push({
            path: 'createLocal',
            code: 'required_unmapped',
            message: `Map "${f.key}" (required to create records)`,
            params: { field: f.key },
          });
  }
  if (p.createRemote) {
    if (p.direction === 'pull')
      issues.push({
        path: 'createRemote',
        code: 'create_remote_needs_push',
        message: 'Creating remote records needs a push or two-way profile',
      });
    else if (!traits.object.create)
      issues.push({
        path: 'createRemote',
        code: 'create_unsupported',
        message: 'The remote system can’t create these records',
      });
    else
      for (const f of remote)
        if (f.required && !f.readOnly && !pushable.has(f.key))
          issues.push({
            path: 'createRemote',
            code: 'remote_required_unmapped',
            message: `Map the remote field "${f.key}" (required to create records)`,
            params: { field: f.key },
          });
  }
  if (p.comments && (!traits.entity.comments || !traits.object.comments))
    issues.push({
      path: 'comments',
      code: 'comments_unsupported',
      message: 'Comments don’t sync for this pair',
    });
  return issues;
}

/**
 * Fits a connector's suggested value map to the live catalogues: rows naming a choice either side doesn't have
 * are dropped (a suggestion may cover several process templates), and a local value whose push row was dropped
 * gets its first remaining row promoted to both ways, so it still has a way out.
 */
export function fitValueMap<T extends { remote: string; local: string; direction?: MappingDirection }>(
  rows: readonly T[],
  local: CatalogueField,
  remote: CatalogueField,
): T[] {
  const L = local.type === 'choice' && local.choices ? new Set(local.choices.map((c) => c.value)) : null;
  const R =
    remote.type === 'choice' && remote.choices?.length ? new Set(remote.choices.map((c) => c.value)) : null;
  const kept = rows.filter((r) => (!L || L.has(r.local)) && (!R || R.has(r.remote)));
  const pushed = new Set(kept.filter((r) => r.direction !== 'pull').map((r) => r.local.toLowerCase()));
  return kept.map((r) => {
    const k = r.local.toLowerCase();
    if (r.direction !== 'pull' || pushed.has(k)) return r;
    pushed.add(k);
    const { direction: _pull, ...both } = r;
    return both as T;
  });
}
