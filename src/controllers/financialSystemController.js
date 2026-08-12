const { Op } = require('sequelize');
const {
  FeeInvoice,
  FeeInvoiceItem,
  StudentFeeAccount,
  PaymentTransaction,
  PaymentReconciliation,
  ProviderCredentialsAudit,
  PaymentRefund,
  PlatformSubscription,
  Student,
  User,
  Class,
  Payment
} = require('../models');
const financialSystem = require('../services/financialSystemService');
const financeLedger = require('../services/financeLedgerService');

function schoolCodeOf(req) {
  return req.user?.role === 'super_admin' ? (req.query.schoolCode || req.body.schoolCode || req.user.schoolCode) : req.user?.schoolCode;
}
function money(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; }
function ok(res, data, message = 'OK') { return res.json({ success: true, message, data }); }

exports.summary = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req);
    const where = schoolCode ? { schoolCode } : {};
    const accounts = await StudentFeeAccount.findAll({ where }).catch(() => []);
    const txs = await PaymentTransaction.findAll({ where, limit: 500, order: [['createdAt', 'DESC']] }).catch(() => []);
    const pending = txs.filter(t => ['pending','processing','pending_provider_error'].includes(String(t.status).toLowerCase())).length;
    const failed = txs.filter(t => String(t.status).toLowerCase() === 'failed').length;
    ok(res, {
      accounts: accounts.length,
      invoicedAmount: accounts.reduce((s,a)=>s+money(a.invoicedAmount),0),
      paidAmount: accounts.reduce((s,a)=>s+money(a.paidAmount),0),
      creditAmount: accounts.reduce((s,a)=>s+money(a.creditAmount),0),
      balanceAmount: accounts.reduce((s,a)=>s+money(a.balanceAmount),0),
      recentTransactions: txs.slice(0, 20),
      pendingPayments: pending,
      failedPayments: failed
    });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listInvoices = async (req, res) => {
  try {
    const where = { schoolCode: schoolCodeOf(req) };
    if (req.query.studentId) where.studentId = Number(req.query.studentId);
    if (req.query.status) where.status = String(req.query.status);
    const invoices = await FeeInvoice.findAll({
      where,
      include: [
        { model: FeeInvoiceItem, required: false },
        { model: Student, required: false, include: [{ model: User, required:false, attributes:['id','name'] }, { model: Class, required:false, attributes:['id','name','stream'] }] }
      ],
      order: [['createdAt','DESC']],
      limit: Math.min(Number(req.query.limit || 300), 1000)
    });
    ok(res, invoices);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getStudentAccount = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req);
    const studentId = Number(req.params.studentId || req.query.studentId);
    if (!studentId) return res.status(400).json({ success:false, message:'studentId is required' });
    if (req.user?.role === 'parent') await financeLedger.assertParentOwnsStudent({ parentUserId: req.user.id, studentId, schoolCode });
    await financialSystem.recalculateStudentAccount({ schoolCode, studentId }).catch(() => null);
    const account = await StudentFeeAccount.findOne({ where: { schoolCode, studentId } });
    const invoices = await FeeInvoice.findAll({ where: { schoolCode, studentId }, order: [['createdAt','DESC']] });
    const transactions = await PaymentTransaction.findAll({ where: { schoolCode, studentId }, order: [['createdAt','DESC']], limit: 100 });
    ok(res, { account, invoices, transactions });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.recalculateStudent = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req);
    const studentId = Number(req.params.studentId);
    const invoices = await FeeInvoice.findAll({ where: { schoolCode, studentId } });
    for (const inv of invoices) await financialSystem.recalculateInvoice(inv.id);
    const account = await financialSystem.recalculateStudentAccount({ schoolCode, studentId });
    ok(res, { account }, 'Student fee account recalculated from invoices and confirmed payments.');
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listTransactions = async (req, res) => {
  try {
    const where = { schoolCode: schoolCodeOf(req) };
    if (req.query.studentId) where.studentId = Number(req.query.studentId);
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.paymentType) where.paymentType = String(req.query.paymentType);
    const rows = await PaymentTransaction.findAll({ where, order: [['createdAt','DESC']], limit: Math.min(Number(req.query.limit || 300), 1000) });
    ok(res, rows);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listReconciliations = async (req, res) => {
  try {
    const where = {};
    const schoolCode = schoolCodeOf(req);
    if (schoolCode) where.schoolCode = schoolCode;
    const rows = await PaymentReconciliation.findAll({ where, order: [['checkedAt','DESC']], limit: Math.min(Number(req.query.limit || 200), 500) });
    ok(res, rows);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listCredentialAudits = async (req, res) => {
  try {
    const where = {};
    const schoolCode = schoolCodeOf(req);
    if (req.user?.role !== 'super_admin') where.schoolCode = schoolCode;
    if (req.query.provider) where.provider = String(req.query.provider);
    const rows = await ProviderCredentialsAudit.findAll({ where, order: [['createdAt','DESC']], limit: Math.min(Number(req.query.limit || 200), 500) });
    ok(res, rows);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listRefunds = async (req, res) => {
  try {
    const where = {};
    const schoolCode = schoolCodeOf(req);
    if (schoolCode) where.schoolCode = schoolCode;
    const rows = await PaymentRefund.findAll({ where, order: [['createdAt','DESC']], limit: Math.min(Number(req.query.limit || 200), 500) });
    ok(res, rows);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.requestRefund = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req);
    const tx = await PaymentTransaction.findOne({ where: { id: Number(req.params.transactionId), ...(schoolCode ? { schoolCode } : {}) } });
    if (!tx) return res.status(404).json({ success:false, message:'Transaction not found' });
    if (!['paid','completed','success','successful','approved'].includes(String(tx.status).toLowerCase())) return res.status(400).json({ success:false, message:'Only confirmed payments can be refunded.' });
    const refund = await PaymentRefund.create({ paymentTransactionId: tx.id, legacyPaymentId: tx.legacyPaymentId, schoolCode: tx.schoolCode, provider: tx.provider, amount: Math.min(money(req.body.amount || tx.confirmedAmount || tx.amount), money(tx.confirmedAmount || tx.amount)), currency: tx.currency, reason: req.body.reason || null, requestedBy: req.user?.id || null, status: 'requested' });
    ok(res, refund, 'Refund request recorded. Provider refund execution must be confirmed before balances change.');
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listPlatformSubscriptions = async (req, res) => {
  try {
    const where = {};
    if (req.user?.role !== 'super_admin') where.schoolCode = schoolCodeOf(req);
    else if (req.query.schoolCode) where.schoolCode = req.query.schoolCode;
    const rows = await PlatformSubscription.findAll({ where, order: [['updatedAt','DESC']], limit: Math.min(Number(req.query.limit || 200), 500) });
    ok(res, rows);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.backfillFromLegacy = async (req, res) => {
  try {
    const schoolCode = schoolCodeOf(req);
    const where = schoolCode ? { schoolCode } : {};
    const payments = await Payment.findAll({ where, limit: Math.min(Number(req.body.limit || 500), 2000), order: [['createdAt','ASC']] });
    let mirrored = 0;
    for (const p of payments) {
      const invoice = p.feeId ? await financialSystem.ensureInvoiceForFee({ feeId: p.feeId }) : null;
      await financialSystem.mirrorLegacyPayment({ payment: p, invoiceId: invoice?.id || null });
      if (invoice) await financialSystem.recalculateInvoice(invoice.id);
      mirrored += 1;
    }
    ok(res, { mirrored }, 'Legacy payments mirrored into v2 financial tables without deleting old records.');
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};
