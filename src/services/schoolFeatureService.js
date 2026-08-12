'use strict';
const { School, Settings, Subscription, SubscriptionPlan } = require('../models');
const { computeSchoolAccess, normalizePlanCode, hasFullOverride } = require('./schoolAccessEngine');

const FEATURE_KEYS = {
  dashboard:'dashboard', teachers:'teachers', teacher_approvals:'teacher_approvals', students:'students', analytics:'analytics', alerts:'alerts', finance_fees:'finance_fees', parent_messages:'parent_messages', school_settings:'school_settings', billing:'billing', classes:'classes', report_cards:'report_cards', calendar:'calendar', school_branding:'school_branding', timetable:'timetable', homework:'homework', duty:'duty', fairness_report:'fairness_report', departments:'departments', bulk_sms:'bulk_sms', senior_subject_choice:'senior_subject_choice'
};
const CORE_SCHOOL_FEATURES = ['dashboard','teachers','teacher_approvals','students','analytics','alerts','announcements','finance_fees','fees','payments','parent_messages','chat','school_settings','billing','subscriptions','classes','attendance','attendance_corrections','marks','grading','report_cards','report_history','calendar','school_branding','timetable','homework','duty','fairness_report','departments','bulk_sms','birthdays','curriculum','subject_selection','senior_subject_choice','academic_year_transition','promotions','transfers'];
const STARTER = [...CORE_SCHOOL_FEATURES];
const GROWTH = [...CORE_SCHOOL_FEATURES];
const ENTERPRISE = [...CORE_SCHOOL_FEATURES];
const ALL_FEATURES = [...new Set([...ENTERPRISE, '*', 'ai_tutor', 'ai_tutor_limited', 'ai_tutor_extended', 'live_child_analytics', 'advanced_alerts', 'child_recommendations', 'advanced_report_cards'])];
const DEFAULT_PLANS = {
  starter: { code:'starter', name:'Starter', minStudents:1, maxStudents:400, features:STARTER, branding:'school_custom_allowed', supportLevel:'standard' },
  growth: { code:'growth', name:'Growth', minStudents:401, maxStudents:800, features:GROWTH, branding:'school_custom_allowed', supportLevel:'priority' },
  enterprise: { code:'enterprise', name:'Enterprise', minStudents:801, maxStudents:null, features:ENTERPRISE, branding:'school_custom_allowed', supportLevel:'dedicated' }
};
function normalizeFeatures(plan) {
  if (!plan) return [];
  if (Array.isArray(plan.features)) return plan.features.map(f => String(f).trim()).filter(Boolean);
  if (plan.features && typeof plan.features === 'object') return Object.entries(plan.features).filter(([,v]) => !!v).map(([k]) => k);
  return [];
}
async function platformSettings() {
  const row = await Settings.findOne({ where:{ key:'platform_payment_settings' } }).catch(() => null);
  return row?.value || {};
}
function normalizeSchoolPlan(raw) {
  const code = normalizePlanCode(raw?.code || raw?.planCode || raw?.name);
  const base = DEFAULT_PLANS[code] || DEFAULT_PLANS.starter;
  const rawFeatures = normalizeFeatures(raw);
  return { ...base, ...(raw || {}), code, features: rawFeatures.length ? rawFeatures : base.features };
}
async function getPlanDefinitions() {
  const settings = await platformSettings();
  const rawPlans = Array.isArray(settings.schoolPlans) ? settings.schoolPlans : [];
  const map = new Map(Object.entries(DEFAULT_PLANS));
  rawPlans.map(normalizeSchoolPlan).filter(p => ['starter','growth','enterprise'].includes(p.code)).forEach(p => map.set(p.code, p));
  return Object.fromEntries([...map.entries()].map(([k,v]) => [k,{...v,...DEFAULT_PLANS[k],features:CORE_SCHOOL_FEATURES}]));
}
async function getSchool(schoolCode) {
  if (!schoolCode) return null;
  return School.findOne({ where:{ schoolId: schoolCode } }).catch(() => null);
}
async function getSchoolPlanCode(schoolCode) {
  const school = await getSchool(schoolCode);
  if (school) {
    const access = computeSchoolAccess(school);
    if (access.planCode) return normalizePlanCode(access.planCode);
    const settings = school.settings || {};
    const direct = settings.currentPlan || settings.plan || school.subscriptionPlan || school.plan || school.tier || school.subscriptionTier;
    if (direct) return normalizePlanCode(direct);
  }
  const sub = await Subscription.findOne({ where:{ schoolCode, ownerType:'school' }, include:[{ model:SubscriptionPlan, required:false }], order:[['updatedAt','DESC']] }).catch(() => null);
  return normalizePlanCode(sub?.planCode || sub?.SubscriptionPlan?.code || sub?.SubscriptionPlan?.name || 'starter');
}
async function getSchoolFeatures(schoolCode) {
  const defs = await getPlanDefinitions();
  const school = await getSchool(schoolCode);
  const access = school ? computeSchoolAccess(school) : { planCode:'starter', plan:'starter', accessStatus:'active', fullAccess:false, brandingAllowed:false };
  const specialFullAccess = !!school && (hasFullOverride(school) || ['pilot_demo_free_full_access','trial'].includes(access.accessMode));
  if (specialFullAccess) {
    const set = new Set(ALL_FEATURES);
    return { planCode:'enterprise', plan:{...defs.enterprise, code:'enterprise', name:'Enterprise / Full Access', override:true, fullAccess:true, features:ALL_FEATURES}, features:set, featureList:[...set], override:true, fullAccess:true, accessMode:access.accessMode, access, brandingAllowed:true };
  }
  if (access.accessStatus === 'locked' && access.accessMode === 'suspended') {
    const set = new Set(['billing','school_settings','alerts','help','profile','dashboard']);
    return { planCode:access.planCode || 'starter', plan:defs.starter, features:set, featureList:[...set], fullAccess:false, accessMode:access.accessMode, access, brandingAllowed:false };
  }
  if (access.accessStatus === 'locked' && access.accessMode === 'expired_subscription') {
    const set = new Set(['billing','subscriptions','school_settings','alerts','help','profile','dashboard']);
    return { planCode:access.planCode || 'starter', plan:defs[access.planCode] || defs.starter, features:set, featureList:[...set], fullAccess:false, accessMode:access.accessMode, access, brandingAllowed:false };
  }
  const code = normalizePlanCode(access.planCode || await getSchoolPlanCode(schoolCode));
  const configured = defs[code] || defs.starter;
  // Plans determine capacity, billing, support and allowances only. Core school features
  // are identical for Starter, Growth and Enterprise.
  const plan = { ...configured, features: CORE_SCHOOL_FEATURES };
  const set = new Set(CORE_SCHOOL_FEATURES);
  return { planCode:code, plan, features:set, featureList:[...set], fullAccess:true, accessMode:access.accessMode, access, brandingAllowed:true };
}
async function hasFeature(schoolCode, feature) {
  const key = String(feature || '').trim();
  if (!key) return false;
  const { features } = await getSchoolFeatures(schoolCode);
  return features.has('*') || features.has(key);
}
function schoolHasSeniorEnabled(school) {
  const s = school?.toJSON ? school.toJSON() : (school || {});
  const settings = s.settings || {};
  const engine = settings.curriculumEngine || {};
  const levels = [...(Array.isArray(engine.enabledLevels)?engine.enabledLevels:[]), ...(Array.isArray(s.enabledLevels)?s.enabledLevels:[])].join(' ');
  const text = [settings.schoolStructure, engine.structureType, s.schoolStructure, levels, s.level, s.type].filter(Boolean).join(' ').toLowerCase();
  if (/primary_only|primary only|junior_only|junior only|pre.?primary/.test(text)) return false;
  return /senior|secondary|mixed|full|grade_1[0-2]|grade\s*1[0-2]|g1[0-2]/.test(text) || !!(settings.hasSeniorSchool || settings.seniorEnabled || settings.seniorSchoolEnabled);
}
async function getSchoolStructure(schoolCode) {
  const school = await getSchool(schoolCode);
  return { school, seniorEnabled: schoolHasSeniorEnabled(school) };
}
module.exports = { DEFAULT_PLANS, FEATURE_KEYS, CORE_SCHOOL_FEATURES, ALL_FEATURES, STARTER, GROWTH, ENTERPRISE, getPlanDefinitions, getSchoolPlanCode, getSchoolFeatures, hasFeature, getSchoolStructure, schoolHasSeniorEnabled, normalizePlanCode };
