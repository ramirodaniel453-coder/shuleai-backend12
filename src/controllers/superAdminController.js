const { School, User, Admin, SchoolNameRequest, Student, Teacher, Parent, ApprovalRequest, Alert, SubscriptionPlan, AuditLog, PlatformBackup } = require('../models');
const { createAlert } = require('../services/notificationService');
// Removed self-import bug
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { generateTemporaryPassword } = require('../utils/passwords');
const platformSettings = require('../services/platformSettingsService');
const { clearRegisteredCaches } = require('../services/cacheRegistry');
const { enqueueJob } = require('../services/jobQueue');


function isRealSchoolNameCandidate(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^shule\s*ai$/i.test(text)) return false;
  if (/^shule\s*ai\s*(demo\s*)?school$/i.test(text)) return false;
  if (/^unnamed\s*school$/i.test(text)) return false;
  return true;
}

function resolveOfficialSchoolName(school) {
  const json = school?.toJSON ? school.toJSON() : (school || {});
  const settings = json.settings || {};
  const admins = Array.isArray(json.admins) ? json.admins : [];
  const admin = admins[0] || {};
  const candidates = [
    json.officialSchoolName,
    json.originalSignupName,
    json.signupSchoolName,
    settings.officialSchoolName,
    settings.originalSignupName,
    settings.signupSchoolName,
    settings.organizationName,
    settings.adminOrganizationName,
    settings.schoolName,
    settings.displayName,
    settings.branding?.officialSchoolName,
    settings.branding?.schoolName,
    settings.branding?.displayName,
    settings.profile?.schoolName,
    json.schoolName,
    json.displayName,
    json.name,
    admin.organizationName,
    admin.schoolName,
    admin.name
  ];
  const real = candidates.find(isRealSchoolNameCandidate);
  if (real) return String(real).trim();
  return json.shortCode || json.schoolId ? `School ${json.shortCode || json.schoolId}` : 'Unnamed School';
}

function serializeSchoolForSuperAdmin(school) {
  const json = school?.toJSON ? school.toJSON() : (school || {});
  const officialSchoolName = resolveOfficialSchoolName(json);
  const settings = { ...(json.settings || {}), officialSchoolName };
  return {
    ...json,
    officialSchoolName,
    schoolName: officialSchoolName,
    displayName: officialSchoolName,
    settings
  };
}

