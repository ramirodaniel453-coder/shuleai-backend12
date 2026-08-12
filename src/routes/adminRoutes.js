const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { validate, validationRules } = require('../middleware/validation');
const teacherSignupController = require('../controllers/teacherSignupController');
const dutyController = require('../controllers/dutyController');
const adminController = require('../controllers/adminController');
const classController = require('../controllers/classController');
const analyticsController = require('../controllers/analyticsController');
const analyticsV152Controller = require('../controllers/analyticsV152Controller'); // Add import
const parentMessageController = require('../controllers/parentMessageController');
const subjectSelectionController = require('../controllers/subjectSelectionController');
const curriculumController = require('../controllers/curriculumController');

// ============ PUBLIC / SHARED ROUTES (any authenticated user) ============
router.get('/settings', protect, adminController.getSchoolSettings);

// ============ ADMIN / SUPER ADMIN ONLY ROUTES ============
router.use(protect, authorize('admin', 'super_admin'));

// Dashboard
router.get('/dashboard', adminController.getDashboardStats);

// Student Management
router.get('/students', adminController.getAllStudents);
router.get('/students/:studentId', adminController.getStudentDetails);
router.post('/students/:studentId/suspend', adminController.suspendStudent);
router.post('/students/:studentId/reactivate', adminController.reactivateStudent);
router.put('/students/:studentId', adminController.updateStudent);
router.delete('/students/:studentId', adminController.deleteStudent);

// Teacher Management
router.get('/teachers', adminController.getAllTeachers);
router.put('/teachers/:teacherId', adminController.updateTeacher);
router.delete('/teachers/:teacherId', adminController.deleteTeacher);
router.post('/classes/subject-assign-batch', adminController.batchAssignSubjects);

// Parent Management
router.get('/parents', adminController.getAllParents);

// Finance staff accounts
router.get('/finance-staff', adminController.getFinanceStaff);
router.post('/finance-staff', adminController.createFinanceStaff);
router.patch('/finance-staff/:userId', adminController.updateFinanceStaff);

// Teacher Approvals
router.get('/approvals/pending', teacherSignupController.getPendingApprovals);
router.post('/teachers/:teacherId/approve', validationRules.approveTeacher, validate, teacherSignupController.approveTeacher);

// Class Management
router.get('/classes', adminController.getClasses);
router.get('/classes/:id/students', adminController.getClassStudents);
router.get('/classes/:id', adminController.getClassDetails);
router.post('/classes', adminController.createClass);
router.put('/classes/:id', adminController.updateClass);
router.delete('/classes/:id', adminController.deleteClass);
router.get('/available-teachers', adminController.getAvailableTeachers);
router.post('/classes/:id/assign-teacher', adminController.assignTeacherToClass);
router.post('/classes/:id/remove-teacher', adminController.removeTeacherFromClass);

// Subject Assignments
router.get('/classes/:classId/subjects', adminController.getClassSubjectAssignments);
router.post('/classes/subject-assign', adminController.assignTeacherToSubject);
router.delete('/classes/subject-assign/:assignmentId', adminController.removeSubjectAssignment);

// Analytics & Stats
router.get('/grades/stats', adminController.getStudentGrades);
router.get('/attendance/stats', adminController.getAttendanceStats);

// Duty Management
router.post('/duty/generate', dutyController.generateDutyRoster);
router.get('/duty/stats', dutyController.getDutyStats);
router.get('/duty/fairness-report', dutyController.getFairnessReport);
router.get('/duty/understaffed', dutyController.getUnderstaffedAreas);
router.get('/duty/teacher-workload', dutyController.getTeacherWorkload);
router.post('/duty/adjust', dutyController.manualAdjustDuty);
router.get('/duty/public-sharing', adminController.getPublicDutySharing);
router.put('/duty/public-sharing', adminController.updatePublicDutySharing);

// School Settings (write – admin only)
router.put('/settings', adminController.updateSchoolSettings);

// V102 locked curriculum + structure engine
router.get('/curriculum/countries', curriculumController.listCountries);
router.get('/curriculum/packs', curriculumController.listPacks);
router.get('/curriculum/workflow', curriculumController.getWorkflow);
router.put('/curriculum/workflow', curriculumController.updateWorkflow);
router.get('/curriculum/grading-profiles', curriculumController.listCustomGradingProfiles);
router.post('/curriculum/grading-profiles', curriculumController.createCustomGradingProfile);
router.post('/curriculum/grading-profiles/:profileId/activate', curriculumController.activateCustomGradingProfile);
router.get('/curriculum/setup', adminController.getCurriculumSetup);
router.put('/curriculum/setup', adminController.updateCurriculumSetup);
router.get('/curriculum/levels', adminController.getCurriculumLevels);
router.get('/curriculum/subject-bank', adminController.getCurriculumSubjectBank);
router.get('/curriculum/school-subjects', adminController.getSchoolSubjects);
router.put('/curriculum/school-subjects', adminController.saveSchoolSubjects);
router.get('/curriculum/custom-subjects', adminController.getCustomSubjects);
router.post('/curriculum/custom-subjects', adminController.createCustomSubject);
router.delete('/curriculum/custom-subjects/:subjectId', adminController.deleteCustomSubject);
router.get('/assessment-settings', adminController.getAssessmentSettings);
router.put('/assessment-settings', adminController.updateAssessmentSettings);
router.get('/curriculum/classes/generation-preview', adminController.previewClassGeneration);
router.post('/curriculum/classes/generate', adminController.generateClassesFromSettings);
router.post('/curriculum/classes/sync', adminController.syncCurriculumClasses);
router.get('/curriculum/classes/:classId/subjects', adminController.getEligibleSubjectsForClass);
router.get('/students/:studentId/subject-selection', adminController.getStudentSubjectSelection);
router.put('/students/:studentId/subject-selection', adminController.saveStudentSubjectSelection);
router.post('/students/:studentId/subject-selection/verify', subjectSelectionController.verifyAdminStudentSelection);
router.post('/billing/payment-confirmation', adminController.submitSchoolPaymentConfirmation);


// Parent/Admin Messaging
router.get('/parent-conversations', parentMessageController.getAdminConversations);
router.get('/messages/:parentId', parentMessageController.getAdminMessages);
router.post('/reply-parent', parentMessageController.adminReplyToParent);

// Analytics (NEW)
router.get('/analytics', analyticsV152Controller.getDashboardAnalytics);

module.exports = router;
