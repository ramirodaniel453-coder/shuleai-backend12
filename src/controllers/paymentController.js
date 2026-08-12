const { Op } = require('sequelize');
const {
  Payment,
  Fee,
  Parent,
  Student,
  User,
  School,
  AuditLog,
  SubscriptionPlan,
  SubscriptionPayment,
  Subscription,
  Class,
  sequelize
} = require('../models');
const subscriptionController = require('./subscriptionController');
const financeLedger = require('../services/financeLedgerService');
const paymentEngine = require('../services/paymentProviderEngine');
const { transactionId } = require('../utils/businessIds');

const MANUAL_PAYMENT_METHODS = new Set(['cash', 'bank', 'card', 'manual_mpesa', 'admin_adjustment']);
const CREDIT_METHODS = new Set(['bursary', 'scholarship', 'waiver', 'discount', 'adjustment']);

function allowlistedMethod(value, allowed, fallback) {
  const method = String(value || fallback).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!allowed.has(method)) {
    const error = new Error(`Unsupported manual finance method: ${method}`);
    error.statusCode = 400;
    throw error;
  }
  return method;
}

function manualSchoolVerificationWhere(schoolCode, extra = {}) {
  return {
    ...extra,
    schoolCode,
    paymentType: { [Op.in]: ['fee', 'school_fee'] },
    paidTo: 'school',
    status: { [Op.in]: ['pending', 'pending_verification'] },
    [Op.or]: [
      { promptType: 'manual_instructions' },
      { paymentGateway: { [Op.in]: [...MANUAL_PAYMENT_METHODS, ...CREDIT_METHODS, 'manual'] } }
    ]
  };
}

function getSchoolCode(req) {
  if (req.user?.role === 'super_admin') return req.body?.schoolCode || req.query?.schoolCode || req.user?.schoolCode || null;
  return req.user?.schoolCode || null;
}

function auditEntry(action, actor, extra = {}) {
  return { action, actorUserId: actor?.id || null, actorRole: actor?.role || null, at: new Date().toISOString(), ...extra };
}

async function writeAudit(req, data) {
  try {
    await AuditLog?.create({
      schoolCode: getSchoolCode(req) || data.schoolCode || 'platform',
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent'),
      ...data
    });
  } catch (error) {
    console.error('Payment audit failed:', error.message);
  }
}

function errorJson(res, error, fallback = 400) {
  return res.status(error.statusCode || fallback).json({ success: false, message: error.message, data: error.data || undefined });
}

function providerBodyFromLegacyRequest(req, fallbackProvider = 'manual') {
  const body = req.body || {};
  const config = { ...(body.config || {}) };
  for (const key of ['publicKey','secretKey','consumerKey','consumerSecret','passkey','shortcode','businessShortcode','webhookSecret','callbackUrl','returnUrl','successUrl','cancelUrl','environment','ipnId','notificationId','bankName','accountName','accountNumber','branch','manualInstructions']) {
    if (body[key] !== undefined && config[key] === undefined) config[key] = body[key];
  }
  let provider = body.provider || body.activeProvider || body.defaultProvider;
  if (!provider) {
    const mode = String(body.paymentMode || body.mode || '').toLowerCase();
    if (['daraja','mpesa','stk','m-pesa'].includes(mode) || body.darajaEnabled === true) provider = 'mpesa';
    else if (['paystack','flutterwave','pesapal','stripe','bank','cash','card','manual'].includes(mode)) provider = mode;
    else provider = fallbackProvider;
  }
  return {
    ...body,
    provider,
    enabled: body.enabled !== undefined ? body.enabled === true : body.active !== false,
    isDefault: true,
    active: body.active !== false,
    methods: body.methods || body.enabledMethods || body.paymentMethods || body.config?.methods,
    linkingRule: body.linkingRule || body.studentLinkRule || body.accountReferenceFormat || body.referenceFormat,
    config
  };
}

