'use strict';

const { Op } = require('sequelize');
const { Subscription, SubscriptionPlan, School, SchoolCalendar, User } = require('../models');
const { createAlert } = require('./notificationService');

const DAY = 24 * 60 * 60 * 1000;

function date(value) {
  if (!value) return null;
  const out = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(out.getTime()) ? null : out;
}
function addDays(value, days) {
  const out = date(value) || new Date();
  out.setDate(out.getDate() + Number(days || 0));
  return out;
}
function addMonths(value, months) {
  const source = date(value) || new Date();
  const out = new Date(source);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + Number(months || 0));
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, last));
  return out;
}
function isoDay(value) {
  const d = date(value);
  return d ? d.toISOString().slice(0, 10) : null;
}
function normalizeCycle(value) {
  const cycle = String(value || 'monthly').trim().toLowerCase();
  return ['monthly','termly','yearly'].includes(cycle) ? cycle : 'monthly';
}
function requireBillingCycle(value) {
  const cycle = String(value || '').trim().toLowerCase();
  if (!['monthly','termly','yearly'].includes(cycle)) {
    const error = new Error('Billing cycle must be monthly, termly, or yearly.');
    error.statusCode = 400;
    error.code = 'INVALID_BILLING_CYCLE';
    throw error;
  }
  return cycle;
}
function termKey(value) {
  const text = String(value || '').trim().toLowerCase();
  const m = text.match(/(?:term|t)\s*([123])/i);
  return m ? `Term ${m[1]}` : (['1','2','3'].includes(text) ? `Term ${text}` : null);
}
function eventKind(event) {
  const text = `${event.eventType || ''} ${event.eventName || ''}`.toLowerCase();
  if (/(term|school|academic).*(open|start|begin|resume|reopen)|opening|resumption/.test(text)) return 'start';
  if (/(term|school|academic).*(close|end|finish)|closing/.test(text)) return 'end';
  return null;
}
async function calendarWindows(schoolCode, fromDate = new Date()) {
  const from = date(fromDate) || new Date();
  const startYear = from.getFullYear() - 1;
  const endYear = from.getFullYear() + 2;
  const events = await SchoolCalendar.findAll({
    where: {
      schoolId: schoolCode,
      startDate: { [Op.between]: [`${startYear}-01-01`, `${endYear}-12-31`] }
    },
    order: [['startDate','ASC']]
  });
  const groups = new Map();
  for (const event of events) {
    const term = termKey(event.term) || termKey(event.eventName);
    if (!term) continue;
    const year = Number(event.year || String(event.startDate || '').slice(0,4) || from.getFullYear());
    const key = `${year}:${term}`;
    const row = groups.get(key) || { year, term, starts:[], ends:[], all:[] };
    const start = date(event.startDate);
    const end = date(event.endDate || event.startDate);
    if (start) row.all.push(start);
    if (end) row.all.push(end);
    const kind = eventKind(event);
    if (kind === 'start' && start) row.starts.push(start);
    if (kind === 'end' && end) row.ends.push(end);
    groups.set(key, row);
  }
  return [...groups.values()].map(row => {
    const all = row.all.sort((a,b) => a-b);
    const starts = row.starts.sort((a,b) => a-b);
    const ends = row.ends.sort((a,b) => a-b);
    return {
      year: row.year,
      term: row.term,
      startDate: starts[0] || all[0] || null,
      endDate: ends[ends.length-1] || all[all.length-1] || null
    };
  }).filter(row => row.startDate && row.endDate && row.endDate >= row.startDate)
    .sort((a,b) => a.startDate - b.startDate);
}
function settingsWindows(school, fromDate = new Date()) {
  const settings = school?.settings || {};
  const raw = settings.academicCalendar || settings.termDates || settings.calendar || {};
  const rows = [];
  const values = Array.isArray(raw) ? raw : Object.values(raw || {});
  for (const item of values) {
    if (!item || typeof item !== 'object') continue;
    const term = termKey(item.term || item.name || item.label);
    const startDate = date(item.startDate || item.openingDate || item.openDate);
    const endDate = date(item.endDate || item.closingDate || item.closeDate);
    if (!term || !startDate || !endDate) continue;
    rows.push({ year:Number(item.year || startDate.getFullYear()), term, startDate, endDate });
  }
  return rows.sort((a,b) => a.startDate-b.startDate);
}
async function getAcademicWindows(school, fromDate) {
  const rows = await calendarWindows(school.schoolId, fromDate);
  return rows.length ? rows : settingsWindows(school, fromDate);
}
function chooseWindow(windows, anchor) {
  const at = date(anchor) || new Date();
  return windows.find(row => row.startDate <= at && row.endDate >= at)
    || windows.find(row => row.startDate >= at)
    || null;
}
async function resolvePeriod(school, cycleInput, anchorInput = new Date(), graceDays = 7) {
  const cycle = normalizeCycle(cycleInput);
  const anchor = date(anchorInput) || new Date();
  if (cycle === 'monthly') {
    const endDate = addMonths(anchor, 1);
    return {
      cycle,
      startDate: anchor,
      endDate,
      dueDate: endDate,
      graceEndsAt: addDays(endDate, graceDays),
      periodKey: `monthly:${anchor.toISOString().slice(0,7)}:${isoDay(endDate)}`,
      academicPeriod: { cycle, startsAt:anchor.toISOString(), endsAt:endDate.toISOString(), nextStartDate:null }
    };
  }

  const windows = await getAcademicWindows(school, anchor);
  if (!windows.length) {
    const error = new Error(`${cycle === 'termly' ? 'Termly' : 'Yearly'} billing requires published academic calendar opening and closing dates.`);
    error.statusCode = 400;
    error.code = 'ACADEMIC_CALENDAR_REQUIRED';
    throw error;
  }

  if (cycle === 'termly') {
    const selected = chooseWindow(windows, anchor);
    if (!selected) {
      const error = new Error('No current or upcoming term with valid opening and closing dates was found.');
      error.statusCode = 400;
      error.code = 'TERM_DATES_REQUIRED';
      throw error;
    }
    const next = windows.find(row => row.startDate > selected.endDate) || null;
    const graceBase = next?.startDate || selected.endDate;
    return {
      cycle,
      startDate: anchor > selected.startDate ? anchor : selected.startDate,
      endDate: selected.endDate,
      dueDate: selected.endDate,
      graceEndsAt: addDays(graceBase, graceDays),
      periodKey: `termly:${selected.year}:${selected.term.replace(/\s+/g,'_').toLowerCase()}`,
      academicPeriod: {
        cycle,
        academicYear:selected.year,
        term:selected.term,
        startsAt:selected.startDate.toISOString(),
        endsAt:selected.endDate.toISOString(),
        nextStartDate:next?.startDate?.toISOString() || null,
        nextTerm:next?.term || null,
        nextAcademicYear:next?.year || null
      }
    };
  }

  const yearGroups = new Map();
  for (const row of windows) {
    const group = yearGroups.get(row.year) || { year:row.year, starts:[], ends:[] };
    group.starts.push(row.startDate);
    group.ends.push(row.endDate);
    yearGroups.set(row.year, group);
  }
  const years = [...yearGroups.values()].map(group => ({
    year:group.year,
    startDate:group.starts.sort((a,b)=>a-b)[0],
    endDate:group.ends.sort((a,b)=>a-b).at(-1)
  })).sort((a,b)=>a.startDate-b.startDate);
  const selected = years.find(row => row.startDate <= anchor && row.endDate >= anchor) || years.find(row => row.startDate >= anchor) || null;
  if (!selected) {
    const error = new Error('No current or upcoming academic year with valid opening and closing dates was found.');
    error.statusCode = 400;
    error.code = 'ACADEMIC_YEAR_DATES_REQUIRED';
    throw error;
  }
  const next = years.find(row => row.startDate > selected.endDate) || null;
  const graceBase = next?.startDate || selected.endDate;
  return {
    cycle,
    startDate: anchor > selected.startDate ? anchor : selected.startDate,
    endDate: selected.endDate,
    dueDate: selected.endDate,
    graceEndsAt: addDays(graceBase, graceDays),
    periodKey: `yearly:${selected.year}`,
    academicPeriod: {
      cycle,
      academicYear:selected.year,
      startsAt:selected.startDate.toISOString(),
      endsAt:selected.endDate.toISOString(),
      nextStartDate:next?.startDate?.toISOString() || null,
      nextAcademicYear:next?.year || selected.year + 1
    }
  };
}
function stateFor(subscription, nowInput = new Date()) {
  const now = date(nowInput) || new Date();
  if (!subscription?.enforcementEnabled) return 'not_enforced';
  const due = date(subscription.nextDueDate || subscription.endDate);
  const grace = date(subscription.graceEndsAt || due);
  if (!due) return subscription.status === 'pending' ? 'payment_required' : 'active';
  if (now < due) {
    const days = Math.ceil((due - now) / DAY);
    return days <= 7 ? 'due_soon' : 'active';
  }
  if (grace && now <= grace) return 'grace';
  return 'restricted';
}
function schoolBillingPatch(school, subscription, billingState) {
  const settings = school.settings || {};
  const billing = {
    ...(settings.billing || {}),
    enforcementEnabled: !!subscription.enforcementEnabled,
    subscriptionId: subscription.id,
    billingCycle: subscription.billingCycle,
    billingState,
    nextDueDate: subscription.nextDueDate || subscription.endDate || null,
    graceEndsAt: subscription.graceEndsAt || null,
    periodKey: subscription.periodKey || null,
    academicPeriod: subscription.academicPeriod || {},
    planCode: subscription.planCode,
    planName: subscription.planName,
    lastEvaluatedAt: new Date().toISOString()
  };
  return { ...settings, billing };
}
async function syncSchoolState(subscription, schoolInput = null, options = {}) {
  const transaction=options.transaction;
  if (!subscription || subscription.ownerType !== 'school') return null;
  const school = schoolInput || await School.findOne({ where:{ schoolId:subscription.schoolCode },transaction,lock:transaction?transaction.LOCK.UPDATE:undefined });
  if (!school) return null;
  const billingState = stateFor(subscription);
  const restricted = billingState === 'restricted';
  const update = {
    settings: schoolBillingPatch(school, subscription, billingState),
    subscriptionPlan: subscription.planCode || school.subscriptionPlan,
    subscriptionStatus: restricted ? 'expired' : (subscription.status === 'active' ? 'active' : 'pending'),
    subscriptionStartedAt: subscription.startDate || school.subscriptionStartedAt || null,
    subscriptionEndsAt: subscription.endDate || subscription.nextDueDate || school.subscriptionEndsAt || null,
    accessMode: restricted ? 'expired_subscription' : (subscription.status === 'active' ? 'paid_subscription' : 'subscription_grace'),
    accessStatus: restricted ? 'locked' : 'active'
  };
  await school.update(update, { hooks:false,transaction });
  if (subscription.billingState !== billingState) {
    const patch = { billingState };
    if (billingState === 'restricted' && !subscription.overdueSince) patch.overdueSince = new Date();
    await subscription.update(patch, { hooks:false,transaction });
  }
  return { school, billingState };
}
async function configurePending(subscription, school, cycleInput) {
  const cycle = normalizeCycle(cycleInput);
  // Selecting a cadence is a real payment commitment. The first payment is due now,
  // while academic dates are still validated and stored for termly/yearly renewals.
  let academicPeriod = {};
  if (cycle !== 'monthly') {
    const period = await resolvePeriod(school, cycle, new Date(), 7);
    academicPeriod = period.academicPeriod;
  }
  const due = new Date();
  const grace = addDays(due, 7);
  await subscription.update({
    billingCycle:cycle,
    status:'pending',
    enforcementEnabled:true,
    billingAnchorDate:due,
    nextDueDate:due,
    graceEndsAt:grace,
    billingState:'payment_required',
    periodKey:`initial:${cycle}:${isoDay(due)}`,
    academicPeriod,
    reminderState:{},
    overdueSince:null
  });
  await syncSchoolState(subscription, school);
  return subscription;
}
async function activatePaid(subscription, school, plan, cycleInput, paymentId, options = {}) {
  const transaction=options.transaction;
  const cycle = normalizeCycle(cycleInput || subscription.billingCycle);
  const oldEnd = date(subscription.endDate);
  const anchor = oldEnd && oldEnd > new Date() ? addDays(oldEnd, 1) : new Date();
  const period = await resolvePeriod(school, cycle, anchor, 7);
  const trail = Array.isArray(subscription.auditTrail) ? subscription.auditTrail : [];
  trail.push({ action:'renewed_and_enforced', paymentId, planCode:plan.code || plan.name, cycle, periodKey:period.periodKey, at:new Date().toISOString() });
  await subscription.update({
    planId:plan.id,
    planCode:plan.code || plan.name,
    planName:plan.displayName || plan.name,
    billingCycle:cycle,
    status:'active',
    startDate:period.startDate,
    endDate:period.endDate,
    lastPaymentId:paymentId,
    features:plan.features || [],
    limits:plan.limits || {},
    enforcementEnabled:true,
    billingAnchorDate:period.startDate,
    nextDueDate:period.dueDate,
    graceEndsAt:period.graceEndsAt,
    billingState:'active',
    periodKey:period.periodKey,
    academicPeriod:period.academicPeriod,
    reminderState:{},
    lastReminderAt:null,
    overdueSince:null,
    auditTrail:trail
  },{transaction});
  await syncSchoolState(subscription, school,{transaction});
  return subscription;
}
function reminderStages(subscription, nowInput = new Date()) {
  const now = date(nowInput) || new Date();
  const due = date(subscription.nextDueDate || subscription.endDate);
  const grace = date(subscription.graceEndsAt || due);
  if (!subscription.enforcementEnabled || !due) return [];
  const stages = [];
  const daysToDue = Math.ceil((due - now) / DAY);
  const cycle = normalizeCycle(subscription.billingCycle);
  if (daysToDue <= 14 && daysToDue > 7 && cycle !== 'monthly') stages.push('due_14_days');
  if (daysToDue <= 7 && daysToDue > 3) stages.push('due_7_days');
  if (daysToDue <= 3 && daysToDue > 0) stages.push('due_3_days');
  if (isoDay(now) === isoDay(due)) stages.push(cycle === 'termly' ? 'term_ended_payment_due' : cycle === 'yearly' ? 'academic_year_ended_payment_due' : 'payment_due_today');

  const nextStart = date(subscription.academicPeriod?.nextStartDate);
  if (nextStart) {
    const daysToStart = Math.ceil((nextStart - now) / DAY);
    if (daysToStart <= 7 && daysToStart > 3) stages.push(cycle === 'termly' ? 'next_term_7_days' : 'next_academic_year_7_days');
    if (daysToStart <= 3 && daysToStart > 0) stages.push(cycle === 'termly' ? 'next_term_3_days' : 'next_academic_year_3_days');
    if (isoDay(now) === isoDay(nextStart)) stages.push(cycle === 'termly' ? 'new_term_started' : 'new_academic_year_started');
  }
  if (now > due && (!grace || now <= grace)) stages.push(`grace_reminder:${isoDay(now)}`);
  if (grace && now > grace) stages.push(`overdue_daily:${isoDay(now)}`);
  return [...new Set(stages)];
}
function reminderCopy(subscription, stage) {
  const plan = subscription.planName || subscription.planCode || 'Shule AI';
  const cycle = normalizeCycle(subscription.billingCycle);
  const due = date(subscription.nextDueDate || subscription.endDate);
  const dueText = due ? due.toLocaleDateString('en-KE', { year:'numeric', month:'short', day:'numeric' }) : 'now';
  if (stage.startsWith('overdue_daily')) return { severity:'critical', title:'Subscription payment overdue', message:`Your ${plan} ${cycle} subscription is overdue. Pay now to restore full school access. Your school data remains safe.` };
  if (stage.startsWith('grace_reminder')) return { severity:'warning', title:'Subscription payment still required', message:`Your ${plan} ${cycle} payment was due on ${dueText}. Please pay before the grace period ends to avoid restricted access.` };
  if (stage === 'new_term_started') return { severity:'warning', title:'New term has started — subscription payment required', message:`The new term has started and the ${plan} termly subscription is still unpaid. Please complete payment now.` };
  if (stage === 'new_academic_year_started') return { severity:'warning', title:'New academic year has started — payment required', message:`The new academic year has started and the ${plan} yearly subscription is still unpaid. Please complete payment now.` };
  if (stage.includes('ended_payment_due') || stage === 'payment_due_today') return { severity:'warning', title:'Subscription payment is due today', message:`The ${plan} ${cycle} subscription payment is due today (${dueText}).` };
  if (stage.includes('next_term')) return { severity:'warning', title:'Next term subscription reminder', message:`The next term is approaching. The ${plan} termly subscription payment remains due.` };
  if (stage.includes('next_academic_year')) return { severity:'warning', title:'Next academic year subscription reminder', message:`The next academic year is approaching. The ${plan} yearly subscription payment remains due.` };
  const days = stage.match(/(14|7|3)/)?.[1] || '';
  return { severity:'info', title:'Upcoming Shule AI subscription payment', message:`Your ${plan} ${cycle} payment is due ${days ? `in ${days} days` : `on ${dueText}`}.` };
}
async function processSubscription(subscription) {
  if (!subscription?.enforcementEnabled || subscription.ownerType !== 'school') return { sent:0, state:'not_enforced' };
  const school = await School.findOne({ where:{ schoolId:subscription.schoolCode } });
  if (!school) return { sent:0, state:'school_missing' };
  const state = stateFor(subscription);
  const stages = reminderStages(subscription);
  const admins = await User.findAll({ where:{ schoolCode:subscription.schoolCode, role:'admin', isActive:true }, attributes:['id','role'] });
  let sent = 0;
  for (const stage of stages) {
    const copy = reminderCopy(subscription, stage);
    for (const admin of admins) {
      const alert = await createAlert({
        userId:admin.id,
        role:'admin',
        type:'fee',
        severity:copy.severity,
        title:copy.title,
        message:copy.message,
        categoryLabel:'Subscription & Billing',
        sourceType:'school_subscription_enforcement',
        sourceLabel:'Shule AI Subscription Billing',
        actionUrl:'#subscription-billing',
        actionLabel:'Pay subscription',
        dedupeKey:`school-subscription:${subscription.id}:${subscription.periodKey || 'period'}:${stage}:${admin.id}`,
        data:{ schoolCode:subscription.schoolCode, subscriptionId:subscription.id, billingCycle:subscription.billingCycle, billingState:state, dueDate:subscription.nextDueDate, graceEndsAt:subscription.graceEndsAt, periodKey:subscription.periodKey, stage }
      });
      if (alert) sent += 1;
    }
  }
  const reminderState = { ...(subscription.reminderState || {}) };
  for (const stage of stages) reminderState[stage] = new Date().toISOString();
  await subscription.update({ billingState:state, reminderState, lastReminderAt:stages.length ? new Date() : subscription.lastReminderAt, ...(state === 'restricted' && !subscription.overdueSince ? { overdueSince:new Date(), status:'expired' } : {}) }, { hooks:false });
  await syncSchoolState(subscription, school);
  return { sent, state, stages };
}
async function processAllSchools() {
  const rows = await Subscription.findAll({
    where:{ ownerType:'school', enforcementEnabled:true, status:{ [Op.in]:['active','pending','expired','paused'] } },
    include:[{ model:SubscriptionPlan, required:false }],
    order:[['updatedAt','ASC']]
  });
  const results = [];
  for (const row of rows) {
    try { results.push({ id:row.id, ...(await processSubscription(row)) }); }
    catch (error) { results.push({ id:row.id, error:error.message }); }
  }
  return results;
}
async function getSummary(subscription, school = null) {
  if (!subscription) return { enforcementEnabled:false, billingState:'not_configured' };
  if (subscription.ownerType === 'school') await syncSchoolState(subscription, school).catch(() => null);
  return {
    enforcementEnabled:!!subscription.enforcementEnabled,
    billingState:stateFor(subscription),
    billingCycle:normalizeCycle(subscription.billingCycle),
    nextDueDate:subscription.nextDueDate || subscription.endDate || null,
    graceEndsAt:subscription.graceEndsAt || null,
    periodKey:subscription.periodKey || null,
    academicPeriod:subscription.academicPeriod || {},
    lastReminderAt:subscription.lastReminderAt || null,
    overdueSince:subscription.overdueSince || null,
    restricted:stateFor(subscription) === 'restricted'
  };
}

module.exports = {
  normalizeCycle,
  requireBillingCycle,
  resolvePeriod,
  configurePending,
  activatePaid,
  stateFor,
  syncSchoolState,
  processSubscription,
  processAllSchools,
  getSummary,
  reminderStages
};
