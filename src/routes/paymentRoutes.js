const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const financePermission=require('../middleware/financePermission');
const ctrl = require('../controllers/paymentController');
const locked = require('../controllers/lockedPaymentController');


// V152 FINAL LOCKED UNIVERSAL PAYMENT ENGINE
// One engine, two destinations: platform payments go to ShuleAI; school_fee payments go to the selected school provider.
router.get('/providers', protect, locked.getAllowedProviders);
router.get('/admin/providers', protect, authorize('admin', 'finance_officer'), financePermission('settings'), locked.getSchoolProviderSettings);
router.put('/admin/providers', protect, authorize('admin', 'finance_officer'), financePermission('settings'), locked.saveSchoolProviderSettings);
router.post('/admin/providers/test-connection', protect, authorize('admin', 'finance_officer'), financePermission('settings'), ctrl.testAdminPaymentConnection);
router.get('/admin/providers/:provider/setup-info', protect, authorize('admin', 'finance_officer'), financePermission('settings'), locked.getSchoolProviderSetupInfo);
router.post('/admin/providers/:provider/setup-notifications', protect, authorize('admin', 'finance_officer'), financePermission('settings'), locked.setupSchoolProviderNotifications);
router.post('/admin/providers/:provider/test-stk', protect, authorize('admin', 'finance_officer'), financePermission('settings'), locked.testSchoolProviderStk);
router.get('/admin/providers/:provider/test-status/:testId', protect, authorize('admin', 'finance_officer'), financePermission('settings'), locked.getSchoolProviderTestStatus);
router.get('/superadmin/providers', protect, authorize('super_admin'), locked.getPlatformProviderSettings);
router.put('/superadmin/providers', protect, authorize('super_admin'), locked.savePlatformProviderSettings);
router.post('/superadmin/providers/test-connection', protect, authorize('super_admin'), ctrl.testPlatformPaymentConnection);
router.get('/superadmin/providers/:provider/setup-info', protect, authorize('super_admin'), locked.getPlatformProviderSetupInfo);
router.post('/superadmin/providers/:provider/setup-notifications', protect, authorize('super_admin'), locked.setupPlatformProviderNotifications);
router.post('/superadmin/providers/:provider/test-stk', protect, authorize('super_admin'), locked.testPlatformProviderStk);
router.get('/providers/available', protect, authorize('parent'), locked.getParentPaymentMethods);
router.get('/parent/methods', protect, authorize('parent'), locked.getParentPaymentMethods);
router.get('/platform/method', protect, authorize('parent', 'admin', 'super_admin'), locked.getPlatformPublicMethod);
router.post('/parent/initiate', protect, authorize('parent'), locked.initiateParentFeePayment);
router.post('/parent/stk/initiate', protect, authorize('parent'), locked.initiateParentStkPayment);
router.post('/initiate', protect, authorize('admin', 'finance_officer', 'super_admin'), locked.initiatePayment);
router.get('/:reference/continue', protect, authorize('parent', 'admin', 'finance_officer', 'super_admin'), locked.getPaymentContinuation);
router.get('/:reference/status', protect, authorize('parent', 'admin', 'finance_officer', 'super_admin'), locked.getPaymentStatus);
router.post('/reconcile/:reference', protect, authorize('parent', 'admin', 'finance_officer', 'super_admin'), locked.reconcilePayment);
router.get('/webhook/:provider', locked.webhook);
router.post('/webhook/:provider', locked.webhook);


router.post('/mpesa/validation', ctrl.darajaCallback);
router.post('/mpesa/confirmation', ctrl.darajaCallback);
router.get('/mpesa/validation', (req, res) => res.json({ ResultCode: 0, ResultDesc: 'Accepted' }));
router.get('/mpesa/confirmation', (req, res) => res.json({ ResultCode: 0, ResultDesc: 'Accepted' }));
router.post('/mpesa/callback', ctrl.darajaCallback);
router.post('/daraja/callback', ctrl.darajaCallback);
router.post('/callback', ctrl.darajaCallback);

