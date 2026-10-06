import { describe, expect, it } from 'vitest';
import { createRoleAssignmentSchema, createUserSchema, dateTime, passwordSchema } from '../src/index';

describe('dateTime codec', () => {
  it('decodes ISO strings to Date and encodes back', () => {
    const d = dateTime.decode('2026-10-06T08:00:00.000Z');
    expect(d).toBeInstanceOf(Date);
    expect(dateTime.encode(d)).toBe('2026-10-06T08:00:00.000Z');
  });
});

describe('passwordSchema', () => {
  it('prefers length over composition rules', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('aaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });
});

describe('createUserSchema', () => {
  it('applies simple-by-default values', () => {
    const v = createUserSchema.parse({ email: 'a@example.com', username: 'a.b', displayName: 'A B' });
    expect(v).toMatchObject({ status: 'active', locale: 'en', groupIds: [], jobTitle: null });
  });
  it('rejects unsafe usernames', () => {
    expect(
      createUserSchema.safeParse({ email: 'a@example.com', username: 'a b', displayName: 'A' }).success,
    ).toBe(false);
  });
});

describe('createRoleAssignmentSchema', () => {
  const base = {
    roleId: '01a10fa3-5141-77f6-9b0a-10258b3a22fb',
    principalType: 'user',
    principalId: '01a10fa3-5141-77f6-9b0a-10258b3a22fc',
  } as const;
  it('requires a department for department scope', () => {
    expect(createRoleAssignmentSchema.safeParse({ ...base, scopeType: 'department' }).success).toBe(false);
  });
  it('rejects expiry in the past', () => {
    expect(createRoleAssignmentSchema.safeParse({ ...base, expiresAt: '2020-01-01T00:00:00Z' }).success).toBe(
      false,
    );
  });
  it('accepts a time-bound global assignment', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(createRoleAssignmentSchema.safeParse({ ...base, expiresAt: future }).success).toBe(true);
  });
});
