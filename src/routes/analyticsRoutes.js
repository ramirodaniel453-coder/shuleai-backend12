const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const analyticsController = require('../controllers/analyticsController');
const analyticsV152Controller = require('../controllers/analyticsV152Controller');

// All analytics routes require authentication
router.use(protect);

// v151.2 role-safe dashboard analytics and scoped exports: exact UI data, real backend, strict tenant scope
router.get('/dashboard', analyticsV152Controller.getDashboardAnalytics);
router.get('/tables', analyticsV152Controller.getAnalyticsTables);
router.get('/tables/:section', analyticsV152Controller.getAnalyticsTable);
router.post('/export', analyticsV152Controller.exportAnalytics);

// Student analytics (accessible by student, parent, teacher, admin)
router.get('/student/:studentId', analyticsController.getStudentAnalytics);

// Class analytics (teachers and above)
router.get('/class/:classId', authorize('teacher', 'admin', 'super_admin'), analyticsController.getClassAnalytics);

// School analytics (admin and above)
router.get('/school', authorize('admin', 'super_admin'), analyticsController.getSchoolAnalytics);

// Curriculum comparison
router.get('/compare/:studentId', analyticsController.compareCurriculum);

module.exports = router;