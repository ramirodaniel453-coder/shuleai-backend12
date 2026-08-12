const { Op } = require('sequelize');
const {
  SubscriptionPlan,
  Subscription,
  SubscriptionPayment,
  Parent,
  Student,
  User,
  School,
  AuditLog,
  Settings
} = require('../models');
const schoolFeatures = require('../services/schoolFeatureService');
const subscriptionEnforcement = require('../services/subscriptionEnforcementService');

const SCHOOL_CORE_FEATURES = schoolFeatures.CORE_SCHOOL_FEATURES || ['dashboard','students','teachers','attendance','marks','report_cards','fees','calendar','timetable','homework','duty','departments','school_branding','alerts','bulk_sms'];
const SCHOOL_PREMIUM_FEATURES = [];

function normalizeCycle(cycle) {
  const value = String(cycle || 'monthly').toLowerCase();
  return ['monthly', 'termly', 'yearly', 'custom'].includes(value) ? value : 'monthly';
}

function addPeriod(fromDate, cycle) {
  const base = fromDate ? new Date(fromDate) : new Date();
  const start = base > new Date() ? base : new Date();
  const end = new Date(start);
  const normalized = normalizeCycle(cycle);
  if (normalized === 'yearly') end.setFullYear(end.getFullYear() + 1);
  else if (normalized === 'termly') end.setMonth(end.getMonth() + 3);
  else end.setMonth(end.getMonth() + 1);
  return { startDate: new Date(), endDate: end };
}

function daysRemaining(endDate, status = 'active') {
  if (!endDate || status !== 'active') return 0;
  return Math.max(0, Math.ceil((new Date(endDate) - new Date()) / 86400000));
}

function planAmount(plan, cycle) {
  const normalized = normalizeCycle(cycle);
  if (normalized === 'yearly' && plan.yearlyPriceKes) return Number(plan.yearlyPriceKes);
  if (normalized === 'termly' && plan.termlyPriceKes) return Number(plan.termlyPriceKes);
  return Number(plan.monthlyPriceKes || plan.price_kes || 0);
}


function normalizeSettingsPlan(raw, ownerType, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const rawCode = String(raw.code || raw.id || raw.name || raw.displayName || '').trim().toLowerCase().replace(/\s+/g, '_');
  const prefix = ownerType === 'school' ? 'school' : 'child';
  const code = rawCode.startsWith(`${prefix}_`) ? rawCode : `${prefix}_${rawCode || (ownerType === 'school' ? 'plan' : 'plan')}_${index + 1}`;
  const amount = Math.max(0, Math.round(Number(raw.monthlyPriceKes ?? raw.price_kes ?? raw.price ?? raw.amount ?? raw.monthly ?? 0)) || 0);
  const displayName = raw.displayName || raw.name || raw.title || code.replace(`${prefix}_`, '').replace(/_/g, ' ');
  return {
    id: raw.id || code,
    code,
    name: displayName,
    displayName,
    ownerType,
    price: amount,
    monthlyPriceKes: amount,
    termlyPriceKes: raw.termlyPriceKes ?? raw.termly ?? null,
    yearlyPriceKes: raw.yearlyPriceKes ?? raw.yearly ?? null,
    setupFeeMinKes: raw.setupFeeMinKes ?? raw.setupMin ?? null,
    setupFeeMaxKes: raw.setupFeeMaxKes ?? raw.setupMax ?? null,
    features: ownerType === 'school' ? SCHOOL_CORE_FEATURES : (Array.isArray(raw.features) ? raw.features : []),
    lockedFeatures: ownerType === 'school' ? [] : (Array.isArray(raw.lockedFeatures) ? raw.lockedFeatures : []),
    limits: raw.limits && typeof raw.limits === 'object' ? raw.limits : { days: Number(raw.days || 30) || 30 },
    sortOrder: Number(raw.sortOrder ?? index ?? 0),
    isActive: raw.isActive !== false,
    source: 'platform_payment_settings'
  };
}

