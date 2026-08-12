const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const financePermission=require('../middleware/financePermission');
const ctrl = require('../controllers/feeStructureController');

router.use(protect);
router.get('/', authorize('admin', 'finance_officer', 'super_admin'), financePermission('fee_structures'), ctrl.list);
router.post('/', authorize('admin', 'finance_officer', 'super_admin'), financePermission('fee_structures'), ctrl.create);
router.get('/student-accounts', authorize('admin', 'finance_officer', 'super_admin', 'teacher'), ctrl.studentFeeAccounts);
router.get('/:id', authorize('admin', 'finance_officer', 'super_admin'), financePermission('fee_structures'), ctrl.get);
router.put('/:id', authorize('admin', 'finance_officer', 'super_admin'), financePermission('fee_structures'), ctrl.update);
router.delete('/:id', authorize('admin', 'finance_officer', 'super_admin'), financePermission('fee_structures'), ctrl.delete);
router.post('/:id/activate', authorize('admin', 'finance_officer', 'super_admin'), financePermission('fee_structures'), ctrl.activate);
router.post('/:id/lock', authorize('admin', 'finance_officer', 'super_admin'), financePermission('fee_structures'), ctrl.lock);
router.post('/:id/assign', authorize('admin', 'finance_officer', 'super_admin'), financePermission('invoices'), ctrl.assign);
router.post('/student-accounts/:feeId/adjust', authorize('admin', 'finance_officer', 'super_admin'), ctrl.adjustFee);

module.exports = router;
