import type { AuthContext, FactDef, RecordTypeDef } from '@isbp/sdk/server';
import { getKernel } from '../kernel-ref';
import { recordTypeFacts } from '../routes/records';
import { catalogText } from './shared';

/*
 * Record types and their approval facts as kinds' guides describe them to models (R49): live, in English. Facts
 * describe what a record type exposes (names, types, values); never fact values of any record (R50).
 */

export interface RecordTypeEntryRef {
  type: string;
  def: RecordTypeDef;
}

/** Record types a person may offer in a record field (enabled modules, read permission on the type). */
export function pickableRecordTypes(auth: AuthContext): RecordTypeEntryRef[] {
  return getKernel()
    .records.types(auth)
    .map((t) => ({ type: t.type, def: t.def }));
}

/** Every record type of the enabled modules (a workflow routes on any record a form can pick). */
export function enabledRecordTypes(): RecordTypeEntryRef[] {
  return getKernel()
    .registry.enabledModules()
    .flatMap((m) =>
      (m.manifest.records?.types ?? []).map((def) => ({ type: `${m.manifest.id}.${def.type}`, def })),
    );
}

const humanise = (path: string) => {
  const words = (path.split('.').pop() ?? path).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
};

async function factReference(f: FactDef) {
  return {
    fact: f.path,
    type: f.type,
    label: f.label ? await catalogText(f.label) : humanise(f.path),
    ...(f.options ? { values: f.options } : {}),
    ...(f.ref === 'group'
      ? { holds: 'group key (approver rule { "type": "fact", "kind": "group" })' }
      : f.ref === 'user'
        ? { holds: 'user id (approver rule { "type": "fact" })' }
        : {}),
  };
}

/** `[{ type, name, facts: [{ fact, type, label, values?, holds? }] }]` in English. */
export async function recordTypeReference(types: readonly RecordTypeEntryRef[]) {
  return Promise.all(
    types.map(async (t) => ({
      type: t.type,
      name: await catalogText(t.def.name),
      facts: await Promise.all(recordTypeFacts(t.def).map(factReference)),
    })),
  );
}

/** The approval facts of a record type that hold group keys (for "the record's group approves"). */
export function groupFactsOf(def: RecordTypeDef): FactDef[] {
  return recordTypeFacts(def).filter((f) => f.ref === 'group');
}
