const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const alertController = require('../controllers/alertController');

// All routes require authentication
router.use(protect);

// Get user's own alerts
router.get('/', alertController.getMyAlerts);

// Mark all as read must be before /:id/read
router.put('/read-all', alertController.markAllAsRead);

// Shule AI suggestion for admin parent announcements
router.post('/suggest-parent-message', authorize('admin', 'super_admin'), alertController.suggestParentAlert);
router.post('/suggest-announcement', authorize('admin', 'super_admin'), alertController.suggestParentAlert);

// Create alert (admin/super_admin only) - FOR ANNOUNCEMENTS
router.post('/', authorize('admin', 'super_admin'), alertController.createAlert);

// User-owned alert deletion/cleanup
router.delete('/clear-all', alertController.clearMyAlerts);
router.delete('/:id', alertController.deleteMyAlert);

// Mark single alert as read
router.put('/:id/read', alertController.markAlertAsRead);

module.exports = router;
