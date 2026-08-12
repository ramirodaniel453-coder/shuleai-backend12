'use strict';
const { Settings, sequelize, Parent, Teacher, Student, User, School } = require('../models');
const { getSchoolFeatures } = require('../services/schoolFeatureService');
async function readSettings(key, fallback={}) { const row = await Settings.findOne({ where:{ key } }).catch(() => null); return row?.value || fallback; }
async function writeSettings(key, value) { const [row] = await Settings.findOrCreate({ where:{ key }, defaults:{ value } }); row.value = value; await row.save(); return row.value; }
async function platformSms() { return readSettings('platform_sms_settings', { provider:null, apiKey:null, senderId:'SHULEAI', enabled:false, schoolTokens:{} }); }
function schoolTokens(cfg, schoolCode) { return Number((cfg.schoolTokens || {})[schoolCode] || 0); }
async function resolveAudienceCount(schoolCode, audience, explicitCount, recipients=[]) {
  const n = Number(explicitCount || 0);
  if (n > 0) return n;
  if (Array.isArray(recipients) && recipients.length) return recipients.length;
  const a = String(audience || '').toLowerCase();
  if (a === 'teachers') return Teacher.count({ include:[{ model:User, where:{ schoolCode }, attributes:[] }] }).catch(() => 0);
  if (a === 'students') return Student.count({ include:[{ model:User, where:{ schoolCode }, attributes:[] }] }).catch(() => 0);
  if (a === 'whole_school') {
    const [parents, teachers, students] = await Promise.all([
      Parent.count({ include:[{ model:User, where:{ schoolCode }, attributes:[] }] }).catch(() => 0),
      Teacher.count({ include:[{ model:User, where:{ schoolCode }, attributes:[] }] }).catch(() => 0),
      Student.count({ include:[{ model:User, where:{ schoolCode }, attributes:[] }] }).catch(() => 0)
    ]);
    return parents + teachers + students;
  }
  // Parent-focused audiences: all_parents, fee_defaulters, selected_parents fallback.
  return Parent.count({ include:[{ model:User, where:{ schoolCode }, attributes:[] }] }).catch(() => 0);
}
exports.getConfig = async (req, res) => {
  try {
    const cfg = await platformSms();
    const isSuper = ['super_admin','superadmin'].includes(String(req.user.role).toLowerCase());
    const schoolCode = req.user.schoolCode;
    const features = schoolCode ? await getSchoolFeatures(schoolCode).catch(() => null) : null;
    const enabled = isSuper || !!features?.features?.has?.('bulk_sms') || !!features?.featureList?.includes?.('bulk_sms') || !!features?.fullAccess;
    const allTokens = cfg.schoolTokens || {};
    const allocatedTokens = Object.values(allTokens).reduce((sum, v) => sum + Number(v || 0), 0);
    let allocationHistory=[];
    if(isSuper){ const [rows]=await sequelize.query(`SELECT a.*, COALESCE(NULLIF(s."name", 'Shule AI'), s."shortCode", a."schoolCode") AS "schoolName", u."name" AS "allocatedByName" FROM "SmsAllocations" a LEFT JOIN "Schools" s ON s."schoolId"=a."schoolCode" LEFT JOIN "Users" u ON u."id"=a."allocatedBy" ORDER BY a."createdAt" DESC LIMIT 100`).catch(()=>[[]]);allocationHistory=rows||[];}
    const superData = isSuper ? { schoolTokens: allTokens, allocatedTokens, totalRemainingTokens: allocatedTokens, enabledRaw: !!cfg.enabled, allocationHistory } : {};
    res.json({ success:true, data:{ enabled, tokensRemaining: schoolCode ? schoolTokens(cfg, schoolCode) : null, senderId: cfg.senderId || 'SHULEAI', providerConfigured: !!(cfg.enabled && cfg.provider && cfg.apiKey), provider: isSuper ? cfg.provider || null : undefined, apiKeySet: !!cfg.apiKey, editable: isSuper, message:'School admins can compose/send SMS only. Provider credentials are managed by Super Admin.', ...superData } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};
exports.updateConfig = async (req, res) => {
  try {
    if (!['super_admin','superadmin'].includes(String(req.user.role).toLowerCase())) return res.status(403).json({ success:false, message:'Only Super Admin can manage SMS provider credentials and token allocations.' });
    const current = await platformSms();
    const next = { ...current, provider:req.body.provider ?? current.provider, apiKey:req.body.apiKey ?? current.apiKey, senderId:req.body.senderId ?? current.senderId, enabled:req.body.enabled !== undefined ? !!req.body.enabled : current.enabled, schoolTokens:{ ...(current.schoolTokens || {}), ...(req.body.schoolTokens || {}) } };
    if (req.body.schoolCode && req.body.tokens !== undefined) {
      const code=String(req.body.schoolCode);
      const previous=Number((current.schoolTokens||{})[code]||0);
      const nextBalance=Math.max(0,Number(req.body.tokens||0));
      next.schoolTokens[code]=nextBalance;
      await sequelize.query(`INSERT INTO "SmsAllocations" ("schoolCode","quantity","allocationType","previousBalance","newBalance","reason","reference","allocatedBy","expiresAt","createdAt","updatedAt") VALUES (:schoolCode,:quantity,'set_balance',:previousBalance,:newBalance,:reason,:reference,:allocatedBy,:expiresAt,NOW(),NOW())`,{replacements:{schoolCode:code,quantity:nextBalance-previous,previousBalance:previous,newBalance:nextBalance,reason:String(req.body.reason||'SMS balance updated').slice(0,1000),reference:req.body.reference||null,allocatedBy:req.user.id,expiresAt:req.body.expiresAt||null}}).catch(()=>{});
    }
    await writeSettings('platform_sms_settings', next);
    res.json({ success:true, message:'Platform SMS settings saved', data:{ ...next, apiKey: next.apiKey ? '***set***' : null } });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};
exports.sendSms = async (req, res) => {
  try {
    const schoolCode = req.user.schoolCode;
    if (!schoolCode) return res.status(400).json({ success:false, message:'School scope is required.' });
    const features = await getSchoolFeatures(schoolCode);
    if (!(features.fullAccess || features.features.has('bulk_sms'))) return res.status(403).json({ success:false, code:'FEATURE_NOT_AVAILABLE_FOR_PLAN', message:'Bulk SMS is included for every active school. This account is currently suspended or unavailable.' });
    const cfg = await platformSms();
    if (!(cfg.enabled && cfg.provider && cfg.apiKey)) return res.status(400).json({ success:false, message:'SMS provider not configured by Super Admin.' });
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ success:false, message:'Message is required.' });
    const recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
    const audience = req.body.audience || req.body.recipientType || 'selected';
    const recipientCount = await resolveAudienceCount(schoolCode, audience, req.body.recipientCount, recipients);
    if (!recipientCount) return res.status(400).json({ success:false, message:'No recipients selected for this audience.' });
    const currentTokens = schoolTokens(cfg, schoolCode);
    if (currentTokens < recipientCount) return res.status(400).json({ success:false, message:`Not enough SMS tokens. Available: ${currentTokens}, needed: ${recipientCount}.` });
    cfg.schoolTokens = cfg.schoolTokens || {};
    cfg.schoolTokens[schoolCode] = currentTokens - recipientCount;
    await writeSettings('platform_sms_settings', cfg);
    const [rows] = await sequelize.query(`INSERT INTO "SmsOutbox" ("schoolCode","senderUserId","audience","message","recipientCount","successCount","failedCount","tokensUsed","mode","status","createdAt","updatedAt") VALUES (:schoolCode,:senderUserId,:audience,:message,:recipientCount,:successCount,0,:tokensUsed,'platform','sent',NOW(),NOW()) RETURNING *`, { replacements:{ schoolCode, senderUserId:req.user.id, audience, message, recipientCount, successCount:recipientCount, tokensUsed:recipientCount } });
    res.json({ success:true, message:'SMS queued/sent successfully', data:{ record:rows?.[0] || null, tokensRemaining: cfg.schoolTokens[schoolCode], reached:recipientCount, failed:0, tokensUsed:recipientCount } });
  } catch(error) { console.error('Send SMS error:', error); res.status(500).json({ success:false, message:error.message }); }
};
exports.getHistory = async (req, res) => {
  try {
    const schoolCode = req.user.schoolCode;
    const isSuper = ['super_admin','superadmin'].includes(String(req.user.role).toLowerCase());
    if (!schoolCode && !isSuper) return res.json({ success:true, data:[] });
    const sql = isSuper && !schoolCode
      ? `SELECT sms.*, COALESCE(NULLIF(s."name", 'Shule AI'), s."shortCode", sms."schoolCode") AS "schoolName" FROM "SmsOutbox" sms LEFT JOIN "Schools" s ON s."schoolId" = sms."schoolCode" ORDER BY sms."createdAt" DESC LIMIT 200`
      : `SELECT * FROM "SmsOutbox" WHERE "schoolCode" = :schoolCode ORDER BY "createdAt" DESC LIMIT 100`;
    const [rows] = await sequelize.query(sql, { replacements:{ schoolCode } }).catch(() => [[]]);
    res.json({ success:true, data:rows || [] });
  } catch(error) { res.status(500).json({ success:false, message:error.message }); }
};
