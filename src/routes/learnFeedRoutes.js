const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/learnFeedController');
const { requireRegistrationsEnabled } = require('../middleware/platformControls');
const { protect, authorize } = require('../middleware/auth');

router.post('/auth/register', requireRegistrationsEnabled, ctrl.register);
router.post('/auth/login', ctrl.login);
router.post('/auth/logout', ctrl.requireLearnFeedUser, ctrl.logout);
router.get('/auth/me', ctrl.requireLearnFeedUser, ctrl.me);
router.post('/auth/link-platform-student', ctrl.requireLearnFeedUser, ctrl.linkPlatformStudent);

router.put('/admin/users/:id/verification', protect, authorize('admin','super_admin'), ctrl.setTeacherVerification);

router.get('/feed', ctrl.listFeed);
router.post('/feed/like', ctrl.requireLearnFeedUser, ctrl.like);
router.post('/feed/save', ctrl.requireLearnFeedUser, ctrl.save);
router.post('/feed/follow', ctrl.requireLearnFeedUser, ctrl.follow);
router.post('/feed/not-interested', ctrl.requireLearnFeedUser, ctrl.notInterested);

router.post('/videos/upload', ctrl.requireLearnFeedUser, ctrl.publishVideo);
router.post('/videos/publish', ctrl.requireLearnFeedUser, ctrl.publishVideo);
router.post('/videos/report', ctrl.requireLearnFeedUser, ctrl.reportVideo);
router.post('/videos/remix', ctrl.requireLearnFeedUser, ctrl.remixVideo);

router.get('/comments', ctrl.listComments);
router.post('/comments/add', ctrl.requireLearnFeedUser, ctrl.addComment);
router.post('/comments/like', ctrl.requireLearnFeedUser, ctrl.likeComment);

router.get('/live/rooms', ctrl.listLiveRooms);
router.post('/live/start', ctrl.requireLearnFeedUser, ctrl.startLive);
router.post('/live/end', ctrl.requireLearnFeedUser, ctrl.endLive);
router.post('/live/chat', ctrl.requireLearnFeedUser, ctrl.liveChat);
router.post('/live/gift', ctrl.requireLearnFeedUser, ctrl.liveGift);

router.get('/sounds', ctrl.listSounds);
router.post('/sounds/use', ctrl.requireLearnFeedUser, ctrl.useSound);
router.post('/ai/ask', ctrl.requireLearnFeedUser, ctrl.askAi);
router.post('/quiz/submit', ctrl.requireLearnFeedUser, ctrl.submitQuiz);

router.get('/messages/inbox', ctrl.requireLearnFeedUser, ctrl.inbox);
router.post('/messages/send', ctrl.requireLearnFeedUser, ctrl.sendMessage);

router.get('/billing/public-plans', ctrl.publicPlans);
router.post('/billing/user-subscription/checkout', ctrl.requireLearnFeedUser, ctrl.checkout);
router.get('/billing/status/:reference', ctrl.requireLearnFeedUser, ctrl.paymentStatus);
router.get('/billing/wallet', ctrl.requireLearnFeedUser, ctrl.wallet);
router.post('/billing/withdraw', ctrl.requireLearnFeedUser, ctrl.withdraw);

module.exports = router;
