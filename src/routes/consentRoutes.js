const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const consentController = require('../controllers/consentController');

router.use(protect);

router.get('/status', consentController.getConsentStatus);
router.post('/accept', consentController.acceptTerms);
router.get('/dpa/status', consentController.getDPAStatus);
router.post('/dpa/accept', consentController.acceptDPA);
router.post('/parental-consent', authorize('parent'), consentController.giveParentalConsent);

module.exports = router;
