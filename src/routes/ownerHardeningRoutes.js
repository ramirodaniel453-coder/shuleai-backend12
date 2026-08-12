const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const owner = require('../controllers/ownerHardeningController');

router.use(protect);
router.get('/analytics/overview', owner.getOwnerAnalytics);
router.get('/branding', owner.getSchoolBranding);
router.put('/branding', authorize('admin', 'super_admin'), owner.updateSchoolBranding);
router.post('/branding/logo', authorize('admin', 'super_admin'), owner.uploadSchoolLogo);
router.get('/agent-toolkit', authorize('admin', 'super_admin'), owner.getAgentToolkit);
router.get('/health-dashboard', authorize('admin', 'super_admin'), owner.getAdminHealthDashboard);
router.post('/demo-school/seed', authorize('super_admin'), owner.seedDemoSchool);

module.exports = router;
