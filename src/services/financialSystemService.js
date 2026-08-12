const { Op } = require('sequelize');
const {
  sequelize,
  Fee,
  Payment,
  PaymentEvent,
  FeeInvoice,
  FeeInvoiceItem,
  StudentFeeAccount,
  PaymentTransaction,
  PaymentReconciliation,
  ProviderCredentialsAudit,
  PlatformSubscription
} = require('../models');

const PAID = new Set(['paid', 'completed', 'success', 'successful', 'approved']);
const FAILED = new Set(['failed', 'cancelled', 'canceled', 'expired', 'reversed', 'refunded']);

function amount(v, fallback = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}
function normalizeStatus(status) {
  const s = String(status || '').toLowerCase();
  if (PAID.has(s)) return 'paid';
  if (FAILED.has(s)) return 'failed';
  if (['processing', 'prompt_sent', 'pending_provider_error'].includes(s)) return s;
  return s || 'pending';
}
function invoiceStatus(total, paid, credit, dueDate) {
  const covered = amount(paid) + amount(credit);
  const balance = Math.max(0, amount(total) - covered);
  if (balance <= 0 && amount(total) > 0) return covered > amount(total) ? 'overpaid' : 'paid';
  if (covered > 0) return 'partial';
  if (dueDate && new Date(dueDate) < new Date()) return 'overdue';
  return 'unpaid';
}
function accountStatus(balance, paid, credit) {
  if (balance <= 0) return 'paid';
  if (amount(paid) + amount(credit) > 0) return 'partial';
  return 'unpaid';
}

async function ensureInvoiceForFee({ feeId, transaction } = {}) {
  if (!feeId || !FeeInvoice) return null;
  let invoice = await FeeInvoice.findOne({ where: { feeId }, transaction });
  if (invoice) return invoice;
  const fee = await Fee.findByPk(feeId, { transaction });
  if (!fee) return null;
  const total = amount(fee.totalAmount);
  const paid = amount(fee.parentPaidAmount ?? fee.paidAmount);
  const credit = amount(fee.creditAmount);
  invoice = await FeeInvoice.create({
    schoolCode: fee.schoolCode,
    studentId: fee.studentId,
    feeId: fee.id,
    feeStructureId: fee.feeStructureId || null,
    invoiceNumber: fee.invoiceNumber || fee.reference || `INV-${String(fee.id).padStart(6, '0')}`,
    term: fee.term ? String(fee.term) : null,
    year: fee.year || null,
    subtotalAmount: total,
    totalAmount: total,
    paidAmount: paid,
    creditAmount: credit,
    balanceAmount: Math.max(0, total - paid - credit),
    status: invoiceStatus(total, paid, credit, fee.dueDate),
    dueDate: fee.dueDate || null,
    metadata: { source: 'created_from_legacy_fee', feeId: fee.id }
  }, { transaction });
  await FeeInvoiceItem.create({
    invoiceId: invoice.id,
    schoolCode: fee.schoolCode,
    studentId: fee.studentId,
    category: fee.category || fee.feeType || 'school_fee',
    description: fee.description || fee.term || 'School fees',
    quantity: 1,
    unitAmount: total,
    amount: total,
    metadata: { source: 'created_from_legacy_fee' }
  }, { transaction }).catch(() => null);
  return invoice;
}

