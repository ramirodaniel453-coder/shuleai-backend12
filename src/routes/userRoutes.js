// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const userController = require('../controllers/userController');
const studentController = require('../controllers/studentController'); // Add import

router.use(protect);
router.get('/alerts', userController.getAlerts);
router.get('/stats', userController.getUserStats);
router.put('/profile', userController.updateProfile);
router.get('/preferences', userController.getPreferences);
router.put('/preferences', userController.updatePreferences);
router.get('/export', userController.exportMyData);
router.post('/deactivate', userController.deactivateAccount);
router.post('/profile-picture', userController.uploadProfilePicture);
router.post('/signature', protect, userController.uploadSignature);

// Consent status
router.get('/consent/status', protect, async (req, res) => {
  try {
    const { UserConsent } = require('../models');
    const consent = await UserConsent.findOne({ where: { userId: req.user.id } });
    res.json({ 
      success: true, 
      data: { 
        termsAccepted: consent?.termsAccepted || false,
        privacyAccepted: consent?.privacyAccepted || false,
        dpaAccepted: false
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Student full details (NEW)
router.get('/students/:studentId/details', studentController.getStudentFullDetails);

module.exports = router;
