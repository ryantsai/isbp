/** Shared by API and web: the string form of a record reference, `itsm.ticket:<id>`. */
export function formatRecordRef(ref: { type: string; id: string }): string {
  return `${ref.type}:${ref.id}`;
}

const RECORD_REF = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*):([A-Za-z0-9_-]{1,64})$/;

/** `itsm.ticket:0199…` → `{ type: 'itsm.ticket', id }`; null for anything else. */
export function parseRecordRef(value: string): { type: string; id: string; moduleId: string } | null {
  const m = RECORD_REF.exec(value.trim());
  return m ? { type: `${m[1]}.${m[2]}`, id: m[3]!, moduleId: m[1]! } : null;
}

/** The module that owns a record type (`itsm.ticket` → `itsm`). */
export function recordModule(type: string): string {
  return type.slice(0, type.indexOf('.'));
}
