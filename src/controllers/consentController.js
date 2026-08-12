const { UserConsent, SchoolDPA, ParentChildConsent } = require('../models');
const ownership = require('../services/parentOwnershipService');

// Accept Terms & Privacy
exports.acceptTerms = async (req, res) => {
  try {
    const { termsAccepted, privacyAccepted } = req.body;
    const [consent] = await UserConsent.upsert({
      userId: req.user.id,
      termsAccepted: termsAccepted === true,
      privacyAccepted: privacyAccepted === true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      acceptedAt: new Date()
    });
    res.json({ success: true, data: consent });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get current consent status
exports.getConsentStatus = async (req, res) => {
  try {
    const consent = await UserConsent.findOne({ where: { userId: req.user.id } });
    res.json({ success: true, data: consent || { termsAccepted: false, privacyAccepted: false } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Accept DPA (admin only)
exports.acceptDPA = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can accept DPA' });
    }
    const [dpa] = await SchoolDPA.upsert({
      schoolId: req.user.schoolCode,
      adminId: req.user.id,
      accepted: true,
      ipAddress: req.ip,
      acceptedAt: new Date()
    });
    res.json({ success: true, data: dpa });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get DPA status
exports.getDPAStatus = async (req, res) => {
  try {
    const dpa = await SchoolDPA.findOne({ 
      where: { schoolId: req.user.schoolCode, adminId: req.user.id } 
    });
    res.json({ success: true, data: { accepted: dpa?.accepted || false } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Give parental consent
exports.giveParentalConsent = async (req, res) => {
  try {
    const studentId = Number(req.body?.studentId);
    if (!Number.isInteger(studentId) || studentId < 1) return res.status(400).json({ success: false, message: 'Valid studentId is required' });
    await ownership.assertParentOwnsStudent({ parentUserId: req.user.id, studentId });
    const [consent] = await ParentChildConsent.upsert({
      parentId: req.user.id,
      studentId,
      consentGiven: true
    });
    res.json({ success: true, data: consent });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};
