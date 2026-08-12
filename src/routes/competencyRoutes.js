const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const competencyController = require('../controllers/competencyController');

router.use(protect);

// Competencies
router.get('/competencies', competencyController.getCompetencies);
router.post('/competencies', authorize('admin'), competencyController.createCompetency);

// Learning outcomes
router.get('/learning-outcomes', competencyController.getLearningOutcomes);
router.post('/learning-outcomes', authorize('admin'), competencyController.createLearningOutcome);

// Student progress (teacher/admin)
router.get('/student-progress/:studentId', authorize('teacher', 'admin'), competencyController.getStudentProgress);
router.post('/student-progress', authorize('teacher', 'admin'), competencyController.updateStudentProgress);

// Teacher dashboard
router.get('/class-heatmap', authorize('teacher'), competencyController.getClassCompetencyHeatmap);
router.get('/below-expectation', authorize('teacher'), competencyController.getBelowExpectationStudents);
router.get('/auto-insights', authorize('teacher'), competencyController.getAutoInsights);

// AI suggestions
router.post('/ai-suggestion', authorize('teacher'), competencyController.getAISuggestion);

module.exports = router;