async function getPlatformConfiguredPlans(ownerType) {
  const row = await Settings.findOne({ where: { key: 'platform_payment_settings' } }).catch(() => null);
  const value = row?.value || {};
  const key = ownerType === 'school' ? 'schoolPlans' : ownerType === 'child' ? 'parentPlans' : null;
  if (!key || !Array.isArray(value[key]) || !value[key].length) return null;
  const legacy = new Set(['monthly', 'termly', 'yearly', 'month', 'term', 'year']);
  const seen = new Set();
  return value[key]
    .map((p, idx) => normalizeSettingsPlan(p, ownerType, idx))
    .filter(Boolean)
    .filter(plan => {
      const c = String(plan.code || '').replace(/^(school|child)_/, '');
      const n = String(plan.displayName || plan.name || '').trim().toLowerCase();
      if (legacy.has(c) || legacy.has(n)) return false;
      if (seen.has(plan.code)) return false;
      seen.add(plan.code);
      return plan.isActive !== false;
    });
}

function planPayload(plan) {
  return {
    id: plan.id,
    code: plan.code || plan.name,
    name: plan.displayName || plan.name,
    displayName: plan.displayName || plan.name,
    ownerType: plan.ownerType,
    price: plan.price_kes,
    monthlyPriceKes: plan.monthlyPriceKes || plan.price_kes,
    termlyPriceKes: plan.termlyPriceKes,
    yearlyPriceKes: plan.yearlyPriceKes,
    setupFeeMinKes: plan.setupFeeMinKes,
    setupFeeMaxKes: plan.setupFeeMaxKes,
    features: plan.features || [],
    lockedFeatures: plan.lockedFeatures || [],
    limits: plan.limits || {},
    sortOrder: plan.sortOrder || 0
  };
}

async function getParentWithStudents(userId) {
  return Parent.findOne({
    where: { userId },
    include: [{ model: Student, as: 'students', include: [{ model: User, attributes: ['id', 'name', 'email', 'profileImage', 'profilePicture'] }] }]
  });
}

async function getSchoolForUser(user) {
  return School.findOne({ where: { schoolId: user.schoolCode } });
}

