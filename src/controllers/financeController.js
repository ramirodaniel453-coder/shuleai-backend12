const { Op } = require('sequelize');
const { Fee, Payment, Student, User, Class, FinanceExpense, AuditLog } = require('../models');
const { getAlertsForUser } = require('../services/alertReceiverEngine');
const { createAlert } = require('../services/notificationService');
const realtime = require('../services/realtimeService');

const FULL_FINANCE = ['overview','fee_structures','invoices','payments','verification','balances','defaulters','receipts','bursaries','expenses','reconciliation','analytics','reports','settings','alerts','audit'];
const BURSAR = ['overview','fee_structures','invoices','payments','verification','balances','defaulters','receipts','bursaries','reports','alerts'];
const ACCOUNTANT = ['overview','payments','verification','expenses','reconciliation','analytics','reports','audit'];

const schoolCodeOf = (req) => String(req.user?.schoolCode || '');
function financeTitle(user) { return String(user?.financeTitle || user?.preferences?.finance?.title || 'Finance Officer').trim(); }
function defaultPermissions(user) { const t = financeTitle(user).toLowerCase(); if (t === 'bursar') return BURSAR; if (t === 'accountant') return ACCOUNTANT; return FULL_FINANCE; }
function effectivePermissions(user) { const custom = user?.financePermissions || user?.preferences?.finance?.permissions; return Array.isArray(custom) && custom.length ? [...new Set(custom)] : defaultPermissions(user); }
function completedPayment(payment) { return ['completed','successful','approved','paid','success'].includes(String(payment?.status || '').toLowerCase()); }
function financeFilters(query = {}) {
  const rawYear = String(query.year ?? '').trim();
  const rawTerm = String(query.term ?? '').trim();
  let year; let term;
  if (rawYear) { year = Number(rawYear); if (!Number.isInteger(year) || year < 2000 || year > 2100) { const e = new Error('Invalid finance year.'); e.status = 400; throw e; } }
  if (rawTerm) { if (!['Term 1','Term 2','Term 3'].includes(rawTerm)) { const e = new Error('Invalid finance term. Use Term 1, Term 2, or Term 3.'); e.status = 400; throw e; } term = rawTerm; }
  return { year, term };
}
function feeMoney(fee) {
  const total = Number(fee.totalAmount || 0);
  const paid = Number(fee.parentPaidAmount ?? fee.paidAmount ?? 0);
  const credit = Number(fee.creditAmount || 0);
  const balance = Math.max(0, total - paid - credit);
  return { total, paid, credit, balance, status: balance <= 0 ? 'paid' : paid > 0 ? 'part_paid' : 'issued' };
}
function financeAlertOnly(alert) {
  const row = alert?.toJSON ? alert.toJSON() : alert || {};
  const haystack = [row.type,row.categoryLabel,row.sourceType,row.sourceLabel,row.title,row.message,row.data?.category].join(' ').toLowerCase();
  return /fee|payment|finance|invoice|receipt|bursar|bursary|credit|defaulter|expense|reconcil|mpesa|m-pesa|balance/.test(haystack) || row.targetRole === 'finance_officer';
}
async function audit(req, action, entityType, entityId, changes = {}) {
  await AuditLog.create({
    schoolCode: schoolCodeOf(req), actorUserId: req.user.id, actorRole: req.user.role,
    module: 'finance', action, entityType, entityId: String(entityId || ''),
    before: changes.before || null, after: changes.after || null,
    metadata: { ...changes, before: undefined, after: undefined },
    ipAddress: req.ip, userAgent: req.get?.('user-agent') || null
  }).catch(() => null);
}
function requirePermission(permission) {
  return (req, res, next) => {
    try {
      if (req.user?.role === 'super_admin') return next();
      if (req.user?.role === 'admin' && ['overview','team'].includes(permission)) return next();
      if (req.user?.role === 'admin') return res.status(403).json({ success:false, code:'ADMIN_FINANCE_OVERVIEW_ONLY', message:'School Admin has Finance Overview and Finance Team only. Assign Finance Officer/Bursar/Accountant for operations.' });
      if (req.user?.role !== 'finance_officer') return res.status(403).json({ success:false, message:'Finance staff access required.' });
      const allowed = effectivePermissions(req.user);
      if (!allowed.includes(permission)) return res.status(403).json({ success:false, code:'FINANCE_PERMISSION_REQUIRED', message:`Finance permission required: ${permission}` });
      return next();
    } catch (error) { return next(error); }
  };
}
exports.requirePermission = requirePermission;