async function mirrorLegacyPayment({ payment, invoiceId = null, transaction } = {}) {
  if (!payment || !PaymentTransaction) return null;
  let tx = await PaymentTransaction.findOne({ where: { legacyPaymentId: payment.id }, transaction });
  const payload = {
    legacyPaymentId: payment.id,
    invoiceId,
    schoolCode: payment.schoolCode || 'platform',
    studentId: payment.studentId || null,
    parentId: payment.parentId || null,
    paymentType: payment.paymentType || 'school_fee',
    destination: payment.paidTo || payment.paymentDestination || (payment.paymentType === 'school_fee' ? 'school' : 'platform'),
    provider: payment.paymentGateway || payment.method || 'manual',
    method: payment.method || payment.paymentGateway || 'manual',
    internalReference: payment.reference,
    providerReference: payment.providerReference || payment.transactionId || payment.checkoutRequestId || null,
    idempotencyKey: payment.idempotencyKey || payment.reference,
    amount: amount(payment.amount),
    confirmedAmount: payment.confirmedAmount || null,
    currency: payment.currency || 'KES',
    status: normalizeStatus(payment.status),
    promptType: payment.promptType || null,
    promptStatus: payment.promptStatus || null,
    checkoutUrl: payment.checkoutUrl || null,
    phone: payment.payerPhone || null,
    accountReference: payment.accountReference || null,
    failureReason: payment.notes || null,
    receiptNumber: payment.receiptNumber || payment.mpesaReceiptNumber || null,
    paidAt: payment.completedAt || payment.paymentDate || null,
    failedAt: payment.failedAt || null,
    expiresAt: payment.expiresAt || null,
    reconciledAt: payment.reconciledAt || null,
    metadata: { ...(payment.metadata || {}), source: 'legacy_payment_mirror' },
    providerPayload: payment.gatewayResponse || {},
    auditTrail: Array.isArray(payment.auditTrail) ? payment.auditTrail : []
  };
  if (tx) await tx.update(payload, { transaction });
  else tx = await PaymentTransaction.create(payload, { transaction });
  return tx;
}

async function recalculateInvoice(invoiceId, { transaction } = {}) {
  if (!invoiceId || !FeeInvoice) return null;
  const invoice = await FeeInvoice.findByPk(invoiceId, { transaction, lock: transaction?.LOCK?.UPDATE });
  if (!invoice) return null;
  const paidRows = await PaymentTransaction.findAll({
    where: { invoiceId, status: { [Op.in]: ['paid', 'completed', 'success', 'successful', 'approved'] } },
    transaction
  }).catch(() => []);
  const paid = paidRows.reduce((sum, row) => sum + amount(row.confirmedAmount || row.amount), 0);
  const total = amount(invoice.totalAmount);
  const credit = Math.max(0, paid - total);
  const balance = Math.max(0, total - paid);
  const status = invoiceStatus(total, paid, credit, invoice.dueDate);
  await invoice.update({ paidAmount: Math.min(paid, total), creditAmount: credit, balanceAmount: balance, status, paidAt: balance <= 0 ? new Date() : invoice.paidAt }, { transaction });
  if (invoice.feeId) {
    await Fee.update({
      paidAmount: Math.min(paid, total),
      parentPaidAmount: Math.min(paid, total),
      creditAmount: credit,
      balance: balance,
      status,
      lastTransactionAt: new Date()
    }, { where: { id: invoice.feeId }, transaction }).catch(() => null);
  }
  await recalculateStudentAccount({ schoolCode: invoice.schoolCode, studentId: invoice.studentId, transaction });
  return invoice.reload ? invoice.reload({ transaction }) : invoice;
}

async function recalculateStudentAccount({ schoolCode, studentId, transaction } = {}) {
  if (!schoolCode || !studentId || !StudentFeeAccount) return null;
  const invoices = await FeeInvoice.findAll({ where: { schoolCode, studentId }, transaction }).catch(() => []);
  const invoicedAmount = invoices.reduce((s, x) => s + amount(x.totalAmount), 0);
  const paidAmount = invoices.reduce((s, x) => s + amount(x.paidAmount), 0);
  const creditAmount = invoices.reduce((s, x) => s + amount(x.creditAmount), 0);
  const balanceAmount = Math.max(0, invoicedAmount - paidAmount - creditAmount);
  const status = accountStatus(balanceAmount, paidAmount, creditAmount);
  let account = await StudentFeeAccount.findOne({ where: { schoolCode, studentId }, transaction });
  const payload = { schoolCode, studentId, invoicedAmount, paidAmount, creditAmount, balanceAmount, status, lastRecalculatedAt: new Date(), lastTransactionAt: new Date() };
  if (account) await account.update(payload, { transaction });
  else account = await StudentFeeAccount.create(payload, { transaction });
  return account;
}

