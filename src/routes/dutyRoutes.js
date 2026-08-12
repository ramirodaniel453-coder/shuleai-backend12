const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const dutyController = require('../controllers/dutyController');

router.use(protect);

router.post('/generate', authorize('admin'), dutyController.generateDutyRoster);
router.get('/stats', authorize('admin'), dutyController.getDutyStats);
router.get('/today', authorize('teacher', 'admin', 'super_admin'), dutyController.getTodayDuty);
router.get('/week', authorize('teacher', 'admin'), dutyController.getWeeklyDuty);
router.get('/verification-config', authorize('teacher', 'admin'), dutyController.getDutyVerificationConfig);
router.put('/verification-config', authorize('admin'), dutyController.updateDutyVerificationConfig);
router.post('/check-in/verified', authorize('teacher'), dutyController.verifiedCheckInDuty);
router.post('/check-out/verified', authorize('teacher'), dutyController.verifiedCheckOutDuty);
router.get('/compliance-report', authorize('admin'), dutyController.getDutyComplianceReport);
router.get('/late-arrivals', authorize('admin'), dutyController.getLateArrivalReport);
router.post('/check-in', authorize('teacher'), dutyController.checkInDuty);
router.post('/check-out', authorize('teacher'), dutyController.checkOutDuty);
router.put('/preferences', authorize('teacher'), dutyController.updateDutyPreferences);
router.post('/request-swap', authorize('teacher'), dutyController.requestDutySwap);
router.get('/available-swaps', authorize('teacher'), dutyController.getAvailableSwaps);
router.get('/points', authorize('teacher'), dutyController.getTeacherPoints);

router.get('/fairness-report', authorize('admin'), dutyController.getFairnessReport);
router.post('/adjust', authorize('admin'), dutyController.manualAdjustDuty);
router.get('/understaffed', authorize('admin'), dutyController.getUnderstaffedAreas);
router.get('/teacher-workload', authorize('admin'), dutyController.getTeacherWorkload);

module.exports = router;