function legacySchoolSettingsPayload(data, school = null) {
  const visibleMethods = (data.publicMethods || []).length ? data.publicMethods : (data.methods || []);
  return {
    ...data,
    schoolName: school?.name || data.schoolName || null,
    schoolCode: data.schoolCode || school?.schoolId || null,
    paymentSettings: {
      activeProvider: data.activeProvider,
      defaultProvider: data.defaultProvider,
      enabledProviders: data.enabledProviders,
      disabledProviders: data.disabledProviders,
      providerSelectionRule: data.providerSelectionRule,
      providers: data.providers,
      methods: visibleMethods,
      publicMethods: data.publicMethods || [],
      linkingRule: data.linkingRule,
      matchingRules: data.matchingRules,
      notifications: data.notifications,
      paymentMode: data.paymentMode,
      accountReferenceFormat: data.linkingRule,
      active: !!data.activeProvider,
      currency: 'KES'
    }
  };
}

exports.getAdminPaymentSettings = async (req, res) => {
  try {
    const code = getSchoolCode(req);
    const [data, school] = await Promise.all([
      paymentEngine.getSettings({ scope: 'school', schoolCode: code }),
      School.findOne({ where: { schoolId: code } }).catch(() => null)
    ]);
    res.json({ success: true, data: legacySchoolSettingsPayload(data, school) });
  } catch (error) { errorJson(res, error); }
};

exports.updateAdminPaymentSettings = async (req, res) => {
  try {
    const data = await paymentEngine.saveSchoolProviderSettings({ user: req.user, schoolCode: getSchoolCode(req), body: providerBodyFromLegacyRequest(req, 'manual') });
    await writeAudit(req, { module: 'payments', action: 'school_payment_provider_saved_exclusive', entityType: 'SchoolPaymentSetting', entityId: String(data.id || 'school-provider'), after: data });
    res.json({ success: true, message: 'School payment provider saved. Only the selected active provider can receive school fees.', data: legacySchoolSettingsPayload(data) });
  } catch (error) { errorJson(res, error); }
};

exports.testAdminPaymentConnection = async (req, res) => {
  try {
    const result = await paymentEngine.testProviderConnection({ scope: 'school', schoolCode: getSchoolCode(req), user: req.user });
    res.json({ success: true, message: result.message, data: result });
  } catch (error) { errorJson(res, error); }
};

exports.getPlatformPaymentSettings = async (req, res) => {
  try {
    const data = await paymentEngine.getSettings({ scope: 'platform' });
    res.json({ success: true, data });
  } catch (error) { errorJson(res, error); }
};

exports.updatePlatformPaymentSettings = async (req, res) => {
  try {
    const data = await paymentEngine.savePlatformProviderSettings({ user: req.user, body: providerBodyFromLegacyRequest(req, 'manual') });
    await writeAudit(req, { schoolCode: 'platform', module: 'payments', action: 'platform_payment_provider_saved_exclusive', entityType: 'PlatformPaymentSetting', entityId: String(data.id || 'platform-provider'), after: data });
    res.json({ success: true, message: 'Platform payment provider saved. Only the selected active provider can receive platform payments.', data });
  } catch (error) { errorJson(res, error); }
};


exports.testPlatformPaymentConnection = async (req, res) => {
  try {
    const result = await paymentEngine.testProviderConnection({ scope: 'platform', user: req.user });
    res.json({ success: true, message: result.message, data: result });
  } catch (error) { errorJson(res, error); }
};

exports.getParentSchoolPaymentSettings = async (req, res) => {
  try {
    const data = await paymentEngine.getSettings({ scope: 'school', schoolCode: getSchoolCode(req) });
    const publicMethods = data.publicMethods || [];
    res.json({ success: true, data: {
      activeProvider: data.activeProvider,
      defaultProvider: data.defaultProvider,
      enabledProviders: data.enabledProviders,
      paymentMode: data.paymentMode,
      referenceFormat: data.linkingRule,
      linkingRule: data.linkingRule,
      matchingRules: data.matchingRules,
      methods: publicMethods,
      publicMethods,
      supports: {
        stk: publicMethods.some(m => m.prompt === 'phone_prompt'),
        checkout: publicMethods.some(m => ['checkout_url', 'hosted_checkout'].includes(m.prompt)),
        manual: publicMethods.some(m => m.prompt === 'manual_instructions'),
        bank: publicMethods.some(m => m.method === 'bank'),
        cash: publicMethods.some(m => m.method === 'cash'),
        card: publicMethods.some(m => m.method === 'card'),
        mobileMoney: publicMethods.some(m => m.method === 'mobile_money')
      }
    }});
  } catch (error) { errorJson(res, error); }
};

