const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/attendanceLifecycleController');
router.use(protect);
router.get('/absence-reports', authorize('teacher','admin','super_admin'), ctrl.listAbsenceReports);
router.post('/absence-reports/:reportId/review', authorize('admin','super_admin'), ctrl.reviewAbsenceReport);
router.post('/sessions', authorize('teacher','admin','super_admin'), ctrl.getOrCreateSession);
router.put('/sessions/:sessionId/draft', authorize('teacher','admin','super_admin'), ctrl.saveDraft);
router.post('/sessions/:sessionId/lock', authorize('teacher','admin','super_admin'), ctrl.lockSession);
router.post('/sessions/:sessionId/corrections', authorize('admin','super_admin'), ctrl.correctAttendance);
router.get('/sessions/:sessionId/corrections', authorize('teacher','admin','super_admin'), ctrl.getCorrections);
router.post('/sessions/:sessionId/release', authorize('teacher','admin','super_admin'), ctrl.releaseClass);
router.get('/sessions/:classId/:date', authorize('teacher','admin','super_admin'), (req,res,next) => {
  if (!/^\d+$/.test(String(req.params.classId || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(req.params.date || ''))) return res.status(400).json({ success:false, message:'A valid class ID and attendance date are required.' });
  return ctrl.getOrCreateSession(req,res,next);
});
module.exports = router;
