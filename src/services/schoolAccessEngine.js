'use strict';

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isFuture(value) {
  const d = parseDate(value);
  return !!d && d.getTime() >= Date.now();
}
function truthy(value) {
  if (value === true || value === 1) return true;
  const text = String(value || '').trim().toLowerCase();
  return ['true','1','yes','on','enabled','active','full','full_access','pilot','demo','free'].includes(text);
}
function normalizePlanCode(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^school_/, '').replace(/\s+/g, '_');
  if (raw.includes('enterprise')) return 'enterprise';
  if (raw.includes('growth')) return 'growth';
  if (raw.includes('starter')) return 'starter';
  return ['premium','full','paid'].includes(raw) ? 'enterprise' : 'starter';
}
function getNested(s) {
  const settings = s.settings || {};
  return { settings, billing: settings.billing || {}, access: settings.access || settings.schoolAccess || {} };
}
function hasFullOverride(s) {
  const { settings, billing, access } = getNested(s);
  const text = [s.accessMode,s.accessStatus,s.subscriptionStatus,s.subscriptionPlan,s.plan,s.tier,settings.accessMode,settings.accessStatus,settings.subscriptionPlan,settings.currentPlan,settings.plan,billing.accessMode,billing.subscriptionPlan,billing.subscriptionStatus,access.mode,access.accessMode,access.type].filter(Boolean).join(' ').toLowerCase();
  return truthy(s.pilotFullAccessEnabled) || truthy(settings.pilotFullAccessEnabled) || truthy(billing.pilotFullAccessEnabled) || truthy(access.pilotFullAccessEnabled)
    || truthy(s.demoMode) || truthy(settings.demoMode) || truthy(billing.demoMode) || truthy(access.demoMode)
    || truthy(s.freeFullAccess) || truthy(settings.freeFullAccess) || truthy(billing.freeFullAccess) || truthy(access.freeFullAccess)
    || truthy(s.fullAccess) || truthy(settings.fullAccess) || truthy(billing.fullAccess) || truthy(access.fullAccess)
    || /pilot[_\s-]*full|full[_\s-]*pilot|demo[_\s-]*full|free[_\s-]*full|manual[_\s-]*full|full[_\s-]*access/.test(text);
}
function currentPlan(s) {
  const { settings, billing, access } = getNested(s);
  return normalizePlanCode(settings.currentPlan || settings.plan || billing.subscriptionPlan || access.plan || s.subscriptionPlan || s.plan || s.tier || 'starter');
}
function computeSchoolAccess(school) {
  const s = school?.toJSON ? school.toJSON() : (school || {});
  const { billing } = getNested(s);
  const status = String(s.status || '').toLowerCase();
  const suspended = status === 'suspended' || truthy(s.isSuspended) || truthy(s.accessSuspended);
  const plan = currentPlan(s);
  const subscriptionEnd = s.subscriptionEndsAt || billing.subscriptionEndsAt || s.subscriptionExpiry || billing.subscriptionExpiry || null;
  const subscriptionValid = isFuture(subscriptionEnd);
  const manual = truthy(s.manualPaymentConfirmed) || truthy(billing.manualPaymentConfirmed);
  const paidStatus = ['paid','active','confirmed'].includes(String(s.subscriptionStatus || billing.subscriptionStatus || '').toLowerCase());
  const trial = (truthy(s.trialAccessEnabled) || truthy(billing.trialAccessEnabled)) && isFuture(s.trialEndsAt || billing.trialEndsAt);

  if (suspended) return { accessMode:'suspended', accessStatus:'locked', planCode:plan, plan, fullAccess:false, brandingAllowed:false, reason:s.suspensionReason || 'School suspended', featureLevel:'none' };
  if (hasFullOverride(s)) return { accessMode:'pilot_demo_free_full_access', accessStatus:'active', planCode:'enterprise', plan:'enterprise', fullAccess:true, brandingAllowed:true, reason:'Full access override is active', featureLevel:'full' };
  if (trial) return { accessMode:'trial', accessStatus:'active', planCode:'enterprise', plan:'enterprise', fullAccess:true, brandingAllowed:true, reason:'Trial access is active', featureLevel:'full' };
  if (truthy(billing.enforcementEnabled)) {
    const billingState = String(billing.billingState || '').toLowerCase() || 'payment_required';
    const dueDate = billing.nextDueDate || subscriptionEnd || null;
    const graceEndsAt = billing.graceEndsAt || null;
    if (billingState === 'restricted') {
      return { accessMode:'expired_subscription', accessStatus:'locked', planCode:plan, plan, fullAccess:false, brandingAllowed:false, reason:'Subscription payment is overdue. Pay to restore full access; school data remains safe.', featureLevel:'expired', billingState, nextDueDate:dueDate, graceEndsAt };
    }
    if (['payment_required','grace','due_soon'].includes(billingState)) {
      return { accessMode:'subscription_grace', accessStatus:'active', planCode:plan, plan, fullAccess:true, brandingAllowed:true, reason:'Subscription payment reminder is active', featureLevel:'full_core', billingState, paymentRequired:true, nextDueDate:dueDate, graceEndsAt };
    }
    return { accessMode:'paid_subscription', accessStatus:'active', planCode:plan, plan, fullAccess:true, brandingAllowed:true, reason:'Subscription is active', featureLevel:'full_core', billingState, nextDueDate:dueDate, graceEndsAt };
  }
  if ((manual || paidStatus) && subscriptionValid) return { accessMode:manual?'manual_paid':'paid_subscription',accessStatus:'active',planCode:plan,plan,fullAccess:true,brandingAllowed:true,reason:'Subscription is active; plan controls capacity and allowances only',featureLevel:'full_core',subscriptionEndsAt:subscriptionEnd };
  if ((manual || paidStatus) && subscriptionEnd && !subscriptionValid) return { accessMode:'expired_subscription', accessStatus:'locked', planCode:plan, plan, fullAccess:false, brandingAllowed:false, reason:'Subscription period has expired', featureLevel:'expired', subscriptionEndsAt:subscriptionEnd };
  return { accessMode:'size_based_plan',accessStatus:'active',planCode:plan||'starter',plan:plan||'starter',fullAccess:true,brandingAllowed:true,reason:'All core school modules are included; plan is based on active student count',featureLevel:'full_core' };
}
function withAccessFields(schoolJson) { return { ...schoolJson, access: computeSchoolAccess(schoolJson) }; }
module.exports = { computeSchoolAccess, withAccessFields, normalizePlanCode, hasFullOverride };
