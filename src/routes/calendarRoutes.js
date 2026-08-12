const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const calCtrl = require('../controllers/calendarController');

router.get('/', protect, calCtrl.getCalendarEvents);
router.post('/', protect, authorize('admin'), calCtrl.createEvent);
router.put('/:id', protect, authorize('admin'), calCtrl.updateEvent);
router.delete('/:id', protect, authorize('admin'), calCtrl.deleteEvent);

module.exports = router;
