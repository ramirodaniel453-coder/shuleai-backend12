const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/monitoringController');

router.post('/frontend-error', monitoringController.frontendError);
router.get('/health', monitoringController.health);

module.exports = router;
