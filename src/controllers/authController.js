const { User, Student, Teacher, Parent, Admin, School, ApprovalRequest } = require('../models');
const { createAlert } = require('../services/notificationService');
const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');
const sequelize = require('../config/database');
const { computeSchoolAccess } = require('../services/schoolAccessEngine');
const { getSchoolFeatures } = require('../services/schoolFeatureService');
const { normalizeRole, canUseEffectiveRoleAsync } = require('../services/roleAccessService');
const curriculumEngine = require('../services/curriculumStructureEngine');
const classGeneration = require('../services/classGenerationService');
const { assertStrongPassword } = require('../utils/passwordPolicy');
async function canLoginAs(user, requestedRole) { return canUseEffectiveRoleAsync(user, requestedRole); }function publicProfileForRole(user,effectiveRole){const payload=user.getPublicProfile(effectiveRole);payload.primaryRole=user.getDataValue?.('primaryRole')||user.primaryRole||user.role;payload.role=normalizeRole(effectiveRole || user.role);const financeMeta=user.getDataValue?.('financeAssignment')||user.financeAssignment||user.preferences?.finance||{};payload.financeTitle=financeMeta.title||null;payload.financePermissions=Array.isArray(financeMeta.permissions)?financeMeta.permissions:[];return payload;}

function getRefreshSecret() { return process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET; }
function generateRefreshToken(user, effectiveRole = null) {
  const role = normalizeRole(effectiveRole || user.role);
  return jwt.sign(
    { id: user.id, role, effectiveRole: role, primaryRole: normalizeRole(user.role), schoolCode: user.schoolCode, type: 'refresh', tokenVersion: Number(user.tokenVersion || 0) },
    getRefreshSecret(),
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
  );
}
function isSuperAdminSecretConfigured() {
  const secret = String(process.env.SUPER_ADMIN_SECRET || '').trim();
  return secret && !/^SUPER_SECRET_2024_CHANGE_THIS$/i.test(secret);
}

function smallSessionMedia(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
  return raw;
}

function buildSessionBranding(settings = {}) {
  const branding = settings.branding || {};
  const logo = smallSessionMedia(branding.logoUrl || branding.logo || settings.logo || '');
  return {
    schoolName: branding.schoolName || branding.displayName || settings.schoolName || settings.displayName || '',
    displayName: branding.displayName || branding.schoolName || settings.displayName || settings.schoolName || '',
    primaryColor: branding.primaryColor || '',
    accentColor: branding.accentColor || '',
    colorName: branding.colorName || '',
    logoUrl: logo,
    logo
  };
}

function buildSessionSettings(json = {}) {
  const settings = json.settings || {};
  const engine = settings.curriculumEngine || {};
  return {
    schoolName: settings.schoolName || settings.displayName || json.name || '',
    schoolLevel: settings.schoolLevel || 'both',
    schoolStructure: settings.schoolStructure || engine.structureType || json.schoolStructure || 'mixed',
    curriculum: settings.curriculum || engine.curriculum || json.system || 'cbc',
    customSubjects: Array.isArray(settings.customSubjects) ? settings.customSubjects.slice(0, 200) : [],
    branding: buildSessionBranding(settings),
    curriculumEngine: {
      curriculum: engine.curriculum || settings.curriculum || json.system || 'cbc',
      structureType: engine.structureType || settings.schoolStructure || json.schoolStructure || 'mixed',
      enabledLevels: Array.isArray(engine.enabledLevels) ? engine.enabledLevels : (Array.isArray(json.enabledLevels) ? json.enabledLevels : []),
      enabledLevelGroups: Array.isArray(engine.enabledLevelGroups) ? engine.enabledLevelGroups : []
    }
  };
}