// @desc    Get platform overview
// @route   GET /api/super-admin/overview
// @access  Private/SuperAdmin
exports.getOverview = async (req, res) => {
    try {
        const stats = {
            schools: await School.count(),
            pendingSchools: await School.count({ where: { status: 'pending' } }),
            activeSchools: await School.count({ where: { status: 'active' } }),
            students: await Student.count(),
            teachers: await Teacher.count(),
            parents: await Parent.count(),
            pendingApprovals: await ApprovalRequest.count({ where: { status: 'pending' } }),
            users: await User.count()
        };
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Get overview error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all schools
// @route   GET /api/super-admin/schools
// @access  Private/SuperAdmin
// Superseded duplicate export removed: getSchools.

// @desc    Get pending school approvals
// @route   GET /api/super-admin/pending-schools
// @access  Private/SuperAdmin
exports.getPendingSchools = async (req, res) => {
    try {
        const schools = await School.findAll({
            where: { status: 'pending' },
            include: [{
                model: User,
                as: 'admins',
                attributes: ['id', 'name', 'email', 'phone', 'createdAt', 'isActive'],
                required: false
            }],
            order: [['createdAt', 'DESC']]
        });
        
        res.json({ success: true, data: schools.map(serializeSchoolForSuperAdmin) });
    } catch (error) {
        console.error('Get pending schools error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Approve school - FIXED VERSION
// @route   POST /api/super-admin/schools/:id/approve
// @access  Private/SuperAdmin
exports.approveSchool = async (req, res) => {
    try {
        const { id } = req.params;
        const school = await School.findByPk(id);
        
        if (!school) {
            return res.status(404).json({ success: false, message: 'School not found' });
        }

        // Update school status
        school.status = 'active';
        school.isActive = true;
        school.approvedBy = req.user.id;
        school.approvedAt = new Date();
        await school.save();

        console.log(`✅ School ${school.name} (${school.schoolId}) approved`);

        // Activate ALL admin users for this school
        const [updatedCount] = await User.update(
            { 
                isActive: true,
                // Also update any other relevant fields
                isApproved: true
            },
            { 
                where: { 
                    schoolCode: school.schoolId, 
                    role: 'admin' 
                } 
            }
        );
        
        console.log(`✅ Activated ${updatedCount} admin users for school ${school.name}`);

        // Get updated admin users
        const admins = await User.findAll({ 
            where: { 
                schoolCode: school.schoolId, 
                role: 'admin' 
            } 
        });
        
        console.log(`📧 Sending notifications to ${admins.length} admins`);

        // Send notifications
        for (const admin of admins) {
            await createAlert({
                userId: admin.id,
                role: 'admin',
                type: 'system',
                severity: 'success',
                title: 'School Approved',
                message: `Your school "${school.name}" has been approved! You can now log in.`,
                data: { schoolId: school.id }
            });
            
            console.log(`✅ Alert sent to admin: ${admin.email}`);
        }

        res.json({ 
            success: true, 
            message: 'School approved successfully',
            data: {
                school: {
                    id: school.id,
                    name: school.name,
                    schoolId: school.schoolId,
                    shortCode: school.shortCode,
                    status: school.status,
                    isActive: school.isActive
                },
                activatedAdmins: updatedCount
            }
        });
    } catch (error) {
        console.error('Approve school error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reject school
// @route   POST /api/super-admin/schools/:id/reject
// @access  Private/SuperAdmin
exports.rejectSchool = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        
        const school = await School.findByPk(id);
        
        if (!school) {
            return res.status(404).json({ success: false, message: 'School not found' });
        }

        school.status = 'rejected';
        school.rejectionReason = reason;
        school.approvedBy = req.user.id;
        school.approvedAt = new Date();
        school.isActive = false;
        await school.save();

        // Get admin users
        const admins = await User.findAll({ 
            where: { schoolCode: school.schoolId, role: 'admin' } 
        });
        
        for (const admin of admins) {
            await createAlert({
                userId: admin.id,
                role: 'admin',
                type: 'system',
                severity: 'error',
                title: 'School Registration Rejected',
                message: `Your school registration was rejected. Reason: ${reason || 'Not specified'}`,
                data: { schoolId: school.id }
            });
        }

        res.json({ 
            success: true, 
            message: 'School rejected',
            data: school
        });
    } catch (error) {
        console.error('Reject school error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Create a new school (manual by super admin)
// @route   POST /api/super-admin/schools
// @access  Private/SuperAdmin
exports.createSchool = async (req, res) => {
    try {
        const { name, system, address, contact, adminEmail, adminName, adminPassword } = req.body;
        
        const school = await School.create({
            name,
            system: system || 'cbc',
            address,
            contact,
            status: 'active', // Auto-active when created by super admin
            isActive: true,
            createdBy: req.user.id
        });

        // Create admin for the school
        const adminUser = await User.create({
            name: adminName || `Admin ${school.name}`,
            email: adminEmail || `admin@${school.shortCode.toLowerCase()}.edu`,
            password: adminPassword || generateTemporaryPassword(),
            role: 'admin',
            schoolCode: school.schoolId,
            isActive: true
        });

        await Admin.create({
            userId: adminUser.id,
            position: 'School Administrator',
            managedSchools: [school.id]
        });

        res.status(201).json({ 
            success: true, 
            message: 'School created successfully',
            data: { 
                school,
                admin: adminUser.getPublicProfile(),
                shortCode: school.shortCode
            } 
        });
    } catch (error) {
        console.error('Create school error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update a school
// @route   PUT /api/super-admin/schools/:id
// @access  Private/SuperAdmin
exports.updateSchool = async (req, res) => {
    try {
        const { id } = req.params;
        const school = await School.findByPk(id);
        if (!school) return res.status(404).json({ success: false, message: 'School not found' });

        await school.update(req.body);
        res.json({ success: true, data: school });
    } catch (error) {
        console.error('Update school error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete a school (cascade)
// @route   DELETE /api/super-admin/schools/:id
// @access  Private/SuperAdmin
exports.deleteSchool = async (req, res) => {
    try {
        const { id } = req.params;
        const school = await School.findByPk(id);
        if (!school) return res.status(404).json({ success: false, message: 'School not found' });

        // Delete all related users (cascade handled by associations if set)
        await User.destroy({ where: { schoolCode: school.schoolId } });
        await school.destroy();

        res.json({ success: true, message: 'School deleted' });
    } catch (error) {
        console.error('Delete school error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get pending school name requests
// @route   GET /api/super-admin/requests
// @access  Private/SuperAdmin
exports.getPendingRequests = async (req, res) => {
    try {
        const requests = await SchoolNameRequest.findAll({
            where: { status: 'pending' },
            include: [
                { model: User, attributes: ['name', 'email'] },
                { model: School, attributes: ['name', 'schoolId'] }
            ]
        });
        res.json({ success: true, data: requests });
    } catch (error) {
        console.error('Get pending requests error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get reviewed school name request history
// @route   GET /api/super-admin/requests/history
// @access  Private/SuperAdmin
exports.getRequestHistory = async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const requests = await SchoolNameRequest.findAll({
      where: { status: { [Op.ne]: 'pending' } },
      include: [
        { model: User, attributes: ['name', 'email'] },
        { model: School, attributes: ['name', 'schoolId'] }
      ],
      order: [['reviewedAt','DESC'], ['updatedAt','DESC']],
      limit
    });
    res.json({ success:true, data:requests });
  } catch (error) {
    console.error('Get request history error:', error);
    res.status(500).json({ success:false, message:error.message });
  }
};

// @desc    Approve a school name request
// @route   POST /api/super-admin/requests/:id/approve
// @access  Private/SuperAdmin
exports.approveRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const request = await SchoolNameRequest.findByPk(id);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        const school = await School.findOne({ where: { schoolId: request.schoolCode } });
        if (school) {
            school.name = request.newName;
            await school.save();
        }

        request.status = 'approved';
        request.reviewedBy = req.user.id;
        request.reviewedAt = new Date();
        await request.save();

        await createAlert({
            userId: request.requestedBy,
            role: 'admin',
            type: 'system',
            severity: 'success',
            title: 'School Name Approved',
            message: `Your request to change school name to "${request.newName}" has been approved.`
        });

        if (global.io) {
          global.io.to(`school-${school.schoolId}`).emit('school-name-changed', {
            newName: school.name,
            schoolId: school.schoolId
          });
        }

        res.json({ success: true, message: 'Request approved' });
    } catch (error) {
        console.error('Approve request error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reject a school name request
// @route   POST /api/super-admin/requests/:id/reject
// @access  Private/SuperAdmin
exports.rejectRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const request = await SchoolNameRequest.findByPk(id);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        request.status = 'rejected';
        request.rejectionReason = reason;
        request.reviewedBy = req.user.id;
        request.reviewedAt = new Date();
        await request.save();

        await createAlert({
            userId: request.requestedBy,
            role: 'admin',
            type: 'system',
            severity: 'warning',
            title: 'School Name Request Rejected',
            message: `Your request to change school name was rejected. Reason: ${reason || 'Not specified'}`
        });

        res.json({ success: true, message: 'Request rejected' });
    } catch (error) {
        console.error('Reject request error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update bank details for a school
// @route   PUT /api/super-admin/bank-details/:schoolId
// @access  Private/SuperAdmin
exports.updateBankDetails = async (req, res) => {
    try {
        const { schoolId } = req.params;
        const school = await School.findByPk(schoolId);
        if (!school) return res.status(404).json({ success: false, message: 'School not found' });

        school.bankDetails = req.body;
        await school.save();

        res.json({ success: true, data: school.bankDetails });
    } catch (error) {
        console.error('Update bank details error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Suspend a school
// @route   POST /api/super-admin/schools/:id/suspend
// @access  Private/SuperAdmin
exports.suspendSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const school = await School.findByPk(id);
    
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    // Update school status
    school.status = 'suspended';
    school.isActive = false;
    school.suspendedAt = new Date();
    school.suspendedBy = req.user.id;
    school.suspensionReason = reason || 'No reason provided';
    await school.save();

    // Deactivate all users from this school
    await User.update(
      { isActive: false },
      { where: { schoolCode: school.schoolId } }
    );

    // Notify all admins of the school
    const admins = await User.findAll({ 
      where: { schoolCode: school.schoolId, role: 'admin' } 
    });
    
    for (const admin of admins) {
      await createAlert({
        userId: admin.id,
        role: 'admin',
        type: 'system',
        severity: 'critical',
        title: 'School Suspended',
        message: `Your school "${school.name}" has been suspended. Reason: ${reason || 'No reason provided'}. Please contact support.`,
        data: { schoolId: school.id }
      });
    }

    // Notify super admins about the suspension
    const superAdmins = await User.findAll({ where: { role: 'super_admin' } });
    for (const sa of superAdmins) {
      if (sa.id !== req.user.id) {
        await createAlert({
          userId: sa.id,
          role: 'super_admin',
          type: 'system',
          severity: 'warning',
          title: 'School Suspended',
          message: `${school.name} has been suspended by ${req.user.name}`,
          data: { schoolId: school.id }
        });
      }
    }

    res.json({ 
      success: true, 
      message: 'School suspended successfully',
      data: {
        id: school.id,
        name: school.name,
        status: school.status,
        suspensionReason: school.suspensionReason,
        suspendedAt: school.suspendedAt
      }
    });
  } catch (error) {
    console.error('Suspend school error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to suspend school' 
    });
  }
};

// @desc    Reactivate a suspended school
// @route   POST /api/super-admin/schools/:id/reactivate
// @access  Private/SuperAdmin
exports.reactivateSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const school = await School.findByPk(id);
    
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    if (school.status !== 'suspended') {
      return res.status(400).json({ 
        success: false, 
        message: 'School is not currently suspended' 
      });
    }

    // Update school status
    school.status = 'active';
    school.isActive = true;
    school.reactivatedAt = new Date();
    school.reactivatedBy = req.user.id;
    school.reactivationReason = reason || 'School reactivated';
    await school.save();

    // Reactivate admin users only
    await User.update(
      { isActive: true },
      { where: { schoolCode: school.schoolId, role: 'admin' } }
    );

    // Notify admins
    const admins = await User.findAll({ 
      where: { schoolCode: school.schoolId, role: 'admin' } 
    });
    
    for (const admin of admins) {
      await createAlert({
        userId: admin.id,
        role: 'admin',
        type: 'system',
        severity: 'success',
        title: 'School Reactivated',
        message: `Your school "${school.name}" has been reactivated. You can now log in and manage your school.`,
        data: { schoolId: school.id }
      });
    }

    res.json({ 
      success: true, 
      message: 'School reactivated successfully',
      data: {
        id: school.id,
        name: school.name,
        status: school.status,
        reactivatedAt: school.reactivatedAt
      }
    });
  } catch (error) {
    console.error('Reactivate school error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to reactivate school' 
    });
  }
};

// @desc    Get all suspended schools
// @route   GET /api/super-admin/suspended-schools
// @access  Private/SuperAdmin
exports.getSuspendedSchools = async (req, res) => {
  try {
    const schools = await School.findAll({
      where: { status: 'suspended' },
      include: [{
        model: User,
        as: 'admins',
        attributes: ['id', 'name', 'email'],
        required: false
      }],
      order: [['suspendedAt', 'DESC']]
    });
    
    res.json({ success: true, data: schools.map(serializeSchoolForSuperAdmin) });
  } catch (error) {
    console.error('Get suspended schools error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add these functions to your superAdminController.js

// @desc    Get teachers for a specific school
// @route   GET /api/super-admin/schools/:schoolId/teachers
// @access  Private/SuperAdmin
exports.getSchoolTeachers = async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    // Find the school first to get the schoolCode
    const school = await School.findByPk(schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }
    
    const teachers = await Teacher.findAll({
      include: [{
        model: User,
        where: { schoolCode: school.schoolId, role: 'teacher' },
        attributes: ['id', 'name', 'email', 'phone']
      }],
      where: { approvalStatus: 'approved' }
    });
    
    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('Get school teachers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get students for a specific school
// @route   GET /api/super-admin/schools/:schoolId/students
// @access  Private/SuperAdmin
exports.getSchoolStudents = async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    const school = await School.findByPk(schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }
    
    const students = await Student.findAll({
      include: [{
        model: User,
        where: { schoolCode: school.schoolId, role: 'student' },
        attributes: ['id', 'name', 'email', 'phone']
      }]
    });
    
    res.json({ success: true, data: students });
  } catch (error) {
    console.error('Get school students error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get parents for a specific school
// @route   GET /api/super-admin/schools/:schoolId/parents
// @access  Private/SuperAdmin
exports.getSchoolParents = async (req, res) => {
  try {
    const { schoolId } = req.params;
    
    const school = await School.findByPk(schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }
    
    const parents = await Parent.findAll({
      include: [{
        model: User,
        where: { schoolCode: school.schoolId, role: 'parent' },
        attributes: ['id', 'name', 'email', 'phone']
      }]
    });
    
    res.json({ success: true, data: parents });
  } catch (error) {
    console.error('Get school parents error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get system status
// @route   GET /api/super-admin/system/status
// @access  Private/SuperAdmin
exports.getSystemStatus = async (req, res) => {
  try {
    // Check database connection
    let databaseStatus = 'operational';
    let databaseLastCheck = new Date();
    try {
      await sequelize.authenticate();
    } catch (dbError) {
      databaseStatus = 'error';
      console.error('Database check failed:', dbError);
    }
    
    // Check API status (always operational if we're here)
    const apiStatus = 'operational';
    const apiLatency = Date.now() - (req._startAt || Date.now())
    
    // Check WebSocket (if you have socket.io)
    let websocketStatus = 'connected';
    let activeConnections = 0;
    if (global.io) {
      const connectedSockets = await global.io.fetchSockets();
      activeConnections = connectedSockets.length;
    } else {
      websocketStatus = 'disconnected';
    }
    
    res.json({
      success: true,
      data: {
        database: databaseStatus,
        databaseLastCheck,
        api: apiStatus,
        apiLatency,
        websocket: websocketStatus,
        activeConnections,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('Get system status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get system metrics
// @route   GET /api/super-admin/system/metrics
// @access  Private/SuperAdmin
exports.getSystemMetrics = async (req, res) => {
  try {
    const os = require('os');
    const cpuSnapshot = () => os.cpus().map(cpu => ({ idle: cpu.times.idle, total: Object.values(cpu.times).reduce((sum, value) => sum + value, 0) }));
    const before = cpuSnapshot();
    await new Promise(resolve => setTimeout(resolve, 100));
    const after = cpuSnapshot();
    let idleDelta = 0, totalDelta = 0;
    for (let i = 0; i < Math.min(before.length, after.length); i += 1) { idleDelta += after[i].idle - before[i].idle; totalDelta += after[i].total - before[i].total; }
    const cpuUsage = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
    const [load1, load5, load15] = os.loadavg();
    const totalMem = os.totalmem() / (1024 ** 3);
    const freeMem = os.freemem() / (1024 ** 3);
    const usedMem = totalMem - freeMem;
    const memoryUsage = totalMem ? (usedMem / totalMem) * 100 : 0;
    let storageUsed = 0;
    try { const [results] = await sequelize.query('SELECT pg_database_size(current_database()) as size'); storageUsed = Number(results[0]?.size || 0) / (1024 ** 3); }
    catch (dbError) { console.error('Failed to get database size:', dbError); }
    res.json({ success:true, data:{ cpuUsage:Math.round(cpuUsage), load1:Number(load1.toFixed(2)), load5:Number(load5.toFixed(2)), load15:Number(load15.toFixed(2)), cpuCount:os.cpus().length, memoryUsage:Math.round(memoryUsage), memoryUsed:Number(usedMem.toFixed(1)), memoryTotal:Number(totalMem.toFixed(1)), storageUsed:Number(storageUsed.toFixed(2)), storageTotal:null, storagePercent:null, uptime:os.uptime(), timestamp:new Date() } });
  } catch (error) { console.error('Get system metrics error:', error); res.status(500).json({ success:false, message:error.message }); }
};

// @desc    Get recent system events
// @route   GET /api/super-admin/system/events
// @access  Private/SuperAdmin
exports.getRecentEvents = async (req, res, next) => {
  try {
    // Get recent alerts and events from database
    const events = await Alert.findAll({
      where: { role: 'super_admin' },
      order: [['createdAt', 'DESC']],
      limit: 20
    });
    
    // Format events
    const formattedEvents = events.map(event => ({
      id: event.id,
      type: event.type,
      title: event.title,
      description: event.message,
      timestamp: event.createdAt
    }));
    
    res.json({
      success: true,
      data: formattedEvents
    });
  } catch (error) {
    console.error('Get recent events error:', error);
    return next(error);
  }
};

// @desc    Get platform settings
// @route   GET /api/super-admin/platform-settings
// @access  Private/SuperAdmin
exports.getPlatformSettings = async (req, res, next) => {
  try { return res.json({ success:true, data:await platformSettings.getPlatformSettings({ fresh:true }) }); }
  catch (error) { return next(error); }
};

exports.updatePlatformSettings = async (req, res, next) => {
  try {
    const data = await platformSettings.updatePlatformSettings(req.body, req.user, { ip:req.ip, userAgent:req.get('user-agent') });
    return res.json({ success:true, message:'Settings updated successfully', data });
  } catch (error) { if (error.status) return res.status(error.status).json({success:false,message:error.message}); return next(error); }
};

exports.resetPlatformSettings = async (req, res, next) => {
  try {
    const data = await platformSettings.resetPlatformSettings(req.user, { ip:req.ip, userAgent:req.get('user-agent') });
    return res.json({ success:true, message:'Settings reset to default', data });
  } catch (error) { return next(error); }
};

exports.runSystemBackup = async (req, res, next) => {
  try {
    const backup = await PlatformBackup.create({ status:'queued', requestedBy:req.user.id });
    const job = await enqueueJob('database-backup', { platformJob:true, backupId:backup.id }, req.user);
    await backup.update({ jobId:job.id });
    await AuditLog.create({ schoolCode:null, actorUserId:req.user.id, actorRole:req.user.role, module:'platform', action:'platform.backup.queued', entityType:'PlatformBackup', entityId:String(backup.id), after:{jobId:job.id,status:'queued'}, ipAddress:req.ip, userAgent:req.get('user-agent') });
    return res.status(202).json({ success:true, message:'Backup queued. Completion is recorded only after archive verification and durable upload.', data:{ backupId:backup.id, jobId:job.id, status:'queued' } });
  } catch (error) { return next(error); }
};

exports.clearPlatformCache = async (req, res, next) => {
  try {
    const result = await clearRegisteredCaches();
    await AuditLog.create({ schoolCode:null, actorUserId:req.user.id, actorRole:req.user.role, module:'platform', action:'platform.cache.clear', entityType:'Cache', entityId:null, after:result, ipAddress:req.ip, userAgent:req.get('user-agent') });
    if (result.failed) return res.status(503).json({ success:false, message:'Some cache namespaces could not be cleared.', data:result });
    return res.json({ success:true, message:'Platform cache cleared successfully', data:result });
  } catch (error) { return next(error); }
};

exports.exportPlatformData = async (req, res, next) => {
  try {
    const [schools, users, teachers, students, parents] = await Promise.all([
      School.findAll(),
      User.findAll({ attributes:{ exclude:['password','passwordIssuedAt','tokenVersion'] }, order:[['id','ASC']] }),
      Teacher.findAll(), Student.findAll(), Parent.findAll()
    ]);
    const exportData = { exportedAt:new Date(), version:'2.0', data:{ schools, users, teachers, students, parents } };
    await AuditLog.create({ schoolCode:null, actorUserId:req.user.id, actorRole:req.user.role, module:'platform', action:'platform.export', entityType:'PlatformExport', entityId:null, after:{ schools:schools.length, users:users.length, teachers:teachers.length, students:students.length, parents:parents.length }, ipAddress:req.ip, userAgent:req.get('user-agent') });
    return res.json({ success:true, data:exportData });
  } catch (error) { return next(error); }
};

// ============================================
// HELP SYSTEM ENDPOINTS
// ============================================

// @desc    Get help articles for a role
// @route   GET /api/help/articles/:role
// @access  Public/All users
exports.getHelpArticles = async (req, res) => {
  try {
    const { role } = req.params;
    
    // Help articles database (stored in database or config)
    const helpArticles = {
      superadmin: [
        {
          id: 'sa-1',
          title: 'How to approve a new school',
          content: 'Go to School Approvals, review school details, click Approve. The school will be activated immediately.',
          keywords: ['approve', 'school', 'activate', 'registration'],
          category: 'schools',
          steps: [
            'Navigate to School Approvals section',
            'Review the school details and admin information',
            'Click the Approve button',
            'Confirm the approval'
          ]
        },
        {
          id: 'sa-2',
          title: 'How to suspend a school',
          content: 'Find the school in Schools list, click the suspend button, enter reason. All users will be locked out.',
          keywords: ['suspend', 'block', 'deactivate', 'school'],
          category: 'schools',
          steps: [
            'Go to Schools section',
            'Find the school you want to suspend',
            'Click the suspend button (pause icon)',
            'Enter a reason for suspension',
            'Confirm the suspension'
          ]
        },
        {
          id: 'sa-3',
          title: 'How to change platform name',
          content: 'Go to Platform Settings, enter new name, click Save. Changes appear in emails and headers.',
          keywords: ['name', 'platform', 'rename', 'settings'],
          category: 'settings',
          steps: [
            'Navigate to Platform Settings',
            'Enter the new platform name',
            'Click Save Settings',
            'Refresh to see changes'
          ]
        },
        {
          id: 'sa-4',
          title: 'How to view platform health',
          content: 'Go to Platform Health to see system status, CPU usage, memory usage, and recent events.',
          keywords: ['health', 'status', 'monitor', 'performance', 'cpu', 'memory'],
          category: 'system',
          steps: [
            'Go to Platform Health section',
            'View system status indicators',
            'Check CPU and memory usage charts',
            'Review recent events log'
          ]
        },
        {
          id: 'sa-5',
          title: 'How to manage name change requests',
          content: 'Review name change requests in the Name Changes section. Approve or reject based on payment verification.',
          keywords: ['name', 'change', 'request', 'approve', 'reject'],
          category: 'requests',
          steps: [
            'Go to Name Change Requests',
            'Review the request details',
            'Check if payment has been made',
            'Click Approve or Reject',
            'Add reason if rejecting'
          ]
        }
      ],
      admin: [
        {
          id: 'admin-1',
          title: 'How to add a student',
          content: 'Go to Students, click Add Student, fill in details. The student receives an ELIMUID automatically.',
          keywords: ['add', 'student', 'create', 'enroll'],
          category: 'students',
          steps: [
            'Navigate to Students section',
            'Click Add Student button',
            'Fill in student details (name, grade, parent email)',
            'Click Save',
            'Student receives ELIMUID automatically'
          ]
        },
        {
          id: 'admin-2',
          title: 'How to approve a teacher',
          content: 'Go to Teacher Approvals, review teacher details, click Approve or Reject.',
          keywords: ['teacher', 'approve', 'hire', 'staff'],
          category: 'teachers',
          steps: [
            'Go to Teacher Approvals',
            'Review teacher information',
            'Check qualifications and subjects',
            'Click Approve to accept, or Reject with reason'
          ]
        },
        {
          id: 'admin-3',
          title: 'How to generate duty roster',
          content: 'Go to Duty Management, select dates, click Generate Roster. The system assigns duties based on points.',
          keywords: ['duty', 'roster', 'schedule', 'generate', 'assign'],
          category: 'duty',
          steps: [
            'Go to Duty Management',
            'Select start and end dates',
            'Click Generate New Roster',
            'Review the generated schedule',
            'Adjust manually if needed'
          ]
        },
        {
          id: 'admin-4',
          title: 'How to change curriculum',
          content: 'Go to Settings, select new curriculum, click Save. All users will see updated grading.',
          keywords: ['curriculum', 'cbc', '844', 'british', 'american', 'change'],
          category: 'settings',
          steps: [
            'Navigate to School Settings',
            'Find Curriculum Settings section',
            'Select the new curriculum',
            'Click Save Changes',
            'All users will see updated grading'
          ]
        },
        {
          id: 'admin-5',
          title: 'How to manage classes',
          content: 'Go to Class Management to create classes and assign teachers.',
          keywords: ['class', 'create', 'assign', 'teacher'],
          category: 'classes',
          steps: [
            'Go to Class Management',
            'Click Add New Class',
            'Enter class name, grade, and stream',
            'Assign a class teacher',
            'Students can now be enrolled'
          ]
        }
      ],
      teacher: [
        {
          id: 'teacher-1',
          title: 'How to take attendance',
          content: 'Go to Attendance, mark each student as Present/Absent/Late, add notes, click Save Attendance.',
          keywords: ['attendance', 'present', 'absent', 'mark', 'register'],
          category: 'attendance',
          steps: [
            'Go to Attendance section',
            'Select date if not today',
            'Mark status for each student',
            'Add notes if needed',
            'Click Save Attendance'
          ]
        },
        {
          id: 'teacher-2',
          title: 'How to enter grades',
          content: 'Go to Grades, select subject and assessment type, enter scores, click Save.',
          keywords: ['grade', 'mark', 'score', 'exam', 'test', 'enter'],
          category: 'grades',
          steps: [
            'Go to Grades section',
            'Select subject from dropdown',
            'Select assessment type',
            'Enter scores for each student',
            'Click Save for each student'
          ]
        },
        {
          id: 'teacher-3',
          title: 'How to check in for duty',
          content: 'Go to Dashboard, find Duty Card, click Check In when on duty.',
          keywords: ['duty', 'checkin', 'check in', 'responsibility'],
          category: 'duty',
          steps: [
            'Go to Dashboard',
            'Find Today\'s Duty card',
            'Click Check In button when you arrive',
            'Click Check Out when duty ends'
          ]
        },
        {
          id: 'teacher-4',
          title: 'How to communicate with parents',
          content: 'Check the Parent Messages section for messages. Click to reply.',
          keywords: ['message', 'parent', 'communicate', 'reply'],
          category: 'communication',
          steps: [
            'Go to Dashboard',
            'Check Parent Messages inbox',
            'Click on any message to open',
            'Type your reply',
            'Click Send'
          ]
        }
      ],
      parent: [
        {
          id: 'parent-1',
          title: 'How to view child progress',
          content: 'Select your child from the top, view grades, attendance, and teacher comments.',
          keywords: ['progress', 'grades', 'attendance', 'child', 'performance'],
          category: 'progress',
          steps: [
            'Select your child from the tabs',
            'View grades in the Recent Grades table',
            'Check attendance rate',
            'Review teacher comments if any'
          ]
        },
        {
          id: 'parent-2',
          title: 'How to report absence',
          content: 'Click Report Absence, select date, enter reason, submit. Teacher will be notified.',
          keywords: ['absence', 'absent', 'report', 'sick', 'leave'],
          category: 'attendance',
          steps: [
            'Find Report Absence section',
            'Select the date of absence',
            'Enter the reason',
            'Click Report Absence',
            'Teacher receives notification'
          ]
        },
        {
          id: 'parent-3',
          title: 'How to make payment',
          content: 'Go to Payments, select child, choose plan, enter amount, complete payment.',
          keywords: ['payment', 'pay', 'fee', 'school fees', 'money'],
          category: 'payments',
          steps: [
            'Go to Payments section',
            'Select your child',
            'Choose subscription plan',
            'Enter amount',
            'Select payment method',
            'Click Pay Now'
          ]
        }
      ],
      student: [
        {
          id: 'student-1',
          title: 'How to view my grades',
          content: 'Go to My Grades to see all your scores and performance.',
          keywords: ['grade', 'score', 'result', 'performance'],
          category: 'grades',
          steps: [
            'Click on My Grades in sidebar',
            'View all your subjects and scores',
            'See grade letters and percentages'
          ]
        },
        {
          id: 'student-2',
          title: 'How to use AI Tutor',
          content: 'Type your question in AI Tutor chat, get instant help with any subject.',
          keywords: ['ai', 'tutor', 'help', 'question', 'assistant'],
          category: 'learning',
          steps: [
            'Go to AI Tutor section',
            'Type your question in the chat box',
            'Press Enter or click Ask',
            'Get instant AI-generated answers'
          ]
        },
        {
          id: 'student-3',
          title: 'How to join study groups',
          content: 'Go to Study Chat to connect with other students and study together.',
          keywords: ['study', 'chat', 'group', 'discussion'],
          category: 'collaboration',
          steps: [
            'Go to Study Chat section',
            'Join an existing group',
            'Start chatting with peers',
            'Share study materials'
          ]
        }
      ]
    };
    
    // Get articles for the role, or return all if role not found
    const articles = helpArticles[role] || helpArticles.admin;
    
    res.json({
      success: true,
      data: articles
    });
  } catch (error) {
    console.error('Get help articles error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Search help articles
// @route   POST /api/help/search
// @access  Public/All users
exports.searchHelpArticles = async (req, res) => {
  try {
    const { query, role } = req.body;
    
    if (!query) {
      return res.json({ success: true, data: [] });
    }
    
    const helpArticles = {
      superadmin: [
        { title: 'How to approve a new school', content: 'Go to School Approvals...', keywords: ['approve', 'school'] },
        { title: 'How to suspend a school', content: 'Find school in Schools list...', keywords: ['suspend', 'block'] }
      ],
      admin: [
        { title: 'How to add a student', content: 'Go to Students, click Add Student...', keywords: ['add', 'student'] },
        { title: 'How to approve a teacher', content: 'Go to Teacher Approvals...', keywords: ['teacher', 'approve'] }
      ],
      teacher: [
        { title: 'How to take attendance', content: 'Go to Attendance...', keywords: ['attendance', 'present'] },
        { title: 'How to enter grades', content: 'Go to Grades...', keywords: ['grade', 'mark'] }
      ],
      parent: [
        { title: 'How to view child progress', content: 'Select child from tabs...', keywords: ['progress', 'grades'] },
        { title: 'How to report absence', content: 'Click Report Absence...', keywords: ['absence', 'report'] }
      ],
      student: [
        { title: 'How to view my grades', content: 'Go to My Grades...', keywords: ['grade', 'score'] },
        { title: 'How to use AI Tutor', content: 'Type question in AI Tutor...', keywords: ['ai', 'tutor'] }
      ]
    };
    
    const articles = helpArticles[role] || helpArticles.admin;
    const searchTerm = query.toLowerCase();
    
    const results = articles.filter(article => {
      return article.title.toLowerCase().includes(searchTerm) ||
             article.content.toLowerCase().includes(searchTerm) ||
             article.keywords.some(k => k.toLowerCase().includes(searchTerm));
    });
    
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Search help articles error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get growth data for charts
// @route   GET /api/super-admin/growth-data
exports.getGrowthData = async (req, res) => {
  try {
    const schools = await School.findAll({
      attributes: ['createdAt'],
      order: [['createdAt', 'ASC']]
    });
    
    // Group by month
    const monthly = {};
    schools.forEach(s => {
      const month = s.createdAt.toISOString().slice(0, 7);
      monthly[month] = (monthly[month] || 0) + 1;
    });
    
    const labels = Object.keys(monthly).sort();
    const values = labels.map(m => monthly[m]);
    
    res.json({ success: true, data: { labels, values } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get school distribution by level
// @route   GET /api/super-admin/school-distribution
exports.getSchoolDistribution = async (req, res) => {
  try {
    const schools = await School.findAll({
      attributes: ['settings']
    });
    
    const distribution = { primary: 0, secondary: 0, both: 0 };
    schools.forEach(s => {
      const level = s.settings?.schoolLevel || 'secondary';
      if (level === 'primary') distribution.primary++;
      else if (level === 'secondary') distribution.secondary++;
      else if (level === 'both') distribution.both++;
    });
    
    res.json({ 
      success: true, 
      data: { 
        labels: ['Primary', 'Secondary', 'Both'],
        values: [distribution.primary, distribution.secondary, distribution.both]
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSubscriptionPlan = async (req, res) => {
  const { planId, price, features } = req.body;
  const plan = await SubscriptionPlan.findByPk(planId);
  if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
  await plan.update({ price_kes: price, features });
  res.json({ success: true, data: plan });
};

// ============ V102 PILOT/TRIAL/PAID ACCESS + PRIVATE SCHOOL DETAIL ============
const { computeSchoolAccess } = require('../services/schoolAccessEngine');
const curriculumStructureEngine = require('../services/curriculumStructureEngine');

async function v102Audit({ schoolCode=null, actorUserId=null, actorRole='super_admin', module, action, entityType, entityId, before={}, after={}, metadata={} }) {
  await sequelize.query(`
    INSERT INTO "PlatformAuditEvents" ("schoolCode","actorUserId","actorRole","module","action","entityType","entityId","before","after","metadata","createdAt","updatedAt")
    VALUES (:schoolCode,:actorUserId,:actorRole,:module,:action,:entityType,:entityId,:before,:after,:metadata,NOW(),NOW())
  `, { replacements:{ schoolCode, actorUserId, actorRole, module, action, entityType, entityId:String(entityId || ''), before:JSON.stringify(before || {}), after:JSON.stringify(after || {}), metadata:JSON.stringify(metadata || {}) } }).catch(() => null);
}

async function v102RecalculateSchoolAccess(school) {
  const access = computeSchoolAccess(school);
  school.accessMode = access.accessMode;
  school.accessStatus = access.accessStatus;
  await school.save();
  return access;
}

exports.getSchoolPrivateDetail = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findByPk(schoolId, {
      include: [{ model: User, as: 'admins', attributes:['id','name','email','phone','isActive'], required:false }]
    });
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const schoolCode = school.schoolId;
    const [studentCount, teacherCount, parentCount, classCount, subjectRows, paymentRequests] = await Promise.all([
      Student.count({ include:[{ model:User, where:{ schoolCode, role:'student' } }] }),
      Teacher.count({ include:[{ model:User, where:{ schoolCode, role:'teacher' } }] }),
      Parent.count({ include:[{ model:User, where:{ schoolCode, role:'parent' } }] }),
      sequelize.models.Class ? sequelize.models.Class.count({ where:{ schoolCode, isActive:true } }).catch(() => 0) : Promise.resolve(0),
      sequelize.query(`SELECT COUNT(*)::int AS count FROM "TeacherSubjectAssignments" tsa JOIN "Classes" c ON c.id = tsa."classId" WHERE c."schoolCode" = :schoolCode`, { replacements:{ schoolCode } }).then(([r]) => Number(r?.[0]?.count || 0)).catch(() => 0),
      sequelize.query(`SELECT * FROM "SchoolPaymentRequests" WHERE "schoolCode" = :schoolCode ORDER BY "createdAt" DESC LIMIT 20`, { replacements:{ schoolCode } }).then(([r]) => r).catch(() => [])
    ]);
    const access = await v102RecalculateSchoolAccess(school);
    const cfg = curriculumStructureEngine.getCurriculumConfig(school);
    const levelCount = curriculumStructureEngine.getAllowedLevelsForSchool(school).length;
    const setupSteps = [
      !!school.status && school.status !== 'pending',
      !!cfg.curriculum,
      levelCount > 0,
      (cfg.schoolSubjects || []).length > 0,
      classCount > 0,
      teacherCount > 0,
      studentCount > 0,
      !!school.settings?.branding?.logoUrl || !!school.settings?.logoUrl || !!school.settings?.schoolLogo
    ];
    const setupProgress = Math.round((setupSteps.filter(Boolean).length / setupSteps.length) * 100);
    res.json({ success:true, data:{
      school: { ...school.toJSON(), access },
      privateStats: { students:studentCount, teachers:teacherCount, parents:parentCount, classes:classCount, subjects:subjectRows, setupProgress },
      curriculum: { config:cfg, levels:curriculumStructureEngine.getAllowedLevelsForSchool(school), schoolSubjects:cfg.schoolSubjects || [] },
      paymentRequests
    }});
  } catch(error) { console.error('V102 school private detail error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.updateSchoolAccessControls = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findByPk(schoolId);
    if (!school) return res.status(404).json({ success:false, message:'School not found' });
    const before = school.toJSON();
    const body = req.body || {};
    const boolFields = ['pilotFullAccessEnabled','trialAccessEnabled','manualPaymentConfirmed'];
    for (const field of boolFields) if (body[field] !== undefined) school[field] = !!body[field];
    if (body.pilotFullAccessEnabled === true && !school.pilotStartedAt) school.pilotStartedAt = new Date();
    if (body.pilotEndsAt !== undefined) school.pilotEndsAt = body.pilotEndsAt || null;
    if (body.pilotFullAccessEnabled !== undefined) school.pilotEnabledBy = req.user.id;
    if (body.trialAccessEnabled === true && !school.trialStartedAt) school.trialStartedAt = new Date();
    if (body.trialEndsAt !== undefined) school.trialEndsAt = body.trialEndsAt || null;
    if (body.manualPaymentConfirmed === true) {
      school.manualPaymentConfirmedBy = req.user.id;
      school.manualPaymentConfirmedAt = new Date();
    }
    if (body.manualPaymentAmount !== undefined) school.manualPaymentAmount = Number(body.manualPaymentAmount || 0);
    if (body.manualPaymentReference !== undefined) school.manualPaymentReference = body.manualPaymentReference || null;
    if (body.subscriptionPlan !== undefined) school.subscriptionPlan = body.subscriptionPlan || 'free';
    if (body.subscriptionStatus !== undefined) school.subscriptionStatus = body.subscriptionStatus || 'inactive';
    if (body.subscriptionStartedAt !== undefined) school.subscriptionStartedAt = body.subscriptionStartedAt || null;
    if (body.subscriptionEndsAt !== undefined) school.subscriptionEndsAt = body.subscriptionEndsAt || null;
    if (body.suspended !== undefined) {
      school.status = body.suspended ? 'suspended' : 'active';
      school.isActive = !body.suspended;
      if (body.suspended) { school.suspendedAt = new Date(); school.suspendedBy = req.user.id; school.suspensionReason = body.suspensionReason || school.suspensionReason || 'Suspended by super admin'; }
      else { school.reactivatedAt = new Date(); school.reactivatedBy = req.user.id; school.reactivationReason = body.reactivationReason || 'Reactivated by super admin access controls'; }
    }
    const access = await v102RecalculateSchoolAccess(school);
    await v102Audit({ schoolCode:school.schoolId, actorUserId:req.user.id, actorRole:req.user.role, module:'access', action:'school_access_controls_updated', entityType:'School', entityId:school.id, before, after:{ ...school.toJSON(), access } });
    res.json({ success:true, message:'School access controls updated and recalculated', data:{ school, access } });
  } catch(error) { console.error('V102 update school access error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.getSchoolPaymentRequests = async (req, res) => {
  try {
    const status = req.query.status || null;
    const schoolCode = req.query.schoolCode || null;
    const where = [];
    const replacements = {};
    if (status) { where.push('spr."status" = :status'); replacements.status = status; }
    if (schoolCode) { where.push('spr."schoolCode" = :schoolCode'); replacements.schoolCode = schoolCode; }
    const [rows] = await sequelize.query(`
      SELECT spr.*, s."name" AS "schoolName", s."shortCode" AS "schoolShortCode"
        FROM "SchoolPaymentRequests" spr
        LEFT JOIN "Schools" s ON s."schoolId" = spr."schoolCode"
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY spr."createdAt" DESC
       LIMIT 200
    `, { replacements });
    res.json({ success:true, data:rows || [] });
  } catch(error) { console.error('V102 get payment requests error:', error); res.status(500).json({ success:false, message:error.message }); }
};

exports.reviewSchoolPaymentRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const action = String(req.body.action || '').toLowerCase();
    if (!['approve','reject','more_details'].includes(action)) return res.status(400).json({ success:false, message:'action must be approve, reject, or more_details' });
    const [rows] = await sequelize.query('SELECT * FROM "SchoolPaymentRequests" WHERE id = :id LIMIT 1', { replacements:{ id:requestId } });
    const request = rows?.[0];
    if (!request) return res.status(404).json({ success:false, message:'Payment request not found' });
    const school = await School.findOne({ where:{ schoolId:request.schoolCode } });
    if (!school) return res.status(404).json({ success:false, message:'School not found for request' });
    const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'needs_more_details';
    await sequelize.query(`UPDATE "SchoolPaymentRequests" SET "status"=:status,"reviewedBy"=:reviewedBy,"reviewedAt"=NOW(),"reviewNotes"=:reviewNotes,"updatedAt"=NOW() WHERE id=:id`, { replacements:{ status, reviewedBy:req.user.id, reviewNotes:req.body.reviewNotes || null, id:requestId } });
    if (action === 'approve') {
      school.manualPaymentConfirmed = true;
      school.manualPaymentAmount = Number(req.body.amount || request.amount || 0);
      school.manualPaymentReference = req.body.reference || request.reference || `manual-${request.id}`;
      school.manualPaymentConfirmedBy = req.user.id;
      school.manualPaymentConfirmedAt = new Date();
      school.subscriptionPlan = req.body.subscriptionPlan || request.requestedPlan || school.subscriptionPlan || 'growth';
      school.subscriptionStatus = 'active';
      const startedAt = new Date();
      const endsAt = req.body.subscriptionEndsAt ? new Date(req.body.subscriptionEndsAt) : new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      school.subscriptionStartedAt = startedAt;
      school.subscriptionEndsAt = endsAt;
    }
    const access = await v102RecalculateSchoolAccess(school);
    await v102Audit({ schoolCode:school.schoolId, actorUserId:req.user.id, actorRole:req.user.role, module:'billing', action:`payment_request_${status}`, entityType:'SchoolPaymentRequest', entityId:requestId, before:request, after:{ status, access } });
    res.json({ success:true, message:`Payment request ${status}`, data:{ status, school, access } });
  } catch(error) { console.error('V102 review payment request error:', error); res.status(500).json({ success:false, message:error.message }); }
};

// Override school listing with computed access summaries but keep same response shape.
const v102OriginalGetSchools = exports.getSchools;
exports.getSchools = async (req, res) => {
  try {
    const schools = await School.findAll({
      order: [['createdAt', 'DESC']],
      include: [{ model: User, as: 'admins', attributes: ['id','name','email','phone','isActive'], required:false }]
    });
    const data = await Promise.all(schools.map(async s => {
      const access = await v102RecalculateSchoolAccess(s).catch(() => computeSchoolAccess(s));
      const json = s.toJSON();
      const settings = json.settings || {};
      const admin = Array.isArray(json.admins) ? json.admins[0] : null;
      const candidates = [settings.officialSchoolName, settings.originalSignupName, settings.signupSchoolName, settings.schoolName, settings.organizationName, settings.displayName, json.schoolName, json.officialSchoolName, json.name].filter(Boolean).map(v => String(v).trim()).filter(Boolean);
      const originalSignupName = candidates.find(v => !/^shule\s*ai$/i.test(v) && !/^shuleai$/i.test(v)) || '';
      const displayName = originalSignupName || (admin?.name ? `${admin.name}'s School` : `School ${json.shortCode || json.schoolId || json.id}`);
      return { ...json, name: displayName, originalName: json.name, originalSignupName: originalSignupName || displayName, displayName, adminName:admin?.name || null, adminEmail:admin?.email || null, access };
    }));
    res.json({ success:true, data });
  } catch(error) {
    console.error('V102 get schools error:', error);
    if (v102OriginalGetSchools) return v102OriginalGetSchools(req, res);
    res.status(500).json({ success:false, message:error.message });
  }
};

// v124: audit wrong/unsafe parent-child links created by legacy imports or old fallback logic.
exports.auditStudentParentLinks = async (req, res) => {
  try {
    const audit = require('../services/parentLinkAuditService');
    const data = await audit.findBadLinks();
    res.json({ success: true, data, count: data.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.cleanupStudentParentLinks = async (req, res) => {
  try {
    const audit = require('../services/parentLinkAuditService');
    const dryRun = req.body?.dryRun !== false;
    const data = await audit.cleanupBadLinks({ dryRun });
    res.json({ success: true, data, message: dryRun ? 'Dry run complete. Send dryRun:false to remove bad links.' : 'Bad parent-child links cleaned.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
