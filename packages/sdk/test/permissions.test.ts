import { describe, expect, it } from 'vitest';
import {
  isPermissionKey,
  isPermissionPattern,
  matchPermission,
  patternCovers,
  PermissionSet,
} from '../src/permissions';

describe('matchPermission', () => {
  it.each([
    ['core.users.read', 'core.users.read', true],
    ['core.users.read', 'core.users.update', false],
    ['core.users.*', 'core.users.update', true],
    ['core.*', 'core.groups.manage', true],
    ['*', 'announcements.posts.manage', true],
    ['*.*.read', 'itsm.incidents.read', true],
    ['*.*.read', 'itsm.incidents.update', false],
    ['core.*.read', 'core.users.read', true],
    ['core.*.read', 'itsm.users.read', false],
    ['core.users', 'core.users.read', false],
    ['core.users.read.extra', 'core.users.read', false],
  ])('%s matches %s → %s', (pattern, key, expected) => {
    expect(matchPermission(pattern, key)).toBe(expected);
  });
});

describe('patternCovers (privilege-escalation guard)', () => {
  it.each([
    ['*', 'core.users.*', true],
    ['core.*', 'core.users.read', true],
    ['core.*', 'core.*', true],
    ['core.users.*', 'core.*', false],
    ['core.users.read', 'core.users.*', false],
    ['*.*.read', 'core.users.read', true],
    ['*.*.read', '*', false],
    ['core.users.read', 'core.users.read', true],
    ['core.users.read', 'itsm.users.read', false],
    ['core.*.read', 'core.users.*', false],
  ])('%s covers %s → %s', (grant, pattern, expected) => {
    expect(patternCovers(grant, pattern)).toBe(expected);
  });
});

describe('validation', () => {
  it('accepts module.resource.action keys only', () => {
    expect(isPermissionKey('core.users.read')).toBe(true);
    expect(isPermissionKey('core.users')).toBe(false);
    expect(isPermissionKey('Core.users.read')).toBe(false);
    expect(isPermissionKey('core.users.*')).toBe(false);
  });
  it('accepts wildcard patterns', () => {
    expect(isPermissionPattern('*')).toBe(true);
    expect(isPermissionPattern('core.*')).toBe(true);
    expect(isPermissionPattern('*.*.read')).toBe(true);
    expect(isPermissionPattern('core..read')).toBe(false);
    expect(isPermissionPattern('core.users.read.x')).toBe(false);
  });
});

describe('PermissionSet', () => {
  const set = new PermissionSet([
    { p: 'core.departments.read', s: 'g' },
    { p: 'core.users.*', s: 'd', d: ['sales', 'sales-tpe'] },
    { p: 'core.groups.manage', s: 'r', t: 'group', id: 'vpn' },
  ]);

  it('requires a matching scope for scoped grants', () => {
    expect(set.can('core.departments.read')).toBe(true);
    expect(set.can('core.users.read')).toBe(false);
    expect(set.can('core.users.read', { departmentId: 'sales-tpe' })).toBe(true);
    expect(set.can('core.users.read', { departmentId: 'finance' })).toBe(false);
    expect(set.can('core.groups.manage', { recordType: 'group', recordId: 'vpn' })).toBe(true);
    expect(set.can('core.groups.manage', { recordType: 'group', recordId: 'admins' })).toBe(false);
  });

  it('hasAny ignores scope (for navigation and button visibility)', () => {
    expect(set.hasAny('core.users.update')).toBe(true);
    expect(set.hasAny('core.roles.read')).toBe(false);
  });

  it('reach() lists where a permission applies', () => {
    expect(set.reach('core.users.read')).toEqual({
      global: false,
      departmentIds: ['sales', 'sales-tpe'],
      records: [],
    });
    expect(set.reach('core.departments.read').global).toBe(true);
  });
});