async function buildSchoolSessionPayload(school) {
  if (!school) return null;
  const json = school.toJSON ? school.toJSON() : school;
  const access = computeSchoolAccess(school);
  const featurePayload = await getSchoolFeatures(json.schoolId || json.schoolCode).catch(() => ({ planCode: access.planCode || 'starter', featureList: [], plan: null, fullAccess:false, brandingAllowed:false }));
  const settings = buildSessionSettings(json);
  return {
    id: json.id,
    schoolId: json.schoolId || json.schoolCode,
    schoolCode: json.schoolCode || json.schoolId,
    shortCode: json.shortCode || '',
    name: json.name || settings.schoolName || '',
    schoolName: settings.schoolName || json.name || '',
    status: json.status || '',
    system: json.system || settings.curriculum || 'cbc',
    curriculum: json.system || settings.curriculum || 'cbc',
    schoolStructure: json.schoolStructure || settings.schoolStructure || 'mixed',
    enabledLevels: Array.isArray(json.enabledLevels) ? json.enabledLevels : settings.curriculumEngine.enabledLevels,
    isActive: json.isActive !== false,
    subscriptionPlan: json.subscriptionPlan || featurePayload.planCode || access.planCode || 'starter',
    subscriptionStatus: json.subscriptionStatus || '',
    accessMode: json.accessMode || access.accessMode || '',
    accessStatus: json.accessStatus || access.accessStatus || '',
    access,
    planCode: featurePayload.planCode || access.planCode || 'starter',
    plan: featurePayload.plan || null,
    features: Array.isArray(featurePayload.featureList) ? featurePayload.featureList : [],
    featureList: Array.isArray(featurePayload.featureList) ? featurePayload.featureList : [],
    fullAccess: !!(featurePayload.fullAccess || access.fullAccess),
    brandingAllowed: !!(featurePayload.brandingAllowed || access.brandingAllowed),
    branding: settings.branding,
    settings,
    curriculumSetup: curriculumEngine.getCurriculumConfig({ ...json, settings })
  };
}

async function linkParentToStudentSafely(parentId, studentId) {
  const now = new Date();
  await sequelize.query(`
    INSERT INTO "StudentParents" ("studentId", "parentId", "createdAt", "updatedAt")
    VALUES (:studentId, :parentId, :createdAt, :updatedAt)
    ON CONFLICT ("studentId", "parentId") DO UPDATE
      SET "updatedAt" = EXCLUDED."updatedAt"
  `, {
    replacements: { studentId, parentId, createdAt: now, updatedAt: now },
    type: sequelize.QueryTypes.INSERT
  });
}