exports.getModules = async (req, res) => {
  try {
    const permissions = req.user.role === 'admin' ? ['overview','team'] : effectivePermissions(req.user);
    const modules = [
      ['overview','Overview'], ['fee_structures','Fee Structures'], ['invoices','Student Fee Accounts & Invoices'],
      ['payments','Payments & Receipts'], ['verification','Verification & Reconciliation'], ['balances','Balances, Defaulters & Bursaries'],
      ['expenses','Expenses'], ['alerts','Alerts'], ['analytics','Analytics'], ['reports','Reports'], ['settings','Settings'], ['audit','Audit Trail']
    ].map(([key,label]) => ({ key, label, visible: permissions.includes(key) || key === 'overview' }));
    res.json({ success:true, data:{ title: financeTitle(req.user), permissions, modules, fallbackOwner: financeTitle(req.user) === 'Finance Officer', lockedLogic:'one-permission-based-finance-workspace' } });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getOverview = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req);
    const { year, term } = financeFilters(req.query);
    const fees = await Fee.findAll({
      where: { schoolCode, ...(year ? { year } : {}), ...(term ? { term } : {}) },
      include: [{ model:Student, required:false, include:[{ model:User, required:false, attributes:['id','name','profileImage','profilePicture'] }, { model:Class, required:false, attributes:['id','name','stream'] }] }],
      order: [['updatedAt','DESC']]
    });
    let expected = 0, paid = 0, credits = 0, outstanding = 0;
    const defaulters = [];
    for (const fee of fees) {
      const m = feeMoney(fee); expected += m.total; paid += m.paid; credits += m.credit; outstanding += m.balance;
      if (m.balance > 0) defaulters.push({ feeId:fee.id, studentId:fee.studentId, studentName:fee.Student?.User?.name || `Student ${fee.studentId}`, profileImage:fee.Student?.User?.profileImage || fee.Student?.User?.profilePicture || null, elimuid:fee.Student?.elimuid || null, classId:fee.Student?.classId || null, className:fee.Student?.Class?.name || fee.Student?.grade || 'Unassigned', term:fee.term, year:fee.year, totalAmount:m.total, parentPaidAmount:m.paid, creditAmount:m.credit, balance:m.balance, status:fee.status || m.status });
    }
    const payments = await Payment.findAll({ where:{ schoolCode }, order:[['createdAt','DESC']], limit:200 }).catch(() => []);
    const pendingVerification = payments.filter(p => String(p.status || '').toLowerCase() === 'pending' && ['school_fee','fee','fees'].includes(String(p.paymentType || '').toLowerCase())).length;
    const ok = payments.filter(completedPayment);
    const now = new Date(); const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const week = new Date(day); week.setDate(week.getDate() - ((week.getDay() + 6) % 7)); const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const sumSince = (d) => ok.filter(p => new Date(p.paymentDate || p.transactionDate || p.createdAt) >= d).reduce((a,p) => a + Number(p.amount || 0), 0);
    const expenses = await FinanceExpense.findAll({ where:{ schoolCode, status:{ [Op.notIn]:['rejected','void'] } }, order:[['expenseDate','DESC'],['id','DESC']], limit:500 }).catch(() => []);
    const totalExpenses = expenses.reduce((a,x) => a + Number(x.amount || 0), 0);
    res.json({ success:true, data:{ schoolCode, filters:{ year:year || null, term:term || null }, totals:{ expected, paid, credits, outstanding, collectionPercentage:expected ? Math.round((paid / expected) * 10000) / 100 : 0, defaulterCount:defaulters.length, pendingVerification, totalExpenses, netCollected:paid - totalExpenses, todayCollections:sumSince(day), weekCollections:sumSince(week), monthCollections:sumSince(month) }, defaulters:defaulters.sort((a,b) => b.balance - a.balance), recentPayments:payments.slice(0,20).map(p => ({ id:p.id, studentId:p.studentId, amount:Number(p.amount || 0), status:p.status, method:p.method || p.paymentGateway, reference:p.reference || p.mpesaReceiptNumber, paymentDate:p.paymentDate || p.transactionDate || p.createdAt, payerPhone:p.payerPhone })), recentExpenses:expenses.slice(0,20), permissions:effectivePermissions(req.user), financeTitle:financeTitle(req.user) } });
  } catch (error) { res.status(error.status || 500).json({ success:false, message:error.message }); }
};

