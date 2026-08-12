const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const nameChangeController = require('../controllers/nameChangeController');

// All routes require authentication
router.use(protect);

// Admin routes
router.post('/name-change-request', authorize('admin'), nameChangeController.createNameChangeRequest);
router.get('/name-change-requests', authorize('admin'), nameChangeController.getMyNameChangeRequests);

module.exports = router;
