const { sequelize, School, User, Student, Teacher, Parent, Class, Alert, MediaAsset } = require('../models');
const { saveUploadAsset, saveDataUrlAsset } = require('../services/mediaAssetService');
const { getRoleAnalytics } = require('../services/ownerAnalyticsEngine');
const { generateTemporaryPassword } = require('../utils/passwords');


const BRAND_COLOR_PRESETS = {
  'Shule Blue': { primaryColor: '#083A85', accentColor: '#11B5B1' },
  'Royal Blue': { primaryColor: '#0B2F6B', accentColor: '#3B82F6' },
  'Emerald Green': { primaryColor: '#047857', accentColor: '#10B981' },
  'Purple': { primaryColor: '#6D28D9', accentColor: '#A78BFA' },
  'Orange': { primaryColor: '#C2410C', accentColor: '#FB923C' },
  'Red': { primaryColor: '#B91C1C', accentColor: '#F87171' },
  'Gold': { primaryColor: '#92400E', accentColor: '#FBBF24' },
  'Slate': { primaryColor: '#334155', accentColor: '#64748B' }
};

function normalizeColorName(name) {
  const value = String(name || '').trim();
  return BRAND_COLOR_PRESETS[value] ? value : 'Shule Blue';
}

function resolveColors(colorName, primaryColor, accentColor) {
  const safeName = normalizeColorName(colorName);
  const preset = BRAND_COLOR_PRESETS[safeName] || BRAND_COLOR_PRESETS['Shule Blue'];
  return {
    colorName: safeName,
    primaryColor: /^#[0-9a-f]{6}$/i.test(String(primaryColor || '')) ? primaryColor : preset.primaryColor,
    accentColor: /^#[0-9a-f]{6}$/i.test(String(accentColor || '')) ? accentColor : preset.accentColor
  };
}

function publicBrandingPayload(school) {
  const branding = school?.settings?.branding || {};
  const colors = resolveColors(branding.colorName, branding.primaryColor, branding.accentColor);
  const logo = branding.logoUrl || branding.logo || branding.logoDataUrl || null;
  return {
    schoolId: school.schoolId,
    name: school.name,
    schoolName: branding.schoolName || school.name,
    displayName: branding.schoolName || school.name,
    logo,
    logoUrl: branding.logoUrl || null,
    logoDataUrl: null,
    logoSource: branding.logoUrl ? (String(branding.logoUrl).startsWith('/api/media/') ? 'upload' : 'url') : 'fallback',
    colorName: colors.colorName,
    primaryColor: colors.primaryColor,
    accentColor: colors.accentColor,
    reportFooter: branding.reportFooter || '',
    paymentInstructions: branding.paymentInstructions || '',
    updatedAt: branding.updatedAt || school.updatedAt
  };
}

async function restoreLatestDurableSchoolLogo(school) {
  const current = school?.settings || {};
  const branding = { ...(current.branding || {}) };
  if (branding.logoUrl || branding.logo || branding.logoDataUrl) return false;
  const asset = await MediaAsset.findOne({
    where: { schoolCode: school.schoolId, kind: 'school_logo', isActive: true },
    order: [['createdAt', 'DESC']]
  }).catch(() => null);
  if (!asset?.token) return false;
  branding.logoUrl = `/api/media/${asset.token}`;
  branding.logoSource = 'recovered_durable_upload';
  branding.recoveredAt = new Date().toISOString();
  await school.update({ settings: { ...current, branding } });
  return true;
}

function extractUploadedFile(req) {
  return req.files?.logo || req.files?.file || req.files?.image || null;
}