exports.listInvoices = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req); const { year, term } = financeFilters(req.query);
    const where = { schoolCode, ...(year ? { year } : {}), ...(term ? { term } : {}) };
    if (req.query.studentId) where.studentId = Number(req.query.studentId);
    const rows = await Fee.findAll({ where, include:[{ model:Student, required:false, include:[{ model:User, required:false, attributes:['id','name','profileImage'] }, { model:Class, required:false, attributes:['id','name','stream'] }] }], order:[['year','DESC'],['term','ASC'],['updatedAt','DESC']], limit:Math.min(Number(req.query.limit || 500), 1000) });
    const invoices = rows.map(f => { const m = feeMoney(f); return { id:f.id, invoiceNo:f.invoiceNumber || f.reference || `INV-${String(f.id).padStart(6,'0')}`, studentId:f.studentId, studentName:f.Student?.User?.name || `Student ${f.studentId}`, elimuid:f.Student?.elimuid || null, classId:f.Student?.classId || null, className:f.Student?.Class?.name || f.Student?.grade || 'Unassigned', term:f.term, year:f.year, totalAmount:m.total, parentPaidAmount:m.paid, creditAmount:m.credit, balance:m.balance, status:f.status || m.status, issuedAt:f.createdAt, updatedAt:f.updatedAt, immutable:m.paid > 0 || m.credit > 0 }; });
    res.json({ success:true, data:{ invoices } });
  } catch (error) { res.status(error.status || 500).json({ success:false, message:error.message }); }
};

