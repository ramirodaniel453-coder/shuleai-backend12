const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const subscriptionController = require('../controllers/subscriptionController');

router.get('/plans', protect, subscriptionController.getPlans);
router.get('/my-status', protect, authorize('parent', 'student', 'admin', 'teacher', 'super_admin'), subscriptionController.getMyStatus);
router.get('/child/:studentId/status', protect, authorize('parent'), subscriptionController.getChildStatus);
router.post('/child/request', protect, authorize('parent'), subscriptionController.createChildSubscriptionRequest);
router.post('/upgrade', protect, authorize('parent'), subscriptionController.createChildSubscriptionRequest);
router.post('/initiate-payment', protect, authorize('parent'), subscriptionController.createChildSubscriptionRequest);

router.get('/school/status', protect, authorize('admin', 'super_admin'), subscriptionController.getSchoolStatus);
router.get('/school/billing-history', protect, authorize('admin', 'super_admin'), subscriptionController.getBillingHistory);
router.post('/school/request', protect, authorize('admin', 'super_admin'), subscriptionController.createSchoolSubscriptionRequest);
router.post('/expire-now', protect, authorize('super_admin'), subscriptionController.expireNow);

module.exports = router;
