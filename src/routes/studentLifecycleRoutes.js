const router=require('express').Router();
const { protect, authorize }=require('../middleware/auth');
const ctrl=require('../controllers/studentLifecycleController');

router.use(protect);

// Planned academic-year promotion/transition: administrator-owned.
router.get('/promotions',authorize('admin','super_admin'),ctrl.listBatches);
router.post('/promotions/preview',authorize('admin','super_admin'),ctrl.preview);
router.post('/promotions/apply-due',authorize('admin','super_admin'),ctrl.applyDue);
router.get('/promotions/:id/export/:format',authorize('admin','super_admin'),ctrl.exportBatch);
router.get('/promotions/:id',authorize('admin','super_admin'),ctrl.getBatch);
router.patch('/promotions/:id/decisions/:decisionId',authorize('admin','super_admin'),ctrl.updateDecision);
router.post('/promotions/:id/confirm',authorize('admin','super_admin'),ctrl.confirm);
router.post('/promotions/:id/rollback',authorize('admin','super_admin'),ctrl.rollback);

// Individual same-school class transfer workflow.
router.get('/transfer-options',authorize('admin','super_admin','teacher'),ctrl.transferOptions);
router.post('/transfers/preview',authorize('admin','super_admin','teacher'),ctrl.previewTransfer);
router.get('/transfers',authorize('admin','super_admin','teacher'),ctrl.listTransfers);
router.post('/transfers',authorize('admin','super_admin'),ctrl.createTransfer);
router.post('/school-transfer-out/preview',authorize('admin','super_admin'),ctrl.previewTransferOut);
router.post('/school-transfer-outs',authorize('admin','super_admin'),ctrl.createTransferOut);
router.post('/transfer-requests',authorize('teacher'),ctrl.requestTransfer);
router.get('/transfers/:id',authorize('admin','super_admin','teacher'),ctrl.getTransfer);
router.post('/transfers/:id/approve',authorize('admin','super_admin'),ctrl.approveTransfer);
router.post('/transfers/:id/reject',authorize('admin','super_admin'),ctrl.rejectTransfer);
router.post('/transfers/:id/cancel',authorize('admin','super_admin','teacher'),ctrl.cancelTransfer);
router.post('/transfers/:id/rollback',authorize('admin','super_admin'),ctrl.rollbackTransfer);

// Role-safe history. Controller verifies student self, linked parent, current/historical class teacher, or admin.
router.get('/me/enrollments',authorize('student'),ctrl.myEnrollmentHistory);
router.get('/children/:studentId/enrollments',authorize('parent'),ctrl.childEnrollmentHistory);
router.get('/students/:studentId/enrollments',authorize('admin','super_admin','teacher','parent','student'),ctrl.enrollmentHistory);

module.exports=router;
