const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

router.get('/duty/today', publicController.getPublicDutyView);
router.get('/duty/week', publicController.getPublicWeeklyDuty);
router.get('/school/:schoolId', publicController.getSchoolInfo);

module.exports = router;