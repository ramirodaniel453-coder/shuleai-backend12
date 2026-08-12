const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const timetableCtrl = require('../controllers/timetableController');

// NEW – fetch timetable for a specific week (admin view)
router.get('/', protect, authorize('admin'), timetableCtrl.getByWeek);
router.get('/classes', protect, authorize('admin'), timetableCtrl.getClasses);

// existing routes
router.post('/generate', protect, authorize('admin'), timetableCtrl.generate);
router.put('/:id', protect, authorize('admin'), timetableCtrl.manualUpdate);
router.post('/:id/publish', protect, authorize('admin'), timetableCtrl.publish);
router.get('/student/me', protect, authorize('student'), timetableCtrl.getForStudentMe);
router.get('/parent/child/:studentId', protect, authorize('parent'), timetableCtrl.getForParentChild);
router.get('/class/:classId', protect, authorize('admin'), timetableCtrl.getForClass);
router.get('/teacher/me', protect, authorize('teacher'), timetableCtrl.getForTeacher);
router.get('/teacher/:teacherId', protect, authorize('admin'), timetableCtrl.getForTeacher);

module.exports = router;
