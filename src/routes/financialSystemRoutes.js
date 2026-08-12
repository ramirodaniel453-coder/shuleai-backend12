const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const financePermission = require('../middleware/financePermission');
const ctrl = require('../controllers/financialSystemController');

router.get('/summary', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('overview'), ctrl.summary);
router.get('/invoices', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('balances'), ctrl.listInvoices);
router.get('/students/:studentId/account', protect, authorize('admin', 'finance_officer', 'parent', 'super_admin'), ctrl.getStudentAccount);
router.post('/students/:studentId/recalculate', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('balances'), ctrl.recalculateStudent);
router.get('/transactions', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('payments'), ctrl.listTransactions);
router.get('/reconciliations', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('verification'), ctrl.listReconciliations);
router.get('/credential-audits', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('settings'), ctrl.listCredentialAudits);
router.get('/refunds', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('payments'), ctrl.listRefunds);
router.post('/transactions/:transactionId/refund', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('payments'), ctrl.requestRefund);
router.get('/platform-subscriptions', protect, authorize('admin', 'finance_officer', 'super_admin'), ctrl.listPlatformSubscriptions);
router.post('/backfill-legacy', protect, authorize('admin', 'finance_officer', 'super_admin'), financePermission('settings'), ctrl.backfillFromLegacy);

module.exports = router;
