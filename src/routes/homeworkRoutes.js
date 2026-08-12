const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const homeworkCtrl = require('../controllers/homeworkController');

// Public, safe file route for homework materials. Filenames are sanitized and unguessable.
router.get('/files/:filename', homeworkCtrl.serveHomeworkAttachment);

router.use(protect);
router.post('/attachments', authorize('teacher'), homeworkCtrl.uploadHomeworkAttachment);
router.post('/submission-attachments', authorize('student'), homeworkCtrl.uploadHomeworkSubmission);
router.post('/assign', authorize('teacher'), homeworkCtrl.createAssignment);
router.get('/teacher', authorize('teacher'), homeworkCtrl.getTeacherAssignments);
router.get('/teacher/:taskId', authorize('teacher'), homeworkCtrl.getTeacherAssignmentDetails);
router.put('/teacher/:taskId', authorize('teacher'), homeworkCtrl.updateTeacherAssignment);
router.post('/teacher/:taskId/discussion', authorize('teacher'), homeworkCtrl.createHomeworkDiscussion);
router.post('/teacher/submissions/:assignmentId/review', authorize('teacher'), homeworkCtrl.reviewSubmission);
router.get('/student', authorize('student'), homeworkCtrl.getStudentAssignments);
router.post('/submit/:assignmentId', authorize('student'), homeworkCtrl.submitAssignment);

module.exports = router;
