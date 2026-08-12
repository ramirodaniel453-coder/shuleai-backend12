const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/realtimeSyncController');
router.get('/sync', protect, ctrl.sync);
module.exports = router;
