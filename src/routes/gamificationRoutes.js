const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const gamCtrl = require('../controllers/gamificationController');

router.get('/leaderboard/:classId', protect, gamCtrl.getClassLeaderboard);
router.get('/badges/:studentId', protect, gamCtrl.getStudentBadges);
router.post('/badges', protect, authorize('admin'), gamCtrl.createBadge);
router.post('/award', protect, authorize('admin'), gamCtrl.awardBadge);
router.get('/my-summary', protect, authorize('student'), gamCtrl.getMyRewardsSummary);
router.get('/rewards', protect, gamCtrl.getRewards);
router.post('/rewards/redeem', protect, authorize('student'), gamCtrl.redeemReward);

module.exports = router;
