import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, PERMISSIONS, normalizeRole, canAccessAdminPanel, canReviewRecovery, getPermissions } from '../src/services/permissions.js';

test('normalizeRole keeps known roles and upgrades legacy admins', () => {
  assert.equal(normalizeRole(ROLES.SUPPORT, false), ROLES.SUPPORT);
  assert.equal(normalizeRole('unknown', false), ROLES.MEMBER);
  assert.equal(normalizeRole(ROLES.MEMBER, true), ROLES.ADMIN);
});

test('permission helpers expose future role matrix', () => {
  assert.equal(canReviewRecovery({ role: ROLES.SUPPORT, is_admin: false }), true);
  assert.equal(canAccessAdminPanel({ role: ROLES.SUPPORT, is_admin: false }), false);
  assert.equal(canAccessAdminPanel({ role: ROLES.MEMBER, is_admin: true }), true);
  assert.ok(getPermissions({ role: ROLES.ADMIN }).includes(PERMISSIONS.ADMIN_PANEL));
});
