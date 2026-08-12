const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const teacherController = require('../controllers/teacherController');
const teacherMessageController = require('../controllers/teacherMessageController');
const taskController = require('../controllers/taskController');
const chatController = require('../controllers/chatController');
const analyticsController = require('../controllers/analyticsController');
const analyticsV152Controller = require('../controllers/analyticsV152Controller'); // Add import
const subjectSelectionController = require('../controllers/subjectSelectionController');
const classTeacherOnly=require('../middleware/classTeacherOnly');

router.use(protect);
router.use(authorize('teacher'));

// Students
router.get('/students',classTeacherOnly,teacherController.getMyStudents);
router.post('/students',classTeacherOnly,teacherController.addStudent);
router.get('/students/:studentId', teacherController.getTeacherStudentDetails);
router.delete('/students/:studentId',classTeacherOnly,teacherController.deleteStudent);
router.post('/students/upload',classTeacherOnly,teacherController.uploadStudentsCSV);
router.get('/class-students', teacherController.getClassStudentsForSubject);
router.get('/my-assignments', teacherController.getMyAssignments);

// Marks
router.put('/marks/:recordId', teacherController.updateMark);
router.delete('/marks/:recordId', teacherController.deleteMark);
router.get('/marks-template', teacherController.downloadMarksTemplate);
router.post('/marks', teacherController.enterMarks);
router.post('/marks/bulk', teacherController.saveBulkMarks);
router.post('/upload/marks', teacherController.uploadMarksCSV);

router.post('/marks/publish', teacherController.publishMarks);

// Attendance & Comments
router.post('/attendance', teacherController.takeAttendance);
router.post('/comment', teacherController.addComment);

// Dashboard & Stats
router.get('/dashboard', teacherController.getDashboard);
router.get('/stats', teacherController.getTeacherStats);
router.get('/my-class', teacherController.getMyClass);
router.get('/my-subjects', teacherController.getMySubjects);
router.get('/classes/:classId/students', teacherController.getClassStudents);
router.get('/gradebook', teacherController.getClassGradebook);
router.get('/reports/snapshots', teacherController.listClassReportSnapshots);
router.get('/students/:studentId/report-card-preview', teacherController.getClassTeacherReportPreviewDetails);
router.get('/performance', teacherController.getPerformanceData);
router.get('/subject-selection-requests', subjectSelectionController.listTeacherSubjectRequests);
router.get('/subject-requests', subjectSelectionController.listTeacherSubjectRequests);
router.post('/subject-selection-requests/:selectionId/review', subjectSelectionController.reviewTeacherSubjectRequest);
router.post('/subject-requests/:selectionId/review', subjectSelectionController.reviewTeacherSubjectRequest);

// Messaging (Parent)
router.get('/parent-conversations',classTeacherOnly,chatController.getParentConversations);
router.get('/conversations', teacherMessageController.getConversations);
router.get('/messages/:parentId', teacherMessageController.getMessages);
router.put('/messages/read/:conversationId', teacherMessageController.markMessagesAsRead);
router.post('/reply', teacherMessageController.replyToParent);
router.delete('/messages/:messageId', teacherController.deleteMessage);

// Staff Chat
router.get('/staff-members', chatController.getStaffMembers);
router.post('/group-message', chatController.sendGroupMessage);
router.post('/private-message', chatController.sendPrivateMessage);
router.get('/group-messages', chatController.getGroupMessages);
router.get('/private-messages/:otherUserId', chatController.getPrivateMessages);

// Tasks
router.get('/tasks', taskController.getTasks);
router.post('/tasks', taskController.createTask);
router.put('/tasks/:taskId', taskController.updateTask);
router.delete('/tasks/:taskId', taskController.deleteTask);
router.post('/tasks/:taskId/complete', taskController.completeTask);

router.get('/attendance/:date', teacherController.getAttendanceForDate);

// Analytics (NEW)
router.get('/analytics', analyticsV152Controller.getDashboardAnalytics);

module.exports = router;
