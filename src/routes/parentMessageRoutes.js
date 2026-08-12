const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const parentMessageController = require('../controllers/parentMessageController');

// Parent routes
router.post('/message', protect, authorize('parent'), parentMessageController.sendMessage);
router.get('/message-targets', protect, authorize('parent'), parentMessageController.getMessageTargets);
router.get('/conversations', protect, authorize('parent'), parentMessageController.getConversations);
router.get('/messages/:otherUserId', protect, authorize('parent'), parentMessageController.getMessages);

// Teacher/Admin routes
router.post('/reply', protect, authorize('teacher', 'admin'), parentMessageController.replyToParent);

module.exports = router;
