const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const homeTaskController = require('../controllers/homeTaskController');

router.use(protect);

router.get('/today', authorize('parent'), homeTaskController.getTodayTasks);
router.post('/:id/complete', authorize('parent'), homeTaskController.completeTask);

module.exports = router;