function normalizeLookupCode(code, ownerType) {
  const raw = String(code || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (ownerType === 'school') {
    if (!raw || raw === 'growth' || raw === 'school_growth') return 'school_growth';
    if (raw.includes('enterprise')) return 'school_enterprise';
    if (raw.includes('starter')) return 'school_starter';
    return raw.startsWith('school_') ? raw : `school_${raw}`;
  }
  if (!raw || raw === 'essential' || raw === 'basic' || raw === 'child_essential' || raw === 'child_basic') return 'child_basic';
  if (raw.includes('genius') || raw.includes('ultimate')) return 'child_ultimate';
  if (raw.includes('smart') || raw.includes('premium')) return 'child_premium';
  return raw.startsWith('child_') ? raw : `child_${raw}`;
}

async function getPlanByCode(code, ownerType) {
  const canonical = normalizeLookupCode(code, ownerType);
  const aliases = ownerType === 'school'
    ? { school_starter: ['school_starter','starter'], school_growth: ['school_growth','growth'], school_enterprise: ['school_enterprise','enterprise'] }
    : { child_basic: ['child_basic','child_essential','essential','basic'], child_premium: ['child_premium','child_smart','smart','premium'], child_ultimate: ['child_ultimate','child_genius','genius','ultimate'] };
  const values = aliases[canonical] || [canonical, String(code || '').toLowerCase()];
  return SubscriptionPlan.findOne({
    where: {
      isActive: true,
      ownerType,
      [Op.or]: [
        { code: { [Op.in]: values } },
        { name: { [Op.in]: values } },
        ...values.map(v => ({ displayName: { [Op.iLike]: v } }))
      ]
    },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']]
  });
}

async function findOrCreateSchoolSubscription(school, plan, cycle) {
  const [subscription] = await Subscription.findOrCreate({
    where: { ownerType: 'school', schoolCode: school.schoolId },
    defaults: {
      ownerType: 'school',
      schoolId: school.id,
      schoolCode: school.schoolId,
      planId: plan?.id || null,
      planCode: plan?.code || 'school_starter',
      planName: plan?.displayName || plan?.name || 'Starter',
      billingCycle: normalizeCycle(cycle),
      status: 'pending',
      features: plan?.features || [],
      limits: plan?.limits || {}
    }
  });
  return subscription;
}

async function findOrCreateChildSubscription(parent, student, plan, cycle) {
  const [subscription] = await Subscription.findOrCreate({
    where: { ownerType: 'child', studentId: student.id },
    defaults: {
      ownerType: 'child',
      schoolCode: student.User?.schoolCode || student.schoolCode || null,
      parentId: parent.id,
      studentId: student.id,
      planId: plan?.id || null,
      planCode: plan?.code || 'child_basic',
      planName: plan?.displayName || plan?.name || 'Basic',
      billingCycle: normalizeCycle(cycle),
      status: 'pending',
      features: plan?.features || [],
      limits: plan?.limits || {}
    }
  });
  return subscription;
}

async function renewSubscription(subscription, plan, cycle, paymentId, options = {}) {
  const transaction=options.transaction;
  if (subscription.ownerType === 'school') {
    const school = await School.findOne({ where:{ schoolId:subscription.schoolCode },transaction,lock:transaction?transaction.LOCK.UPDATE:undefined });
    if (!school) throw new Error('School not found for subscription activation');
    return subscriptionEnforcement.activatePaid(subscription, school, plan, cycle || subscription.billingCycle, paymentId,{transaction});
  }
  const period = addPeriod(subscription.endDate, cycle || subscription.billingCycle);
  const trail = Array.isArray(subscription.auditTrail) ? subscription.auditTrail : [];
  trail.push({ action: 'renewed', paymentId, planCode: plan.code || plan.name, cycle: normalizeCycle(cycle), at: new Date().toISOString() });
  await subscription.update({
    planId: plan.id,
    planCode: plan.code || plan.name,
    planName: plan.displayName || plan.name,
    billingCycle: normalizeCycle(cycle),
    status: 'active',
    startDate: period.startDate,
    endDate: period.endDate,
    lastPaymentId: paymentId,
    features: plan.features || [],
    limits: plan.limits || {},
    auditTrail: trail
  },{transaction});
  if (subscription.ownerType === 'child' && subscription.studentId) {
    const student = await Student.findByPk(subscription.studentId,{transaction,lock:transaction?transaction.LOCK.UPDATE:undefined});
    if (student) {
      const childPlanName = String(plan.name || '').replace(/^child_/, '').replace(/^school_/, '') || 'essential';
      await student.update({
        subscriptionPlan: ['basic','premium','ultimate'].includes(childPlanName) ? childPlanName : (childPlanName === 'genius' ? 'ultimate' : childPlanName === 'smart' ? 'premium' : 'basic'),
        subscriptionStatus: 'active',
        subscriptionStartDate: period.startDate,
        subscriptionExpiry: period.endDate,
        paymentStatus: { ...(student.paymentStatus || {}), plan: plan.code || plan.name, status: 'active', expiryDate: period.endDate, lastPaymentId: paymentId }
      },{transaction});
    }
  }
  return subscription;
}

exports.renewSubscription = renewSubscription;
exports.findOrCreateSchoolSubscription = findOrCreateSchoolSubscription;
exports.findOrCreateChildSubscription = findOrCreateChildSubscription;
exports.getPlanByCode = getPlanByCode;
exports.planAmount = planAmount;
exports.daysRemaining = daysRemaining;

exports.getPlans = async (req, res) => {
  try {
    const ownerType = req.query.ownerType;
    // v117: if Super Admin has saved platform plan JSON, that is the source of truth.
    // This prevents the admin/parent dashboards from showing old seeded Monthly/Termly/Yearly or Starter/Growth/Enterprise cards beside the new live cards.
    if (ownerType === 'school' || ownerType === 'child') {
      const configured = await getPlatformConfiguredPlans(ownerType);
      if (configured && configured.length) {
        const ranges={school_starter:[1,400],school_growth:[401,800],school_enterprise:[801,null]};
        const data=ownerType==='school'?configured.map(p=>{const r=ranges[p.code]||ranges[`school_${String(p.code||'').replace(/^school_/,'')}`]||[1,null];return {...p,features:SCHOOL_CORE_FEATURES,lockedFeatures:[],limits:{...(p.limits||{}),minStudents:r[0],maxStudents:r[1]},pricingBasis:'active_students'};}):configured;
        return res.json({success:true,data});
      }
    }
    const where = { isActive: true };
    if (ownerType) where.ownerType = ownerType;
    const plans = await SubscriptionPlan.findAll({ where, order: [['sortOrder', 'ASC'], ['price_kes', 'ASC']] });
    const legacyCycleCards = new Set(['monthly', 'termly', 'yearly', 'month', 'term', 'year']);
    const cleaned = plans.map(planPayload).filter(p => {
      const code = String(p.code || p.name || '').toLowerCase().replace(/^(school|child)_/, '');
      const name = String(p.displayName || p.name || '').trim().toLowerCase();
      return !legacyCycleCards.has(code) && !legacyCycleCards.has(name);
    });
    res.json({ success: true, data: cleaned });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSchoolStatus = async (req, res) => {
  try {
    const school = await getSchoolForUser(req.user);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const subscription = await Subscription.findOne({ where: { ownerType: 'school', schoolCode: school.schoolId }, include: [{ model: SubscriptionPlan }] });
    if (subscription?.enforcementEnabled) await subscriptionEnforcement.processSubscription(subscription).catch(() => null);
    const enforcement = await subscriptionEnforcement.getSummary(subscription, school);
    await school.reload().catch(() => null);
    const featureInfo = await schoolFeatures.getSchoolFeatures(school.schoolId);
    const studentCount = await Student.count({ include:[{ model:User, where:{ schoolCode:school.schoolId, role:'student', isActive:true }, required:true }], where:{ status:{ [Op.in]:['active','enrolled'] } } }).catch(async () => User.count({ where:{ schoolCode:school.schoolId, role:'student', isActive:true } }).catch(() => 0));
    const subActive = subscription?.status === 'active' && subscription.endDate && new Date(subscription.endDate) > new Date();
    const override = !!featureInfo.override || ['pilot_demo_free_full_access','trial'].includes(featureInfo.accessMode);
    const accessActive = featureInfo.access?.accessStatus !== 'locked';
    const active = accessActive || subActive;
    const tier = featureInfo.plan?.name || subscription?.planName || 'Starter';
    res.json({
      success: true,
      data: {
        schoolId: school.id,
        schoolCode: school.schoolId,
        schoolName: school.name,
        currentPlan: tier,
        planCode: featureInfo.planCode || subscription?.planCode || 'starter',
        status: override ? 'pilot_full_access' : (active ? 'active' : (subscription?.status || 'pending')),
        billingCycle: subscription?.billingCycle || 'monthly',
        expiresAt: override ? null : (subscription?.endDate || school.subscriptionEndsAt || null),
        daysRemaining: override ? 9999 : daysRemaining(subscription?.endDate || school.subscriptionEndsAt, active ? 'active' : subscription?.status),
        studentCount,
        schoolTier: tier,
        features: featureInfo.featureList || [],
        fullAccess: featureInfo.access?.accessStatus !== 'locked',
        override,
        accessMode: featureInfo.accessMode || (override ? 'pilot_full_access' : 'size_based_plan'),
        pricingBasis: 'active_students',
        suggestedPlanCode: studentCount <= 400 ? 'starter' : (studentCount <= 800 ? 'growth' : 'enterprise'),
        suggestedPlanName: studentCount <= 400 ? 'Starter' : (studentCount <= 800 ? 'Growth' : 'Enterprise'),
        coreFeatures: featureInfo.featureList || SCHOOL_CORE_FEATURES,
        premiumLocked:false,
        lockedFeatures:[],
        gracefulMode:['payment_required','grace','due_soon'].includes(enforcement.billingState),
        enforcement,
        paymentRequired:!!enforcement.enforcementEnabled && enforcement.billingState !== 'active',
        subscription
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyStatus = async (req, res) => {
  try {
    if (['admin', 'teacher', 'super_admin'].includes(req.user.role)) return exports.getSchoolStatus(req, res);
    if (req.user.role === 'student') {
      const student = await Student.findOne({ where: { userId: req.user.id }, include: [{ model: User, attributes: ['id','name','email','schoolCode'] }] });
      if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });
      const sub = await Subscription.findOne({ where: { ownerType:'child', studentId:student.id }, include:[{ model:SubscriptionPlan }] });
      return res.json({ success:true, data:{ studentId:student.id, subscription: sub, status: sub?.status || student.subscriptionStatus, plan: sub?.planName || student.subscriptionPlan, daysRemaining: daysRemaining(sub?.endDate, sub?.status) } });
    }
    if (req.user.role !== 'parent') return res.json({ success:true, data:{ role:req.user.role } });
    const parent = await getParentWithStudents(req.user.id);
    if (!parent) return res.status(404).json({ success:false, message:'Parent profile not found' });
    const students = [];
    for (const child of parent.students || []) {
      const sub = await Subscription.findOne({ where:{ ownerType:'child', studentId:child.id }, include:[{ model:SubscriptionPlan }] });
      students.push({ id:child.id, name:child.User?.name || child.elimuid, subscription:sub, plan:sub?.planName || child.subscriptionPlan, status:sub?.status || child.subscriptionStatus, expiry:sub?.endDate || child.subscriptionExpiry, remainingDays: daysRemaining(sub?.endDate || child.subscriptionExpiry, sub?.status || child.subscriptionStatus) });
    }
    res.json({ success:true, data:{ parentId:parent.id, students, primary:students[0] || null } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getChildStatus = async (req, res) => {
  try {
    const parent = await getParentWithStudents(req.user.id);
    const child = (parent?.students || []).find(s => String(s.id) === String(req.params.studentId));
    if (!child) return res.status(404).json({ success:false, message:'Child not found or not linked to this parent' });
    const sub = await Subscription.findOne({ where:{ ownerType:'child', studentId:child.id }, include:[{ model:SubscriptionPlan }] });
    res.json({ success:true, data:{ studentId:child.id, childName:child.User?.name || child.elimuid, subscription:sub, status:sub?.status || child.subscriptionStatus, plan:sub?.planName || child.subscriptionPlan, daysRemaining:daysRemaining(sub?.endDate || child.subscriptionExpiry, sub?.status || child.subscriptionStatus) } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.createChildSubscriptionRequest = async (req, res) => {
  try {
    const { studentId, planCode='child_basic', billingCycle='monthly' } = req.body || {};
    const parent = await getParentWithStudents(req.user.id);
    if (!parent) return res.status(404).json({ success:false, message:'Parent profile not found' });
    const child = (parent.students || []).find(s => String(s.id) === String(studentId)) || parent.students?.[0];
    if (!child) return res.status(404).json({ success:false, message:'Child not found' });
    const plan = await getPlanByCode(planCode, 'child');
    if (!plan) return res.status(404).json({ success:false, message:'Child subscription plan not found' });
    const subscription = await findOrCreateChildSubscription(parent, child, plan, billingCycle);
    await subscription.update({ planId:plan.id, planCode:plan.code || plan.name, planName:plan.displayName || plan.name, billingCycle:normalizeCycle(billingCycle), status:'pending', features:plan.features || [], limits:plan.limits || {} });
    res.json({ success:true, message:'Child subscription request prepared. Complete STK payment to activate.', data:{ subscription, amount:planAmount(plan, billingCycle), plan:planPayload(plan) } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.createSchoolSubscriptionRequest = async (req, res) => {
  try {
    const { planCode='school_growth', billingCycle='monthly' } = req.body || {};
    const school = await getSchoolForUser(req.user);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const plan = await getPlanByCode(planCode, 'school');
    if (!plan) return res.status(404).json({ success:false, message:'School subscription plan not found' });
    const normalizedCycle = subscriptionEnforcement.requireBillingCycle(billingCycle);
    const subscription = await findOrCreateSchoolSubscription(school, plan, normalizedCycle);
    await subscription.update({ planId:plan.id, planCode:plan.code || plan.name, planName:plan.displayName || plan.name, billingCycle:normalizedCycle, status:'pending', features:plan.features || [], limits:plan.limits || {} });
    await subscriptionEnforcement.configurePending(subscription, school, normalizedCycle);
    const enforcement = await subscriptionEnforcement.getSummary(subscription, school);
    res.json({ success:true, message:'School subscription cadence saved and payment is now due.', data:{ subscription, enforcement, amount:planAmount(plan, normalizedCycle), plan:planPayload(plan) } });
  } catch(error) {
    const calendarMissing = /academic calendar|term dates|academic year/i.test(String(error.message || ''));
    res.status(error.statusCode || (calendarMissing ? 400 : 500)).json({ success:false, code:error.code || (calendarMissing ? 'ACADEMIC_CALENDAR_REQUIRED' : 'SUBSCRIPTION_REQUEST_FAILED'), message:error.message });
  }
};

exports.expireNow = async (req, res) => {
  try {
    const updated = await Subscription.update({ status:'expired' }, { where:{ endDate:{ [Op.lt]: new Date() }, status:'active' } });
    res.json({ success:true, message:'Expired subscriptions updated', data:{ updated } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getBillingHistory = async (req, res) => {
  try {
    const school = await getSchoolForUser(req.user);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const payments = await SubscriptionPayment.findAll({ where:{ ownerType:'school', schoolCode:school.schoolId }, order:[['createdAt','DESC']], limit:50 });
    res.json({ success:true, data:payments });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};