const authController = {
  // Diagnostic endpoint removed for production security.
  superAdminDiagnostic: async (req, res) => {
    return res.status(404).json({ success: false, message: 'Diagnostic endpoint is disabled in production builds.' });
  },

  // Super Admin login (no signup)
  superAdminLogin: async (req, res) => {
    try {
      const { email, password, secretKey } = req.body;
      
      // Verify secret key matches env. Do not allow missing/default production secrets to behave as a valid secret.
      if (!isSuperAdminSecretConfigured()) {
        return res.status(503).json({ success: false, message: 'Super admin secret is not configured.' });
      }
      if (!secretKey || String(secretKey) !== String(process.env.SUPER_ADMIN_SECRET)) {
        return res.status(401).json({ success: false, message: 'Invalid secret key' });
      }

      const user = await User.scope('withPassword').findOne({
        where: { email, role: 'super_admin' } 
      });

      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      if (!user.isActive) {
        return res.status(403).json({ success: false, message: 'Account is deactivated' });
      }

      user.loginCount = (user.loginCount || 0) + 1;
      user.lastLogin = new Date();
      await user.save();

      const token = user.generateAuthToken();

      res.json({
        success: true,
        data: { token, refreshToken: generateRefreshToken(user, 'super_admin'), user: user.getPublicProfile() }
      });
    } catch (error) {
      console.error('Super admin login error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Admin signup - creates pending school
  adminSignup: async (req, res) => {
    try {
      const { 
        name, email, password, phone, 
        schoolName, schoolLevel, curriculum, schoolType, enabledLevels, enabledLevelGroups, structureType, schoolStructure, classGeneration: classGenerationInput, streams, customClasses,
        address, contact 
      } = req.body;

      // Validate required fields
      if (!name || !email || !password || !schoolName) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required fields' 
        });
      }

      // Check if email already exists
      const existing = await User.findOne({ where: { email } });
      if (existing) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email already in use' 
        });
      }

      // Create school - let the model defaults handle schoolId and shortCode
      const normalizedCurriculum = curriculumEngine.normalizeCurriculum(curriculum || 'cbc');
      const normalizedStructure = structureType || schoolStructure || schoolLevel || 'mixed';
      const rawLevelValues = [...(Array.isArray(enabledLevelGroups) ? enabledLevelGroups : []), ...(Array.isArray(enabledLevels) ? enabledLevels : [])];
      if (!rawLevelValues.length && normalizedStructure !== 'custom') {
        const supportedStructures = {
          cbc:new Set(['primary_only','junior_only','senior_only','secondary_only','mixed','full_school']),
          '844':new Set(['primary_only','secondary_only','mixed','full_school']),
          british:new Set(['primary_only','secondary_only','mixed','full_school']),
          american:new Set(['primary_only','secondary_only','mixed','full_school']),
          custom:new Set(['custom'])
        };
        const fallbackStructure = supportedStructures[normalizedCurriculum]?.has(normalizedStructure)
          ? normalizedStructure
          : (['junior_only','senior_only'].includes(normalizedStructure) ? 'secondary_only' : 'mixed');
        const syntheticSchool = {
          system: normalizedCurriculum,
          schoolStructure: fallbackStructure,
          enabledLevels: [],
          settings: { curriculumEngine: { curriculum:normalizedCurriculum, structureType:fallbackStructure, enabledLevels:[], enabledLevelGroups:[] } }
        };
        rawLevelValues.push(...curriculumEngine.getCurriculumConfig(syntheticSchool).enabledLevels);
      }
      const selectedLevels = curriculumEngine.expandEnabledLevelCodes(normalizedCurriculum, rawLevelValues);
      const selectedGroups = curriculumEngine.groupsFromEnabledLevels(normalizedCurriculum, selectedLevels);
      const classGenerationConfig = classGeneration.normalizeConfigPatch(
        { settings: {} },
        classGenerationInput || { streams: Array.isArray(streams) ? streams : [], customClasses: Array.isArray(customClasses) ? customClasses : [] }
      );
      if (!selectedLevels.length && !classGenerationConfig.customClasses.length) {
        return res.status(400).json({ success:false, code:'CLASS_STRUCTURE_REQUIRED', message:'Select at least one grade/class level or add at least one custom class name.' });
      }
      console.log('Creating school with name:', schoolName);
      const school = await School.create({
        name: schoolName,
        system: normalizedCurriculum,
        address: address || {},
        contact: contact || { phone, email },
        status: 'pending',
        isActive: false,
        settings: {
          allowTeacherSignup: true,
          requireApproval: true,
          autoApproveDomains: [],
          schoolLevel: normalizedStructure,
          curriculum: normalizedCurriculum,
          schoolType: schoolType || 'day',
          schoolStructure: normalizedStructure,
          curriculumEngine: { curriculum: normalizedCurriculum, structureType: normalizedStructure, enabledLevels: selectedLevels, enabledLevelGroups: selectedGroups, schoolSubjects: [], assessmentSettings: curriculumEngine.defaultAssessmentSettings(), updatedAt: new Date().toISOString() },
          classGeneration: classGenerationConfig,
          originalSignupName: schoolName,
          displayName: schoolName,
          boarding: { type: schoolType || 'day', hasBoarding: ['boarding','day_boarding'].includes(schoolType || 'day') },
          dutyManagement: {
            enabled: true,
            reminderHours: 24,
            maxTeachersPerDay: 3,
            checkInWindow: 15
          }
        },
        schoolStructure: normalizedStructure,
        enabledLevels: selectedLevels
      });

      console.log('School created successfully:', {
        id: school.id,
        schoolId: school.schoolId,
        shortCode: school.shortCode
      });

      // Create admin user (inactive until school approved)
      const user = await User.create({
        name,
        email,
        password,
        role: 'admin',
        phone,
        schoolCode: school.schoolId,
        isActive: false // Admin inactive until school approved
      });

      // Create admin profile
      const admin = await Admin.create({
        userId: user.id,
        position: 'School Administrator',
        managedSchools: [school.id]
      });

      console.log('Admin created successfully with ID:', admin.adminId);

      // Notify super admins about new school registration
      const superAdmins = await User.findAll({ where: { role: 'super_admin' } });
      for (const sa of superAdmins) {
        await createAlert({
          userId: sa.id,
          role: 'super_admin',
          type: 'approval',
          severity: 'info',
          title: 'New School Registration',
          message: `${schoolName} (${school.shortCode}) pending approval`,
          data: { schoolId: school.id, adminId: user.id, schoolType: schoolType || 'day' }
        });
      }

      res.status(201).json({
        success: true,
        message: 'Registration successful. School pending approval by super admin.',
        data: {
          schoolId: school.schoolId,
          shortCode: school.shortCode,
          qrCode: school.qrCode,
          status: school.status
        }
      });
    } catch (error) {
      console.error('Admin signup error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        errors: error.errors
      });
      
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Registration failed. Please try again.'
      });
    }
  },

  // Teacher signup with school short code
  teacherSignup: async (req, res) => {
    try {
      const { name, email, password, phone, schoolCode, subjects, qualification } = req.body;

      // Find school by short code or schoolId
      const school = await School.findOne({
        where: {
          [Op.or]: [
            { shortCode: schoolCode },
            { schoolId: schoolCode }
          ]
        }
      });

      if (!school) {
        return res.status(404).json({ success: false, message: 'Invalid school code' });
      }

      // Check if school is active
      if (school.status !== 'active') {
        return res.status(403).json({ success: false, message: 'School is not yet approved' });
      }

      // Schools with teacher approval requests should not hard-block signups.
      // A teacher request is created as pending and the admin approves/rejects it later.
      // Only inactive/unapproved schools are blocked above.
      const schoolSettings = school.settings || {};
      const requestsExplicitlyClosed = schoolSettings.teacherSignupMode === 'closed' || schoolSettings.allowTeacherRequests === false;
      if (requestsExplicitlyClosed) {
        return res.status(403).json({ success: false, message: 'Teacher signup requests are currently disabled for this school' });
      }

      const existing = await User.findOne({ where: { email } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email already exists' });
      }

      // Check auto-approve domains
      const emailDomain = email.split('@')[1];
      const autoApprove = schoolSettings.autoApproveDomains?.includes(emailDomain) || false;

      const user = await User.create({
        name, 
        email, 
        password, 
        role: 'teacher', 
        phone,
        schoolCode: school.schoolId,
        isActive: autoApprove // Auto-approved if domain matches
      });

      const teacher = await Teacher.create({
        userId: user.id,
        subjects: subjects || [],
        qualification,
        approvalStatus: autoApprove ? 'approved' : 'pending',
        approvedAt: autoApprove ? new Date() : null
      });

      if (!autoApprove) {
        await ApprovalRequest.create({
          schoolId: school.schoolId,
          userId: user.id,
          role: 'teacher',
          status: 'pending',
          data: { name, email, phone, qualification, subjects: subjects || [] },
          metadata: {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            source: 'teacher_signup'
          }
        });

        // Update school stats
        school.stats = school.stats || {};
        school.stats.pendingApprovals = (school.stats.pendingApprovals || 0) + 1;
        await school.save();

        // Notify school admins
        const admins = await User.findAll({ 
          where: { role: 'admin', schoolCode: school.schoolId } 
        });
        
        for (const admin of admins) {
          await createAlert({
            userId: admin.id,
            role: 'admin',
            type: 'approval',
            severity: 'info',
            title: 'New Teacher Signup',
            message: `${name} requested to join.`,
            data: { teacherId: teacher.id }
          });
        }
      }

      res.status(201).json({
        success: true,
        message: autoApprove ? 'Signup successful' : 'Pending admin approval',
        data: { 
          status: teacher.approvalStatus,
          schoolName: school.name
        }
      });
    } catch (error) {
      console.error('Teacher signup error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Parent signup with student ELIMUID
  parentSignup: async (req, res) => {
    try {
      const { name, email, password, phone, studentElimuid } = req.body;

      // Find student by ELIMUID
      const student = await Student.findOne({ 
        where: { elimuid: studentElimuid },
        include: [{ model: User, attributes: ['schoolCode'] }]
      });

      if (!student) {
        return res.status(404).json({ success: false, message: 'Invalid student ELIMUID' });
      }

      const existing = await User.findOne({ where: { email } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email already exists' });
      }

      // Check if school is active
      const school = await School.findOne({ 
        where: { schoolId: student.User.schoolCode } 
      });
      
      if (school.status !== 'active') {
        return res.status(403).json({ success: false, message: 'School is not active' });
      }

      const user = await User.create({
        name, 
        email, 
        password, 
        role: 'parent', 
        phone,
        schoolCode: student.User.schoolCode,
        isActive: true
      });

      const parent = await Parent.create({
        userId: user.id,
        relationship: 'guardian'
      });

      // Link parent to student using original Elimu ID logic.
      // A learner can only be linked to a maximum of two parent/guardian accounts.
      const linkedParents = await sequelize.query(
        'SELECT COUNT(DISTINCT "parentId")::int AS count FROM "StudentParents" WHERE "studentId" = :studentId',
        { replacements: { studentId: student.id }, type: sequelize.QueryTypes.SELECT }
      );
      const linkedParentCount = Number(linkedParents?.[0]?.count || 0);
      if (linkedParentCount >= 2) {
        await parent.destroy().catch(() => null);
        await user.destroy().catch(() => null);
        return res.status(403).json({ success: false, message: 'This Elimu ID already has the maximum two parent/guardian accounts linked' });
      }

      await linkParentToStudentSafely(parent.id, student.id);

      res.status(201).json({
        success: true,
        message: 'Parent account created successfully',
        data: { studentName: student.User?.name }
      });
    } catch (error) {
      console.error('Parent signup error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Student login with ELIMUID
  studentLogin: async (req, res) => {
    try {
      const { elimuid, password } = req.body;

      const student = await Student.findOne({ 
        where: { elimuid },
        include: [{ model: User.scope('withPassword') }]
      });

      if (!student || !(await student.User.comparePassword(password))) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const user = student.User;

      if (!user.isActive) {
        return res.status(403).json({ success: false, message: 'Account is deactivated' });
      }

      // Check if school is active
      const school = await School.findOne({ where: { schoolId: user.schoolCode } });
      if (school.status !== 'active') {
        return res.status(403).json({ success: false, message: 'School is not active' });
      }

      user.loginCount = (user.loginCount || 0) + 1;
      user.lastLogin = new Date();
      await user.save();

      const token = user.generateAuthToken();

      res.json({
        success: true,
        data: { token, refreshToken: generateRefreshToken(user, 'student'), user: user.getPublicProfile(), student }
      });
    } catch (error) {
      console.error('Student login error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Regular login for admin/teacher/parent
  login: async (req, res) => {
    try {
      const { email, password, role } = req.body;

      const requestedRole=normalizeRole(role||'');const user=await User.scope('withPassword').findOne({where:{[Op.or]:[{email:email},{phone:email}]}});if(!user||!(await canLoginAs(user,requestedRole))||!(await user.comparePassword(password)))return res.status(401).json({success:false,message:'Invalid credentials'});

      if (!user.isActive) {
        return res.status(403).json({ success: false, message: 'Account is deactivated' });
      }

      // Check school status for non-super-admin users
      if (user.role !== 'super_admin' && user.schoolCode) {
        const school = await School.findOne({ where: { schoolId: user.schoolCode } });
        if (!school || school.status !== 'active') {
          return res.status(403).json({ success: false, message: 'School is not active' });
        }
      }

      user.loginCount = (user.loginCount || 0) + 1;
      user.lastLogin = new Date();
      await user.save();

      const effectiveRole=requestedRole||user.role;const token=user.generateAuthToken(effectiveRole);

      let profile = null;
      if (effectiveRole === 'teacher') profile = await Teacher.findOne({ where: { userId: user.id } });
      else if (effectiveRole === 'student') profile = await Student.findOne({ where: { userId: user.id } });
      else if (effectiveRole === 'parent') profile = await Parent.findOne({ where: { userId: user.id } });
      else if (effectiveRole === 'admin') profile = await Admin.findOne({ where: { userId: user.id } });

      const school = user.schoolCode ? await School.findOne({ where: { schoolId: user.schoolCode } }) : null;
      const schoolPayload = await buildSchoolSessionPayload(school);

      res.json({
        success: true,
        data: { token, refreshToken: generateRefreshToken(user, effectiveRole), user: publicProfileForRole(user,effectiveRole), profile, school: schoolPayload }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Refresh token
  refreshToken: async (req, res) => {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(401).json({ success: false, message: 'Refresh token required' });
      }

      const decoded = jwt.verify(refreshToken, getRefreshSecret());
      if (decoded.type !== 'refresh') {
        return res.status(401).json({ success: false, message: 'Invalid refresh token' });
      }
      const user = await User.findByPk(decoded.id);
      
      if (!user || !user.isActive || Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
        return res.status(401).json({ success: false, message: 'Invalid or revoked refresh token' });
      }

      const requestedRole=decoded.effectiveRole||decoded.role||user.role;const effectiveRole=(await canLoginAs(user,requestedRole))?requestedRole:user.role;const newToken=user.generateAuthToken(effectiveRole);
      
      res.json({ success: true, token: newToken, refreshToken: generateRefreshToken(user, effectiveRole) });
    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }
  },

  // Get current user
  getMe: async (req, res) => {
    try {
      const user = req.user;
      let profile = null;
      if (user.role === 'teacher') profile = await Teacher.findOne({ where: { userId: user.id } });
      else if (user.role === 'student') profile = await Student.findOne({ where: { userId: user.id } });
      else if (user.role === 'parent') profile = await Parent.findOne({ where: { userId: user.id } });
      else if (user.role === 'admin') profile = await Admin.findOne({ where: { userId: user.id } });

      const school = user.schoolCode ? await School.findOne({ where: { schoolId: user.schoolCode } }) : null;
      const schoolPayload = await buildSchoolSessionPayload(school);

      res.json({
        success: true,
        data: { user: publicProfileForRole(user,req.effectiveRole||user.role), profile, school: schoolPayload }
      });
    } catch (error) {
      console.error('Get me error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Logout
  logout: async (req, res) => {
    try {
      await User.increment('tokenVersion', { by: 1, where: { id:req.user.id } });
      res.cookie('token', 'none', { expires: new Date(Date.now() + 10*1000), httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax' });
      return res.json({ success:true, message:'Logged out and active tokens revoked' });
    } catch (error) { return res.status(500).json({ success:false, message:error.message }); }
  },

  // Verify school code (for teacher signup)
  verifySchoolCode: async (req, res) => {
    try {
      const { schoolCode } = req.body;
      
      const school = await School.findOne({
        where: {
          [Op.or]: [
            { shortCode: schoolCode },
            { schoolId: schoolCode }
          ]
        }
      });

      if (!school) {
        return res.status(404).json({ success: false, message: 'Invalid school code' });
      }

      if (school.status !== 'active') {
        return res.status(403).json({ 
          success: false, 
          message: 'School is pending approval. Please try again later.' 
        });
      }

      res.json({
        success: true,
        data: {
          schoolName: school.name,
          schoolId: school.schoolId,
          shortCode: school.shortCode,
          requiresApproval: school.settings.requireApproval,
          autoApproveDomains: school.settings.autoApproveDomains
        }
      });
    } catch (error) {
      console.error('Verify school code error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Change password
  changePassword: async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await User.scope('withPassword').findByPk(req.user.id);

      assertStrongPassword(newPassword, [user?.name, user?.email, user?.phone]);

      if (!(await user.comparePassword(currentPassword))) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }

      user.password = newPassword;
      user.tokenVersion = Number(user.tokenVersion || 0) + 1;
      user.passwordIssuedAt = new Date();
      await user.save();

      await createAlert({
        userId: user.id,
        role: user.role,
        type: 'system',
        severity: 'info',
        title: 'Password Changed',
        message: 'Your password was successfully changed.'
      });

      res.json({ success: true, message: 'Password updated. Please sign in again on your devices.' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

    // Set first password for student after authenticated first login.
  // Security rule: this endpoint never accepts another learner's Elimu ID as authority.
  // The JWT user is the authority, so a student can only complete their own first-login password setup.
  setFirstPassword: async (req, res) => {
    try {
      const { elimuid, newPassword } = req.body;
      if (!req.user || normalizeRole(req.user.role) !== 'student') {
        return res.status(403).json({ success: false, message: 'Only the logged-in student can set a first password.' });
      }
      const student = await Student.findOne({
        where: { userId: req.user.id },
        include: [{ model: User }]
      });

      if (!student || !student.User) {
        return res.status(404).json({ success: false, message: 'Student profile not found for this account.' });
      }
      if (elimuid && String(elimuid).trim() !== String(student.elimuid || '').trim()) {
        return res.status(403).json({ success: false, message: 'This Elimu ID does not belong to the logged-in student.' });
      }

      const user = student.User;
      assertStrongPassword(newPassword, [user.name, user.email, user.phone, student.elimuid]);
      if (user.firstLogin === false && user.mustChangePassword !== true) {
        return res.status(409).json({ success: false, message: 'First password has already been set. Use Change Password instead.' });
      }

      user.password = String(newPassword);
      user.tokenVersion = Number(user.tokenVersion || 0) + 1;
      user.firstLogin = false;
      user.mustChangePassword = false;
      user.passwordIssuedAt = new Date();
      await user.save();

      res.json({ success: true, message: 'Password set successfully', data: { user: user.getPublicProfile('student') } });
    } catch (error) {
      console.error('Set first password error:', error);
      res.status(error.status || 500).json({ success: false, message: error.message });
    }
  }
};

console.log('✅ authController loaded, exports:', Object.keys(authController));
module.exports = authController;
