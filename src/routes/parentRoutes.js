const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const parentController = require('../controllers/parentController');
const parentMessageController = require('../controllers/parentMessageController');
const analyticsController = require('../controllers/analyticsController');
const analyticsV152Controller = require('../controllers/analyticsV152Controller'); // Add import
const subjectSelectionController = require('../controllers/subjectSelectionController');

router.use(protect, authorize('parent'));

// Basic routes – no subscription required
router.get('/children', parentController.getChildren);
router.post('/children/link', parentController.linkChildByElimuId);
router.get('/child/:studentId/summary', parentController.getChildSummary);
router.get('/child/:studentId/report-card-details', parentController.getChildReportCardDetails);
router.post('/report-absence', parentController.reportAbsence);
router.get('/fees/:studentId', parentController.getFees);
router.post('/fees/pay', parentController.addPayment);
router.get('/message-targets', parentMessageController.getMessageTargets);
router.get('/conversations', parentMessageController.getConversations);
router.get('/messages/:otherUserId', parentMessageController.getMessages);
router.post('/message', parentMessageController.sendMessage);
router.get('/child/:studentId/attendance/today', parentController.getChildTodayAttendance);
router.get('/child/:studentId/analytics', parentController.getChildAnalytics);
router.get('/child/:studentId/subject-selection', subjectSelectionController.getParentChildSelection);
router.put('/child/:studentId/subject-selection', subjectSelectionController.saveParentChildSelection);

// Payment/Subscription routes
router.get('/plans', parentController.getSubscriptionPlans);
router.post('/upgrade-plan', parentController.upgradePlan);
router.post('/pay', parentController.makePayment);
router.get('/payments', parentController.getPayments);
router.post('/payment-confirm', parentController.confirmPayment);

// Analytics (NEW)
router.get('/analytics', analyticsV152Controller.getDashboardAnalytics);

module.exports = router;