exports.queryStatus = async (req, res) => {
  try {
    const key = String(req.params.checkoutRequestId || req.query.reference || '').trim();
    if (!key) return res.status(400).json({ success: false, message: 'Payment reference is required' });
    const data = await paymentEngine.getPaymentStatus({ reference: key, user: req.user, anyReference: true });
    res.json({ success: true, data });
  } catch (error) { errorJson(res, error, 500); }
};


// ============================================================================
// V75 FINAL FINANCE LEDGER OVERRIDES
// Student-specific payment history, all payment methods, bursaries/credits,
// admin manual recording, and no mixed sibling/classmate finance records.
// ============================================================================

exports.getParentStudentFeeAccounts = async (req, res) => {
  try {
    const data = await financeLedger.getStudentFinance({
      schoolCode: req.user.schoolCode,
      studentId: req.params.studentId,
      parentUserId: req.user.id
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(403).json({ success: false, message: error.message });
  }
};

exports.getParentStudentPaymentHistory = async (req, res) => {
  try {
    const data = await financeLedger.getStudentHistory({
      schoolCode: req.user.schoolCode,
      studentId: req.params.studentId,
      parentUserId: req.user.id,
      status: req.query.status || 'all',
      transactionType: req.query.transactionType || req.query.type || 'all',
      method: req.query.method || 'all',
      feeId: req.query.feeId || null
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(403).json({ success: false, message: error.message });
  }
};

exports.getAdminFinanceSummary = async (req, res) => {
  try {
    const data = await financeLedger.getAdminSummary({ schoolCode: req.user.schoolCode });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminStudentFinance = async (req, res) => {
  try {
    const data = await financeLedger.getStudentFinance({ schoolCode: req.user.schoolCode, studentId: req.params.studentId });
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

exports.getAdminStudentHistory = async (req, res) => {
  try {
    const data = await financeLedger.getStudentHistory({
      schoolCode: req.user.schoolCode,
      studentId: req.params.studentId,
      status: req.query.status || 'all',
      transactionType: req.query.transactionType || req.query.type || 'all',
      method: req.query.method || 'all',
      feeId: req.query.feeId || null
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

exports.recordAdminManualPayment = async (req, res) => {
  try {
    const studentId = Number(req.params.studentId || req.body.studentId);
    const status = 'pending_verification';
    const method = allowlistedMethod(req.body.method, MANUAL_PAYMENT_METHODS, 'cash');
    const payment = await financeLedger.recordTransaction({
      user: req.user,
      schoolCode: req.user.schoolCode,
      studentId,
      feeId: Number(req.body.feeId || req.body.feeAccountId),
      amount: req.body.amount,
      method,
      transactionType: 'payment',
      status,
      reference: req.body.reference || req.body.referenceNumber || req.body.receiptNumber,
      source: 'admin',
      parentId: req.body.parentId || null,
      notes: req.body.notes || null,
      processedBy: req.user.id,
      approvedBy: null,
      paymentDate: req.body.paymentDate || null,
      receiptUrl: req.body.receiptUrl || null,
      metadata: { recordedBy: req.user.id }
    });
    const finance = await financeLedger.getStudentFinance({ schoolCode: req.user.schoolCode, studentId });
    res.status(201).json({ success: true, message: 'Manual payment recorded for verification. The balance will update only after authorized approval.', data: { payment, finance } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.recordAdminBursary = async (req, res) => {
  try {
    const studentId = Number(req.params.studentId || req.body.studentId);
    const status = 'pending_verification';
    const method = allowlistedMethod(req.body.method || req.body.bursaryType, CREDIT_METHODS, 'bursary');
    const payment = await financeLedger.recordTransaction({
      user: req.user,
      schoolCode: req.user.schoolCode,
      studentId,
      feeId: Number(req.body.feeId || req.body.feeAccountId),
      amount: req.body.amount,
      method,
      transactionType: method,
      status,
      reference: req.body.reference || req.body.referenceNumber || transactionId('BURSARY'),
      source: 'admin',
      parentId: req.body.parentId || null,
      notes: req.body.notes || null,
      processedBy: req.user.id,
      approvedBy: null,
      paymentDate: req.body.paymentDate || null,
      receiptUrl: req.body.receiptUrl || null,
      metadata: { bursaryType: req.body.bursaryType, sponsor: req.body.sponsor, recordedBy: req.user.id }
    });
    const finance = await financeLedger.getStudentFinance({ schoolCode: req.user.schoolCode, studentId });
    res.status(201).json({ success: true, message: 'Bursary/credit recorded for verification. The balance will update only after authorized approval.', data: { payment, finance } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getAdminPaymentRecords = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(20, Number.parseInt(req.query.limit, 10) || 100));
    const offset = (page - 1) * limit;
    const where = { schoolCode: req.user.schoolCode, paymentType: { [Op.in]: ['fee', 'school_fee'] }, paidTo: 'school' };
    const { count, rows } = await Payment.findAndCountAll({
      where,
      attributes: ['id','studentId','parentId','feeId','amount','status','method','paymentGateway','reference','mpesaReceiptNumber','payerPhone','paymentDate','transactionDate','createdAt','notes','metadata'],
      include: [
        { model: Student, required: false, attributes: ['id','grade','classId','elimuid','admissionNumber'], include: [{ model: User, required: false, attributes: ['id','name'] }, { model: Class, required: false, attributes: ['id','name','grade','stream'] }] },
        { model: Parent, required: false, attributes: ['id'], include: [{ model: User, required: false, attributes: ['id','name','phone','email'] }] },
        { model: Fee, required: false, attributes: ['id','term','year','totalAmount','paidAmount','parentPaidAmount','creditAmount'] }
      ],
      order: [['createdAt','DESC']], limit, offset, distinct: true
    });
    const records = rows.map(payment => {
      const row = payment.toJSON ? payment.toJSON() : payment;
      const fee = row.Fee || {};
      const total = Number(fee.totalAmount || 0), parentPaid = Number(fee.parentPaidAmount ?? fee.paidAmount ?? 0), credit = Number(fee.creditAmount || 0);
      return { ...row, studentName: row.Student?.User?.name || row.metadata?.studentName || null, parentName: row.Parent?.User?.name || row.metadata?.parentName || null, className: row.Student?.Class?.name || row.Student?.grade || row.metadata?.className || null, feeTerm: fee.term || row.metadata?.term || null, feeYear: fee.year || row.metadata?.year || null, feeTotalAmount: total, feeParentPaidAmount: parentPaid, feeCreditAmount: credit, feePaidAmount: parentPaid + credit, feeBalance: Math.max(0, total - parentPaid - credit), recordType: 'payment' };
    });
    res.json({ success: true, data: records, records, pagination: { page, limit, total: count, pages: Math.max(1, Math.ceil(count / limit)) } });
  } catch (error) {
    console.error('Admin payment records error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getManualVerificationQueue = async (req, res) => {
  try {
    const rows = await Payment.findAll({
      where: manualSchoolVerificationWhere(req.user.schoolCode),
      include: [
        { model: Student, include: [{ model: User, attributes: ['id','name','schoolCode'] }, { model: Class, required:false }] },
        { model: Parent, include: [{model:User, attributes:['id','name','phone','email']}], required:false },
        { model: Fee, required:false }
      ],
      order: [['createdAt','DESC']],
      limit: 200
    });
    res.json({ success:true, data: rows.map(financeLedger.decoratePayment) });
  } catch(error){ res.status(500).json({ success:false, message:error.message }); }
};

exports.approveManualPayment = async (req, res) => {
  try {
    const data = await financeLedger.updateTransactionStatus({ user: req.user, schoolCode: req.user.schoolCode, paymentId: req.params.paymentId, status: 'completed', notes: req.body?.notes || null, manualReviewOnly: true });
    res.json({ success:true, message:'Payment approved. Student fee balance updated.', data });
  } catch(error){ res.status(400).json({ success:false, message:error.message }); }
};

exports.rejectManualPayment = async (req, res) => {
  try {
    const data = await financeLedger.updateTransactionStatus({ user: req.user, schoolCode: req.user.schoolCode, paymentId: req.params.paymentId, status: 'rejected', notes: req.body?.reason || req.body?.notes || 'Rejected by finance/admin', manualReviewOnly: true });
    res.json({ success:true, message:'Payment rejected. No balance was updated.', data });
  } catch(error){ res.status(400).json({ success:false, message:error.message }); }
};


// Finance Officer/Admin read context used by the dedicated Finance Workspace.
exports.getFinanceContext = async (req, res) => {
  try {
    const code = req.user.schoolCode;
    const [classes, students] = await Promise.all([
      Class.findAll({ where:{ schoolCode:code }, attributes:['id','name','grade','stream'], order:[['name','ASC']] }),
      Student.findAll({ include:[{ model:User, required:true, where:{ schoolCode:code }, attributes:['id','name','profileImage','profilePicture'] }], attributes:['id','userId','classId','grade','elimuid','admissionNumber'], order:[['id','ASC']] })
    ]);
    res.json({ success:true, data:{ classes, students } });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

// Locked provider payment initiation, callback, and platform manual review.
function lockedPaymentPayload(payment) {
  const isParentSchoolFee = payment.paymentType === 'fee' && payment.metadata?.parentInternalPaymentFlow === true;
  const hostedCheckout = isParentSchoolFee && payment.status === 'pending_customer_action' && ['checkout_url','hosted_checkout'].includes(payment.promptType) && !!payment.checkoutUrl;
  return {
    paymentId: payment.id,
    subscriptionPaymentId: payment.subscriptionPaymentId || null,
    subscriptionId: payment.subscriptionId || null,
    reference: payment.reference,
    accountReference: payment.accountReference,
    checkoutRequestId: payment.checkoutRequestId,
    merchantRequestId: payment.merchantRequestId,
    providerReference: payment.providerReference,
    provider: payment.paymentGateway,
    paymentMethod: payment.method,
    promptType: payment.promptType,
    promptStatus: payment.promptStatus,
    checkoutUrl: isParentSchoolFee ? null : payment.checkoutUrl,
    action: hostedCheckout ? { type: 'redirect', continueEndpoint: `/api/payments/${encodeURIComponent(payment.reference)}/continue` } : null,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    environment: payment.gatewayResponse?.environment || null,
    customerMessage: payment.metadata?.promptMessage || null,
    responseDescription: payment.gatewayResponse?.ResponseDescription || payment.metadata?.promptMessage || null
  };
}

async function startLockedPayment(req, res, payload, successMessage) {
  try {
    const payment = await paymentEngine.initiatePayment({ user: req.user, body: payload });
    const data = lockedPaymentPayload(payment);
    res.status(payment.status === 'pending_provider_error' ? 502 : 200).json({
      success: payment.status !== 'pending_provider_error',
      retryable: payment.status === 'pending_provider_error',
      message: payment.metadata?.promptMessage || payment.metadata?.providerError || successMessage || 'Payment started using the active configured provider.',
      data
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message, data: error.data || undefined });
  }
}

exports.parentFeeSTK = async (req, res) => {
  try {
    const payment = await paymentEngine.initiateParentStkPayment({ user: req.user, body: req.body });
    const data = lockedPaymentPayload(payment);
    res.status(payment.status === 'pending_provider_error' ? 502 : 200).json({
      success: payment.status !== 'pending_provider_error',
      retryable: payment.status === 'pending_provider_error',
      message: payment.metadata?.promptMessage || 'School fee payment started using the school active provider. Balance updates only after provider confirmation.',
      data
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message, data: error.data || undefined });
  }
};

exports.parentSubscriptionSTK = async (req, res) => startLockedPayment(req, res, {
  ...req.body,
  paymentType: 'platform',
  platformPurpose: 'child_subscription',
  purpose: 'child_subscription',
  ownerType: 'child',
  paymentMethod: req.body?.paymentMethod || '',
  billingCycle: req.body?.billingCycle || req.body?.billingPeriod || 'monthly'
}, 'Child subscription payment started using the active platform provider.');

exports.schoolSubscriptionSTK = async (req, res) => startLockedPayment(req, res, {
  ...req.body,
  paymentType: 'platform',
  platformPurpose: 'school_subscription',
  purpose: 'school_subscription',
  ownerType: 'school',
  paymentMethod: req.body?.paymentMethod || '',
  billingCycle: req.body?.billingCycle || req.body?.billingPeriod || 'monthly'
}, 'School subscription payment started using the active platform provider.');

exports.genericPlatformSTK = async (req, res) => startLockedPayment(req, res, {
  ...req.body,
  paymentType: 'platform',
  platformPurpose: req.body?.platformPurpose || req.body?.purpose || req.body?.metadata?.type || 'platform_payment',
  purpose: req.body?.purpose || req.body?.metadata?.type || 'platform_payment',
  ownerType: req.body?.ownerType || req.body?.metadata?.ownerType || (req.user?.role === 'parent' ? 'child' : 'school'),
  paymentMethod: req.body?.paymentMethod || '',
  billingCycle: req.body?.billingCycle || req.body?.billingPeriod || 'monthly'
}, 'Platform payment started using the active platform provider.');

// ============================================================================
// V200.3 FINAL BYPASS SEAL
// These overrides close the remaining legacy manual/M-Pesa alias routes so every
// payment path obeys the same active-provider rule:
// - school fees -> Finance Officer school provider
// - child/school subscriptions, add-ons, name change -> Super Admin platform provider
// - disabled providers cannot initiate or finalize payments
// ============================================================================

function v2003ManualProviderQueueWhere(extra = {}) {
  return {
    ...extra,
    paidTo: 'platform',
    status: { [Op.in]: ['pending', 'pending_verification'] },
    [Op.or]: [
      { promptType: 'manual_instructions' },
      { paymentGateway: { [Op.in]: ['manual', 'bank', 'cash', 'card', 'manual_mpesa'] } }
    ]
  };
}

exports.darajaCallback = async (req, res) => {
  try {
    await paymentEngine.handleWebhook({ provider: 'mpesa', payload: req.body || {}, headers: req.headers || {}, rawBody: req.rawBody, sourceIp: req.ip });
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('Locked M-Pesa callback error:', error.message);
    res.status(503).json({ ResultCode: 1, ResultDesc: 'Temporary processing failure; retry callback' });
  }
};

exports.parentFeeManual = async (req, res) => {
  try {
    const payment = await paymentEngine.initiateParentManualPayment({ user: req.user, body: req.body || {} });
    const data = lockedPaymentPayload(payment);
    if (payment.status === 'pending_provider_error') return res.status(502).json({ success: false, retryable: true, message: data.customerMessage || 'The payment reference could not be submitted.', data });
    res.json({ success: true, message: 'School fee reference submitted to the finance verification queue. It is not marked paid until finance approves it.', data });
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message, data: error.data || undefined });
  }
};

exports.parentSubscriptionManual = async (req, res) => startLockedPayment(req, res, {
  ...req.body,
  paymentType: 'platform',
  platformPurpose: 'child_subscription',
  purpose: 'child_subscription_manual_reference',
  ownerType: 'child',
  paymentMethod: 'manual',
  reference: req.body?.reference || req.body?.mpesaCode || req.body?.transactionCode || undefined,
  billingCycle: req.body?.billingCycle || req.body?.billingPeriod || 'monthly'
}, 'Child subscription reference submitted to the backend platform approval queue. It is not active until Super Admin approves it.');

exports.adminNameChangePaymentSTK = async (req, res) => startLockedPayment(req, res, {
  ...req.body,
  paymentType: 'platform',
  platformPurpose: 'name_change',
  purpose: 'school_name_change',
  ownerType: 'school',
  paymentMethod: req.body?.paymentMethod || '',
  accountReference: req.body?.accountReference || req.body?.reference || 'SCHOOL-NAME-CHANGE',
  metadata: { ...(req.body?.metadata || {}), newName: req.body?.newName || null, reason: req.body?.reason || null }
}, 'School name change payment started using the active platform provider.');

exports.getPlatformManualQueue = async (req, res) => {
  try {
    const rows = await Payment.findAll({
      where: v2003ManualProviderQueueWhere({ paymentType: { [Op.in]: ['platform', 'subscription'] } }),
      include: [
        { model: Student, required: false, include: [{ model: User, required: false, attributes: ['id', 'name', 'email', 'schoolCode'] }] },
        { model: Parent, required: false, include: [{ model: User, required: false, attributes: ['id', 'name', 'phone', 'email'] }] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 200
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reviewPlatformManualPayment = async (req, res) => {
  try {
    const { action, notes } = req.body || {};
    const approve = String(action || '').toLowerCase() !== 'reject';
    const payment=await sequelize.transaction(async transaction=>{
      const locked=await Payment.findOne({where:v2003ManualProviderQueueWhere({id:req.params.paymentId,paymentType:{[Op.in]:['platform','subscription']}}),transaction,lock:transaction.LOCK.UPDATE});
      if(!locked){const error=new Error('Manual/platform payment not found or already reviewed.');error.statusCode=404;throw error;}
      const before=locked.toJSON(),trail=Array.isArray(locked.auditTrail)?locked.auditTrail:[],certifiedAt=new Date();
      trail.push(auditEntry(approve?'manual_platform_payment_approved_v2045':'manual_platform_payment_rejected_v2045',req.user,{notes,provider:locked.paymentGateway}));
      await locked.update({status:approve?'completed':'rejected',providerStatus:approve?'manual_approved':'manual_rejected',completedAt:approve?certifiedAt:null,paymentDate:approve?certifiedAt:locked.paymentDate,reconciledAt:certifiedAt,reconciliationStatus:approve?'matched':'rejected',notes:notes||locked.notes,auditTrail:trail,completionAuthority:approve?'authorized_manual_review':locked.completionAuthority,completionEvidence:approve?{reviewedBy:req.user.id,reviewerRole:req.user.role,notes:notes||null,reference:locked.reference,provider:locked.paymentGateway}:locked.completionEvidence,completionCertifiedAt:approve?certifiedAt:locked.completionCertifiedAt,metadata:{...(locked.metadata||{}),manualReview:{approve,notes:notes||null,reviewedBy:req.user.id,reviewedAt:certifiedAt.toISOString()}}},{transaction,paymentCertification:approve?'authorized_manual_review':undefined});
      if(locked.subscriptionPaymentId){
        const subscriptionPayment=await SubscriptionPayment.findByPk(locked.subscriptionPaymentId,{transaction,lock:transaction.LOCK.UPDATE});
        if(!subscriptionPayment)throw new Error('Linked subscription payment is missing; manual approval was not applied.');
        const spTrail=Array.isArray(subscriptionPayment.auditTrail)?subscriptionPayment.auditTrail:[];
        spTrail.push(auditEntry(approve?'manual_provider_confirmed_v2045':'manual_provider_rejected_v2045',req.user,{paymentId:locked.id,notes}));
        await subscriptionPayment.update({status:approve?'success':'failed',paidAt:approve?certifiedAt:subscriptionPayment.paidAt,mpesaReceiptNumber:locked.mpesaReceiptNumber||locked.reference||subscriptionPayment.mpesaReceiptNumber,auditTrail:spTrail},{transaction});
        if(approve){
          const subPlan=await SubscriptionPlan.findByPk(subscriptionPayment.planId,{transaction})||await subscriptionController.getPlanByCode(subscriptionPayment.planCode,subscriptionPayment.ownerType==='school'?'school':'child');
          const subscription=await Subscription.findByPk(subscriptionPayment.subscriptionId,{transaction,lock:transaction.LOCK.UPDATE});
          if(!subPlan||!subscription)throw new Error('Subscription or plan is missing; payment approval was rolled back.');
          await subscriptionController.renewSubscription(subscription,subPlan,subscriptionPayment.billingCycle,locked.id,{transaction});
        }
      }
      await AuditLog.create({schoolCode:null,actorUserId:req.user.id,actorRole:req.user.role,module:'payments',action:approve?'platform_manual_payment_approved':'platform_manual_payment_rejected',entityType:'Payment',entityId:String(locked.id),before,after:locked.toJSON(),reason:notes||null,ipAddress:req.ip,userAgent:req.get?.('user-agent'),metadata:{completionAuthority:approve?'authorized_manual_review':null,transactional:true}},{transaction});
      return locked.reload({transaction});
    });
    res.json({ success: true, message: approve ? 'Platform payment approved and subscription/add-on activated.' : 'Platform payment rejected.', data: payment });
  } catch (error) {
    res.status(error.statusCode||400).json({ success: false, message: error.message });
  }
};