router.get('/admin/context', protect, authorize('admin', 'finance_officer'), financePermission('overview'), ctrl.getFinanceContext);
router.get('/admin/school-settings', protect, authorize('admin', 'finance_officer'), financePermission('settings'), ctrl.getAdminPaymentSettings);
router.put('/admin/school-settings', protect, authorize('admin', 'finance_officer'), financePermission('settings'), ctrl.updateAdminPaymentSettings);
router.post('/admin/test-connection', protect, authorize('admin', 'finance_officer'), ctrl.testAdminPaymentConnection);
router.get('/admin/manual-queue', protect, authorize('admin', 'finance_officer'), financePermission('verification'), ctrl.getManualVerificationQueue);
router.get('/admin/records', protect, authorize('admin', 'finance_officer'), financePermission('payments'), ctrl.getAdminPaymentRecords);
// V75 student-specific finance ledger endpoints
router.get('/parent/school-settings', protect, authorize('parent'), ctrl.getParentSchoolPaymentSettings);
router.get('/parent/students/:studentId/fee-accounts', protect, authorize('parent'), ctrl.getParentStudentFeeAccounts);
router.get('/parent/students/:studentId/history', protect, authorize('parent'), ctrl.getParentStudentPaymentHistory);
router.get('/admin/finance-summary', protect, authorize('admin', 'finance_officer'), financePermission('overview'), ctrl.getAdminFinanceSummary);
router.get('/admin/students/:studentId/finance', protect, authorize('admin', 'finance_officer'), financePermission('balances'), ctrl.getAdminStudentFinance);
router.get('/admin/students/:studentId/history', protect, authorize('admin', 'finance_officer'), financePermission('payments'), ctrl.getAdminStudentHistory);
router.post('/admin/students/:studentId/manual-payment', protect, authorize('admin', 'finance_officer'), financePermission('payments'), ctrl.recordAdminManualPayment);
router.post('/admin/students/:studentId/bursary', protect, authorize('admin', 'finance_officer'), financePermission('bursaries'), ctrl.recordAdminBursary);
router.post('/admin/transactions/:paymentId/approve', protect, authorize('admin', 'finance_officer'), financePermission('verification'), ctrl.approveManualPayment);
router.post('/admin/transactions/:paymentId/reject', protect, authorize('admin', 'finance_officer'), financePermission('verification'), ctrl.rejectManualPayment);

router.post('/admin/manual-queue/:paymentId/approve', protect, authorize('admin', 'finance_officer'), financePermission('verification'), ctrl.approveManualPayment);
router.post('/admin/manual-queue/:paymentId/reject', protect, authorize('admin', 'finance_officer'), financePermission('verification'), ctrl.rejectManualPayment);

router.get('/superadmin/platform-settings', protect, authorize('super_admin'), ctrl.getPlatformPaymentSettings);
router.put('/superadmin/platform-settings', protect, authorize('super_admin'), ctrl.updatePlatformPaymentSettings);
router.post('/superadmin/test-connection', protect, authorize('super_admin'), ctrl.testPlatformPaymentConnection);
router.get('/superadmin/platform-manual-queue', protect, authorize('super_admin'), ctrl.getPlatformManualQueue);
router.post('/superadmin/platform-manual-queue/:paymentId/review', protect, authorize('super_admin'), ctrl.reviewPlatformManualPayment);

router.post('/parent/fee/stk', protect, authorize('parent'), ctrl.parentFeeSTK);
router.post('/parent/fee/manual', protect, authorize('parent'), ctrl.parentFeeManual);
router.post('/parent/subscription/stk', protect, authorize('parent'), ctrl.parentSubscriptionSTK);
router.post('/parent/subscription/manual', protect, authorize('parent'), ctrl.parentSubscriptionManual);
router.post('/school/subscription/stk', protect, authorize('admin', 'super_admin'), ctrl.schoolSubscriptionSTK);
router.post('/admin/name-change/stk', protect, authorize('admin'), ctrl.adminNameChangePaymentSTK);
router.post('/platform/stk', protect, authorize('admin', 'super_admin'), ctrl.genericPlatformSTK);
router.get('/stk/:checkoutRequestId/status', protect, authorize('parent', 'admin', 'finance_officer', 'super_admin'), ctrl.queryStatus);

module.exports = router;
