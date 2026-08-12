const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const studentController = require('../controllers/studentController');
const authController = require('../controllers/authController');
const analyticsController = require('../controllers/analyticsController');
const analyticsV152Controller = require('../controllers/analyticsV152Controller');
const subjectSelectionController = require('../controllers/subjectSelectionController');
const { MoodCheckin } = require('../models');

router.use(protect, authorize('student'));

// First-time password setup is protected. A student can only change their own first-login password after logging in with the temporary password issued by the school.
router.post('/set-first-password', authController.setFirstPassword);

router.get('/dashboard', studentController.getDashboard);
router.get('/materials', studentController.getMaterials);
router.get('/grades', studentController.getGrades);
router.get('/recommendations', studentController.getGradeRecommendations);
router.get('/careers', studentController.getCareerOptions);
router.get('/career/interests', studentController.getCareerInterests);
router.put('/career/interests', studentController.saveCareerInterests);
router.post('/career/insights', studentController.generateCareerInsights);
router.get('/attendance', studentController.getAttendance);
router.post('/message', studentController.sendMessage);
router.get('/messages/:otherUserId', studentController.getMessages);

router.post('/group-message', studentController.sendGroupMessage);
router.get('/group-messages', studentController.getGroupMessages);

// Analytics (NEW)
router.get('/analytics', analyticsV152Controller.getDashboardAnalytics);
router.get('/subject-selection', subjectSelectionController.getStudentOwnSelection);
router.put('/subject-selection', subjectSelectionController.saveStudentOwnSelection);

router.post('/mood', protect, authorize('student'), async (req, res) => {
    try {
        const { mood, note } = req.body;
        const checkin = await MoodCheckin.create({ userId: req.user.id, mood, note });
        res.json({ success: true, data: checkin });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

module.exports = router;
