const { SchoolNameRequest, School, User } = require('../models');
const { createAlert } = require('../services/notificationService');
const { Op } = require('sequelize');

// @desc    Create a name change request
// @route   POST /api/school/name-change-request
// @access  Private/Admin
exports.createNameChangeRequest = async (req, res) => {
  try {
    const { newName, reason } = req.body;
    
    // Get the admin's school
    const school = await School.findOne({ 
      where: { schoolId: req.user.schoolCode } 
    });
    
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    // Check if there's already a pending request
    const existingRequest = await SchoolNameRequest.findOne({
      where: {
        schoolCode: school.schoolId,
        status: 'pending'
      }
    });

    if (existingRequest) {
      return res.status(400).json({ 
        success: false, 
        message: 'There is already a pending name change request for this school' 
      });
    }

    // Create the request
    const request = await SchoolNameRequest.create({
      schoolCode: school.schoolId,
      currentName: school.name,
      newName: newName,
      reason: reason || 'School name change request',
      requestedBy: req.user.id,
      status: 'pending'
    });

    // Notify all super admins
    const superAdmins = await User.findAll({ where: { role: 'super_admin' } });
    
    for (const admin of superAdmins) {
      await createAlert({
        userId: admin.id,
        role: 'super_admin',
        type: 'approval',
        severity: 'info',
        title: 'New School Name Change Request',
        message: `${school.name} requests to change name to "${newName}"`,
        data: { requestId: request.id, schoolId: school.id }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Name change request submitted successfully',
      data: {
        id: request.id,
        currentName: request.currentName,
        newName: request.newName,
        status: request.status,
        createdAt: request.createdAt
      }
    });
  } catch (error) {
    console.error('Create name change request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get school's name change requests
// @route   GET /api/school/name-change-requests
// @access  Private/Admin
exports.getMyNameChangeRequests = async (req, res) => {
  try {
    const requests = await SchoolNameRequest.findAll({
      where: { schoolCode: req.user.schoolCode },
      order: [['createdAt', 'DESC']]
    });
    
    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Get name change requests error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