exports.getAlerts = async (req, res) => {
  try { res.json({ success:true, data:(await getAlertsForUser(req.user, { limit:Number(req.query.limit || 200) })).filter(financeAlertOnly) }); }
  catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listExpenses = async (req, res) => {
  try {
    const where = { schoolCode:schoolCodeOf(req) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.from || req.query.to) { where.expenseDate = {}; if (req.query.from) where.expenseDate[Op.gte] = req.query.from; if (req.query.to) where.expenseDate[Op.lte] = req.query.to; }
    res.json({ success:true, data:await FinanceExpense.findAll({ where, order:[['expenseDate','DESC'],['id','DESC']], limit:Math.min(Number(req.query.limit || 300), 1000) }) });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.createExpense = async (req, res) => {
  try {
    const amount = Number(req.body.amount || 0); const description = String(req.body.description || '').trim(); const category = String(req.body.category || 'Other').trim();
    if (!description) return res.status(400).json({ success:false, message:'Expense description is required.' });
    if (!(amount > 0)) return res.status(400).json({ success:false, message:'Expense amount must be greater than zero.' });
    const row = await FinanceExpense.create({ schoolCode:schoolCodeOf(req), category, description, amount, paymentMethod:req.body.paymentMethod || null, payee:req.body.payee || null, expenseDate:req.body.expenseDate || new Date().toISOString().slice(0,10), reference:req.body.reference || null, receiptUrl:req.body.receiptUrl || null, status:req.body.status || 'recorded', recordedBy:req.user.id, notes:req.body.notes || null, metadata:{ source:'finance_workspace' } });
    await audit(req, 'finance_expense_created', 'FinanceExpense', row.id, { after:row.toJSON() });
    const admins = await User.findAll({ where:{ schoolCode:schoolCodeOf(req), role:'admin', isActive:true }, attributes:['id'] }).catch(() => []);
    for (const a of admins) await createAlert({ userId:a.id, role:'admin', type:'fee', severity:'info', title:'School expense recorded', message:`${category}: KES ${amount.toLocaleString()} — ${description}`, categoryLabel:'Finance', sourceType:'finance_expense', sourceLabel:'Finance Office', dedupeKey:`finance-expense:${row.id}:${a.id}`, data:{ schoolCode:schoolCodeOf(req), expenseId:row.id, amount, category } }).catch(() => null);
    await realtime.emitToSchool(schoolCodeOf(req), 'finance:expense_created', { expense:row }, { entityType:'FinanceExpense', entityId:row.id, version:Number(row.updatedAt?.getTime?.() || Date.now()) }).catch(() => null);
    res.status(201).json({ success:true, message:'Expense recorded.', data:row });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.updateExpense = async (req, res) => {
  try {
    const row = await FinanceExpense.findOne({ where:{ id:Number(req.params.id), schoolCode:schoolCodeOf(req) } });
    if (!row) return res.status(404).json({ success:false, message:'Expense not found.' });
    const patch = {}; for (const k of ['category','description','paymentMethod','payee','expenseDate','reference','receiptUrl','status','notes']) if (req.body[k] !== undefined) patch[k] = req.body[k];
    if (req.body.amount !== undefined) { const amount = Number(req.body.amount); if (!(amount > 0)) return res.status(400).json({ success:false, message:'Expense amount must be greater than zero.' }); patch.amount = amount; }
    if (req.body.status === 'approved') { patch.approvedBy = req.user.id; patch.approvedAt = new Date(); }
    const before = row.toJSON(); await row.update(patch);
    await audit(req, 'finance_expense_updated', 'FinanceExpense', row.id, { before, after:row.toJSON() });
    await realtime.emitToSchool(schoolCodeOf(req), 'finance:expense_updated', { expense:row }, { entityType:'FinanceExpense', entityId:row.id, version:Number(row.updatedAt?.getTime?.() || Date.now()) }).catch(() => null);
    res.json({ success:true, message:'Expense updated.', data:row });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.deleteExpense = async (req, res) => {
  try {
    const row = await FinanceExpense.findOne({ where:{ id:Number(req.params.id), schoolCode:schoolCodeOf(req) } });
    if (!row) return res.status(404).json({ success:false, message:'Expense not found.' });
    const before = row.toJSON(); await row.update({ status:'void', notes:[row.notes, `Voided by user ${req.user.id} on ${new Date().toISOString()}`].filter(Boolean).join('\n') });
    await audit(req, 'finance_expense_voided', 'FinanceExpense', row.id, { before, after:row.toJSON() });
    res.json({ success:true, message:'Expense voided.' });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getAnalytics = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req); const { year, term } = financeFilters(req.query);
    const fees = await Fee.findAll({ where:{ schoolCode, ...(year ? { year } : {}), ...(term ? { term } : {}) }, include:[{ model:Student, required:false, include:[{ model:Class, required:false, attributes:['id','name','stream'] }] }] });
    const expenses = await FinanceExpense.findAll({ where:{ schoolCode, status:{ [Op.notIn]:['rejected','void'] } }, order:[['expenseDate','ASC']] }).catch(() => []);
    const byClass = {}; const byMethod = {}; const expenseByCategory = {}; const trend = {};
    let expected = 0, paid = 0, credits = 0, outstanding = 0;
    for (const fee of fees) { const m = feeMoney(fee); const cls = fee.Student?.Class?.name || fee.Student?.grade || 'Unassigned'; expected += m.total; paid += m.paid; credits += m.credit; outstanding += m.balance; byClass[cls] = byClass[cls] || { className:cls, expected:0, paid:0, credits:0, outstanding:0, count:0 }; byClass[cls].expected += m.total; byClass[cls].paid += m.paid; byClass[cls].credits += m.credit; byClass[cls].outstanding += m.balance; byClass[cls].count += 1; }
    const payments = await Payment.findAll({ where:{ schoolCode }, limit:1000, order:[['createdAt','DESC']] }).catch(() => []);
    for (const p of payments) { const method = p.method || p.paymentGateway || 'manual'; byMethod[method] = (byMethod[method] || 0) + Number(p.amount || 0); const d = String(p.paymentDate || p.transactionDate || p.createdAt || '').slice(0,10); if (d) trend[d] = (trend[d] || 0) + Number(p.amount || 0); }
    for (const e of expenses) expenseByCategory[e.category || 'Other'] = (expenseByCategory[e.category || 'Other'] || 0) + Number(e.amount || 0);
    const totalExpenses = expenses.reduce((a,x) => a + Number(x.amount || 0), 0);
    res.json({ success:true, data:{ summary:{ expected, paid, credits, outstanding, totalExpenses, netPosition:paid - totalExpenses, collectionRate:expected ? Math.round((paid / expected) * 10000) / 100 : 0 }, classCollection:Object.values(byClass), paymentMethodSplit:byMethod, expenseBreakdown:expenseByCategory, cashflowTrend:Object.entries(trend).map(([date, amount]) => ({ date, amount })).sort((a,b) => a.date.localeCompare(b.date)) } });
  } catch (error) { res.status(error.status || 500).json({ success:false, message:error.message }); }
};

exports.getReport = async (req, res) => {
  try {
    const holder = { statusCode:200, payload:null, status(code){ this.statusCode = code; return this; }, json(payload){ this.payload = payload; return payload; } };
    await exports.getOverview(req, holder);
    if (!holder.payload?.success) return res.status(holder.statusCode || 500).json(holder.payload || { success:false, message:'Report could not be generated.' });
    res.json({ success:true, data:{ generatedAt:new Date().toISOString(), schoolCode:schoolCodeOf(req), summary:holder.payload.data.totals, defaulters:holder.payload.data.defaulters, recentPayments:holder.payload.data.recentPayments, expenses:await FinanceExpense.findAll({ where:{ schoolCode:schoolCodeOf(req) }, order:[['expenseDate','DESC']] }) } });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getAuditTrail = async (req, res) => {
  try {
    const rows = await AuditLog.findAll({ where:{ schoolCode:schoolCodeOf(req), module:{ [Op.in]:['finance','fees','payments'] } }, order:[['createdAt','DESC']], limit:Math.min(Number(req.query.limit || 200), 500) }).catch(() => []);
    res.json({ success:true, data:rows });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};
