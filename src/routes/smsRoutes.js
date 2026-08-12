'use strict';

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const smsController = require('../controllers/smsController');

router.use(protect, authorize('admin', 'super_admin'));
router.get('/config', smsController.getConfig);
router.put('/config', smsController.updateConfig);
router.post('/send', smsController.sendSms);
router.get('/history', smsController.getHistory);

module.exports = router;
