const TRUSTED_ROLES = new Set([
  'super_admin',
  'admin',
  'teacher',
  'parent',
  'student',
  'finance_officer'
]);

const SAFE_SECONDARY_ROLES = new Set([
  'finance_officer'
]);

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

function dataValue(user, key) {
  if (!user) return undefined;
  if (typeof user.getDataValue === 'function') return user.getDataValue(key);
  return user[key];
}

function primaryRoleOf(user) {
  return normalizeRole(dataValue(user, 'primaryRole') || dataValue(user, 'role') || user?.role);
}

function rolesFromAssignments(assignments = []) {
  return [...new Set((assignments || [])
    .filter(a => String(a?.status || 'active') === 'active')
    .map(a => normalizeRole(a.role))
    .filter(role => SAFE_SECONDARY_ROLES.has(role)))];
}

function getLoadedSecondaryRoles(user) {
  const loaded = dataValue(user, 'safeAdditionalRoles') || user?.safeAdditionalRoles;
  return Array.isArray(loaded) ? rolesFromAssignments(loaded.map(role => ({ role, status: 'active' }))) : [];
}

async function loadSafeAdditionalRoles(user) {
  const primaryRole = primaryRoleOf(user);
  if (!user || ['student', 'parent', 'super_admin'].includes(primaryRole)) return [];
  const userId = Number(dataValue(user, 'id') || user.id);
  const schoolCode = String(dataValue(user, 'schoolCode') || user.schoolCode || '').trim();
  if (!userId || !schoolCode) return [];
  const { UserRoleAssignment } = require('../models');
  if (!UserRoleAssignment) return [];
  const rows = await UserRoleAssignment.findAll({
    where: {
      userId,
      schoolCode,
      status: 'active'
    },
    attributes: ['role', 'status', 'metadata']
  }).catch(() => []);
  const roles = rolesFromAssignments(rows);
  const finance = rows.find(row => normalizeRole(row.role) === 'finance_officer' && String(row.status || 'active') === 'active');
  const financeMeta = finance?.metadata || null;
  if (typeof user.setDataValue === 'function') {
    user.setDataValue('safeAdditionalRoles', roles);
    if (financeMeta) user.setDataValue('financeAssignment', financeMeta);
  }
  user.safeAdditionalRoles = roles;
  if (financeMeta) {
    user.financeAssignment = financeMeta;
    user.financeTitle = financeMeta.title || user.financeTitle;
    user.financePermissions = Array.isArray(financeMeta.permissions) ? financeMeta.permissions : user.financePermissions;
  }
  return roles;
}

function safeAdditionalRoles(user) {
  return getLoadedSecondaryRoles(user);
}

function canUseEffectiveRole(user, requestedRole) {
  const requested = normalizeRole(requestedRole || dataValue(user, 'role') || user?.role);
  const primaryRole = primaryRoleOf(user);
  if (!TRUSTED_ROLES.has(requested)) return false;
  if (requested === primaryRole) return true;
  if (requested === 'super_admin') return false;
  return SAFE_SECONDARY_ROLES.has(requested) && safeAdditionalRoles(user).includes(requested);
}

async function canUseEffectiveRoleAsync(user, requestedRole) {
  await loadSafeAdditionalRoles(user);
  return canUseEffectiveRole(user, requestedRole);
}

function sanitizePreferencePayload(input = {}) {
  const SAFE_PREFERENCE_KEYS = new Set([
    'theme',
    'language',
    'notifications',
    'dashboard',
    'accessibility',
    'timezone',
    'display',
    'privacy',
    'profileImageUrl',
    'profilePicture',
    'signatureUrl'
  ]);
  const BLOCKED_PREFERENCE_KEYS = new Set([
    'role',
    'roles',
    'effectiveRole',
    'primaryRole',
    'additionalRoles',
    'permissions',
    'finance',
    'isSuperAdmin',
    'isAdmin',
    'schoolCode',
    'schoolId',
    'subscription',
    'plan',
    'features',
    'featureLocks'
  ]);
  const safe = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (BLOCKED_PREFERENCE_KEYS.has(key)) continue;
    if (!SAFE_PREFERENCE_KEYS.has(key)) continue;
    safe[key] = value;
  }
  return safe;
}

function removePrivilegeBearingPreferenceKeys(input = {}) {
  const preferences = { ...(input || {}) };
  for (const key of [
    'role', 'roles', 'effectiveRole', 'primaryRole', 'additionalRoles', 'permissions',
    'isSuperAdmin', 'isAdmin', 'schoolCode', 'schoolId', 'finance', 'subscription', 'plan',
    'features', 'featureLocks'
  ]) {
    delete preferences[key];
  }
  return preferences;
}

module.exports = {
  TRUSTED_ROLES,
  normalizeRole,
  safeAdditionalRoles,
  loadSafeAdditionalRoles,
  canUseEffectiveRole,
  canUseEffectiveRoleAsync,
  sanitizePreferencePayload,
  removePrivilegeBearingPreferenceKeys
};