async function finalizeConfirmedPayment({ legacyPayment, status = 'paid', providerReference, amount: confirmedAmount, currency, rawPayload = {}, event = null, transaction } = {}) {
  if (!legacyPayment) return null;
  const invoice = legacyPayment.feeId ? await ensureInvoiceForFee({ feeId: legacyPayment.feeId, transaction }) : null;
  const tx = await mirrorLegacyPayment({ payment: legacyPayment, invoiceId: invoice?.id || null, transaction });
  const normalized = normalizeStatus(status);
  const paid = normalized === 'paid';
  const failed = normalized === 'failed';
  await tx.update({
    status: paid ? 'paid' : (failed ? 'failed' : normalized),
    providerReference: providerReference || tx.providerReference,
    confirmedAmount: confirmedAmount ? amount(confirmedAmount) : tx.confirmedAmount,
    currency: currency || tx.currency,
    providerPayload: rawPayload || tx.providerPayload,
    paidAt: paid ? new Date() : tx.paidAt,
    failedAt: failed ? new Date() : tx.failedAt,
    reconciledAt: paid || failed ? new Date() : tx.reconciledAt,
    receiptNumber: providerReference || tx.receiptNumber,
    auditTrail: [...(Array.isArray(tx.auditTrail) ? tx.auditTrail : []), { action: 'v200_finalize', status: normalized, at: new Date().toISOString(), providerReference }]
  }, { transaction });
  if (event && event.update) await event.update({ paymentTransactionId: tx.id, processed: paid || failed, verified: true }, { transaction }).catch(() => null);
  if (paid && invoice) await recalculateInvoice(invoice.id, { transaction });
  if (paid && tx.paymentType === 'platform') await applyPlatformSubscriptionPayment({ tx, transaction });
  return tx;
}

async function applyPlatformSubscriptionPayment({ tx, transaction } = {}) {
  if (!tx || !PlatformSubscription || tx.paymentType !== 'platform' || tx.metadata?.ownerType === 'child') return null;
  const months = tx.metadata?.billingCycle === 'yearly' ? 12 : 1;
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setMonth(endsAt.getMonth() + months);
  let sub = await PlatformSubscription.findOne({ where: { schoolCode: tx.schoolCode, status: { [Op.in]: ['active', 'pending'] } }, transaction }).catch(() => null);
  const payload = {
    schoolCode: tx.schoolCode,
    planCode: tx.metadata?.planCode || tx.metadata?.purpose || 'basic',
    planName: tx.metadata?.planName || tx.metadata?.purpose || 'Basic',
    billingCycle: tx.metadata?.billingCycle || 'monthly',
    amount: tx.amount,
    currency: tx.currency,
    status: 'active',
    startsAt,
    endsAt,
    lastPaymentTransactionId: tx.id,
    metadata: { ...(sub?.metadata || {}), lastPaidReference: tx.internalReference }
  };
  if (sub) await sub.update(payload, { transaction }); else sub = await PlatformSubscription.create(payload, { transaction });
  return sub;
}

async function recordReconciliation({ legacyPayment, transactionRow, result, message, rawResponse = {}, transaction } = {}) {
  if (!PaymentReconciliation) return null;
  return PaymentReconciliation.create({
    paymentTransactionId: transactionRow?.id || null,
    legacyPaymentId: legacyPayment?.id || null,
    schoolCode: transactionRow?.schoolCode || legacyPayment?.schoolCode || null,
    provider: transactionRow?.provider || legacyPayment?.paymentGateway || 'unknown',
    internalReference: transactionRow?.internalReference || legacyPayment?.reference || null,
    providerReference: transactionRow?.providerReference || legacyPayment?.providerReference || null,
    statusBefore: legacyPayment?.status || transactionRow?.status || null,
    statusAfter: transactionRow?.status || legacyPayment?.status || null,
    result,
    message,
    rawResponse
  }, { transaction }).catch(() => null);
}

async function auditProviderCredentials({ schoolCode, scope = 'school', provider, action, actorUserId, changedFields = [], metadata = {} }) {
  if (!ProviderCredentialsAudit) return null;
  return ProviderCredentialsAudit.create({ schoolCode, scope, provider, action, actorUserId, changedFields, metadata }).catch(() => null);
}

module.exports = {
  PAID,
  FAILED,
  normalizeStatus,
  ensureInvoiceForFee,
  mirrorLegacyPayment,
  recalculateInvoice,
  recalculateStudentAccount,
  finalizeConfirmedPayment,
  recordReconciliation,
  auditProviderCredentials
};
