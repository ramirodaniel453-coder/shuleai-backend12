const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const uploadController = require('../controllers/uploadController');

// All upload routes require authentication
router.use(protect);

// Public templates (any authenticated user)
router.get('/template/marks', uploadController.downloadMarksTemplate);
router.get('/template/:type', uploadController.downloadTemplate);

// Validate CSV
router.post('/validate', uploadController.validateCSV);

// Upload endpoints with role restrictions
router.post('/students', authorize('teacher', 'admin'), uploadController.uploadStudents);
router.post('/marks', authorize('teacher'), uploadController.uploadMarks);
router.post('/attendance', authorize('teacher'), uploadController.uploadAttendance);

// Upload history
router.get('/history', uploadController.getUploadHistory);

module.exports = router;