function validateExternalLogoUrl(value) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw Object.assign(new Error('Logo URL must be a valid HTTPS URL.'), { status: 400 }); }
  if (parsed.protocol !== 'https:') throw Object.assign(new Error('Logo URL must use HTTPS.'), { status: 400 });
  const configured = String(process.env.MEDIA_ALLOWED_LOGO_HOSTS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  const defaults = ['res.cloudinary.com', 'shuleai.live', 'www.shuleai.live', 'api.shuleai.live'];
  const allowed = new Set([...defaults, ...configured]);
  const host = parsed.hostname.toLowerCase();
  if (!allowed.has(host)) throw Object.assign(new Error('Logo URL host is not approved. Upload the logo directly instead.'), { status: 400 });
  return parsed.toString();
}


exports.getOwnerAnalytics = async (req, res) => {
  try {
    const payload = await getRoleAnalytics(req.user, req.query || {});
    return res.json(payload);
  } catch (error) {
    console.error('Owner analytics error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Analytics failed' });
  }
};

exports.getSchoolBranding = async (req, res) => {
  try {
    if (!req.user.schoolCode && req.user.role !== 'super_admin') return res.status(403).json({ success: false, message: 'Missing school tenant' });
    const schoolCode = req.query.schoolCode || req.user.schoolCode;
    if (req.user.role !== 'super_admin' && schoolCode !== req.user.schoolCode) return res.status(403).json({ success: false, message: 'Cross-school branding access blocked' });
    const school = await School.findOne({ where: { schoolId: schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    await restoreLatestDurableSchoolLogo(school);
    return res.json({ success: true, data: publicBrandingPayload(school) });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};

exports.updateSchoolBranding = async (req, res) => {
  try {
    if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only school admins can update branding' });
    const schoolCode = req.body.schoolCode || req.user.schoolCode;
    if (req.user.role !== 'super_admin' && schoolCode !== req.user.schoolCode) return res.status(403).json({ success: false, message: 'Cross-school branding update blocked' });
    const school = await School.findOne({ where: { schoolId: schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const current = school.settings || {};
    const branding = { ...(current.branding || {}) };
    const requestedName = String(req.body.schoolName || req.body.name || req.body.displayName || '').trim();
    if (requestedName) {
      branding.schoolName = requestedName;
      await school.update({ name: requestedName });
    }
    const colors = resolveColors(req.body.colorName || branding.colorName, req.body.primaryColor || branding.primaryColor, req.body.accentColor || branding.accentColor);
    branding.colorName = colors.colorName;
    branding.primaryColor = colors.primaryColor;
    branding.accentColor = colors.accentColor;
    let uploadedLogo = false;
    if (req.body.logoDataUrl !== undefined) {
      const logoDataUrl = String(req.body.logoDataUrl || '').trim();
      if (logoDataUrl) {
        const saved = await saveDataUrlAsset({ dataUrl: logoDataUrl, schoolCode, ownerUserId: req.user.id, kind: 'school_logo', maxBytes: 2*1024*1024, metadata: { schoolCode, uploadedBy: req.user.id } });
        branding.logoUrl = saved.url;
        delete branding.logoDataUrl;
        delete branding.logo;
        branding.logoSource = 'upload';
        uploadedLogo = true;
      }
    }
    if (!uploadedLogo && (req.body.logoUrl !== undefined || req.body.logo !== undefined)) {
      const logoUrl = String(req.body.logoUrl || req.body.logo || '').trim();
      if (logoUrl) {
        branding.logoUrl = validateExternalLogoUrl(logoUrl);
        delete branding.logoDataUrl;
        delete branding.logo;
        branding.logoSource = 'url';
      }
    }
    if (req.body.removeLogo === true) {
      delete branding.logoUrl;
      delete branding.logoDataUrl;
      delete branding.logo;
      branding.logoSource = 'removed';
    }
    ['reportFooter','paymentInstructions'].forEach(k => {
      if (req.body[k] !== undefined) branding[k] = String(req.body[k] || '').trim();
    });
    branding.updatedBy = req.user.id;
    branding.updatedAt = new Date().toISOString();
    await school.update({ settings: { ...current, branding } });
    return res.json({ success: true, data: publicBrandingPayload(school), message: 'School branding updated' });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};

exports.uploadSchoolLogo = async (req, res) => {
  try {
    if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only school admins can upload branding logos' });
    const schoolCode = req.body.schoolCode || req.query.schoolCode || req.user.schoolCode;
    if (req.user.role !== 'super_admin' && schoolCode !== req.user.schoolCode) return res.status(403).json({ success: false, message: 'Cross-school logo upload blocked' });
    const school = await School.findOne({ where: { schoolId: schoolCode } });
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const file = extractUploadedFile(req);
    if (!file) return res.status(400).json({ success: false, message: 'No logo file uploaded. Use form field: logo' });
    const saved=await saveUploadAsset({file,schoolCode,ownerUserId:req.user.id,kind:'school_logo',maxBytes:2*1024*1024,metadata:{schoolCode,uploadedBy:req.user.id}});
    const current=school.settings||{};const branding={...(current.branding||{})};branding.logoUrl=saved.url;delete branding.logoDataUrl;branding.logoSource='upload';
    branding.updatedBy = req.user.id;
    branding.updatedAt = new Date().toISOString();
    await school.update({ settings: { ...current, branding } });
    return res.json({ success: true, data: publicBrandingPayload(school), message: 'School logo uploaded and saved' });
  } catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
};

exports.getAgentToolkit = async (req, res) => {
  const toolkit = {
    pricing: [
      { name: 'School Starter', target: '1–400 active students', includes: ['Complete Shule AI school platform'], note: 'Pricing is based on active student count, not feature access.' },
      { name: 'School Growth', target: '401–800 active students', includes: ['Complete Shule AI school platform'], note: 'Adds capacity, allowances and priority support—not locked features.' },
      { name: 'School Enterprise', target: '801+ active students', includes: ['Complete Shule AI school platform'], note: 'Adds scale, support and custom service options—not locked features.' },
      { name: 'Parent Child Plans', target: 'Parents/students', includes: ['Basic: reports/attendance/progress', 'Premium: AI Tutor 6/day', 'Ultimate: extended AI + recommendations'], note: 'Parent subscriptions are paid per child. Basic does not include AI Tutor.' }
    ],
    pitchScript: 'Shule AI gives schools one intelligent platform for fees, attendance, academics, communication, alerts, AI tutoring, and student success — built for Kenyan schools and mobile-first usage.',
    faq: [
      { q: 'Does Shule AI support M-Pesa?', a: 'Yes. It supports STK Push, manual M-Pesa verification, bank, cash/card instructions, and payment history.' },
      { q: 'Can teachers use phones?', a: 'Yes. The web app is responsive/PWA so teachers can use it from mobile browsers.' },
      { q: 'Does it replace report cards?', a: 'It supports digital report cards and academic analytics while still allowing schools to print/export where needed.' }
    ],
    leadStages: ['New Lead', 'Contacted', 'Demo Booked', 'Demo Done', 'Negotiation', 'Closed', 'Lost'],
    demoLogins: { note: 'Use the demo seed script to create safe demo accounts. Do not use real school data in demos.' }
  };
  return res.json({ success: true, data: toolkit });
};

exports.getAdminHealthDashboard = async (req, res) => {
  try {
    if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Forbidden' });
    const schoolCode = req.user.role === 'super_admin' ? req.query.schoolCode : req.user.schoolCode;
    const checks = {};
    try { await sequelize.query('SELECT 1'); checks.database = { ok: true }; }
    catch (error) { checks.database = { ok: false, error: 'Database health query failed' }; }
    checks.deepseek = { configured: !!process.env.DEEPSEEK_API_KEY, provider: process.env.AI_PROVIDER || 'deepseek', model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash' };
    checks.daraja = { configured: !!(process.env.DARAJA_CONSUMER_KEY && process.env.DARAJA_CONSUMER_SECRET && process.env.DARAJA_PASSKEY && process.env.DARAJA_SHORTCODE), env: process.env.DARAJA_ENV || process.env.DARAJA_ENVIRONMENT || 'sandbox' };
    checks.schoolCode = schoolCode || null;
    checks.timestamp = new Date().toISOString();
    const ready = checks.database.ok;
    return res.status(ready ? 200 : 503).json({ success: ready, status: ready ? 'ready' : 'degraded', checks });
  } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
};

exports.seedDemoSchool = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ success:false, message:'Demo seeding is disabled in production.' });
    if (req.user.role !== 'super_admin') return res.status(403).json({ success: false, message: 'Only super admin can seed demo schools' });
    const schoolId = req.body.schoolCode || 'DEMO-SHULEAI';
    const [school] = await School.findOrCreate({ where: { schoolId }, defaults: { name: req.body.schoolName || 'Shule AI Demo School', shortCode: 'DEMOAI', status: 'active', isActive: true, settings: { demoMode: true, branding: { primaryColor: '#083A85', accentColor: '#11B5B1' } } } });
    const makeUser = async (role, name, email) => User.findOrCreate({ where: { email }, defaults: { name, email, password: generateTemporaryPassword(), role, schoolCode: school.schoolId, isActive: true, firstLogin: true } });
    const [adminUser] = await makeUser('admin', 'Demo Admin', 'demo.admin@shuleai.local');
    const [teacherUser] = await makeUser('teacher', 'Demo Teacher', 'demo.teacher@shuleai.local');
    const [parentUser] = await makeUser('parent', 'Demo Parent', 'demo.parent@shuleai.local');
    const [studentUser] = await makeUser('student', 'Brian Demo Student', 'demo.student@shuleai.local');
    const [klass] = await Class.findOrCreate({ where: { schoolCode: school.schoolId, name: 'Grade 6 Blue' }, defaults: { schoolCode: school.schoolId, name: 'Grade 6 Blue', grade: 'Grade 6', isActive: true } });
    const [teacher] = await Teacher.findOrCreate({ where: { userId: teacherUser.id }, defaults: { userId: teacherUser.id, classId: klass.id, subjects: ['Mathematics','Science'], approvalStatus: 'approved', classTeacher: 'yes' } });
    const [parent] = await Parent.findOrCreate({ where: { userId: parentUser.id }, defaults: { userId: parentUser.id, relationship: 'guardian' } });
    const [student] = await Student.findOrCreate({ where: { userId: studentUser.id }, defaults: { userId: studentUser.id, schoolCode: school.schoolId, grade: 'Grade 6', classId: klass.id, curriculum: 'cbc', parentName: parentUser.name, parentEmail: parentUser.email, status: 'active' } });
    if (!student.schoolCode) await student.update({ schoolCode: school.schoolId }).catch(() => null);
    await sequelize.query('INSERT INTO "StudentParents" ("studentId","parentId","createdAt","updatedAt") VALUES (:studentId,:parentId,NOW(),NOW()) ON CONFLICT DO NOTHING', { replacements: { studentId: student.id, parentId: parent.id } }).catch(() => {});
    await Alert.findOrCreate({ where: { userId: parentUser.id, dedupeKey: `demo-parent-${student.id}` }, defaults: { userId: parentUser.id, role: 'parent', type: 'system', title: 'Demo: Brian is present today', message: 'Your child is present today. Shule AI keeps you updated in real time.', categoryLabel: 'Parent Peace of Mind', sourceType: 'demo', sourceLabel: 'Shule AI Demo', studentId: student.id, dedupeKey: `demo-parent-${student.id}` } });
    return res.json({ success: true, message: 'Demo school seed completed', data: { schoolCode: school.schoolId, accounts: { admin: adminUser.email, teacher: teacherUser.email, parent: parentUser.email, student: studentUser.email }, temporaryPasswordNote: 'Passwords are generated and must be reset; check database/admin console for demo credentials in non-production.' } });
  } catch (error) { console.error('Demo seed error:', error); return res.status(500).json({ success: false, message: error.message }); }
};
