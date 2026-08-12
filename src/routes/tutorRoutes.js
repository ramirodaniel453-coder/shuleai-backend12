const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const tutor = require('../controllers/tutorController');

router.get('/config', protect, tutor.getTutorConfig);
router.post('/ask', protect, tutor.askTutor);
router.get('/progress/:studentId?', protect, tutor.getProgress);
router.get('/sessions', protect, tutor.listTutorSessions);
router.post('/sessions', protect, tutor.createTutorSession);
router.get('/sessions/:id', protect, tutor.getTutorSession);
router.get('/session/:studentId?', protect, tutor.getSessionHistory);
router.post('/practice/answer', protect, tutor.submitPracticeAnswer);
router.get('/reports/parent/:parentId?', protect, authorize('admin', 'parent'), tutor.getParentReport);
router.get('/reports/teacher/:classId?', protect, authorize('admin', 'teacher'), tutor.getTeacherReport);

module.exports = router;
