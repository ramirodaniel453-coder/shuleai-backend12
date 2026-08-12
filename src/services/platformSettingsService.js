const { PlatformSetting, AuditLog, sequelize } = require('../models');
const { registerCache } = require('./cacheRegistry');

const DEFAULTS = Object.freeze({ platformName:'ShuleAI', defaultCurriculum:'cbc', nameChangeFee:50, maintenanceMode:false, allowNewRegistrations:true, contactEmail:'support@shuleai.com', supportPhone:'+254 700 000 000' });
const ALLOWED = new Set(Object.keys(DEFAULTS));
let cached = null; let expiresAt = 0;

function normalizePatch(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) if (ALLOWED.has(key)) out[key] = value;
  if (out.platformName !== undefined) out.platformName = String(out.platformName || '').trim().slice(0,120);
  if (out.defaultCurriculum !== undefined && !['cbc','844','british','american'].includes(String(out.defaultCurriculum))) throw Object.assign(new Error('Invalid default curriculum.'), { status:400 });
  if (out.nameChangeFee !== undefined) { const n=Number(out.nameChangeFee); if(!Number.isInteger(n)||n<0||n>1000000) throw Object.assign(new Error('Invalid name change fee.'), {status:400}); out.nameChangeFee=n; }
  if (out.maintenanceMode !== undefined) out.maintenanceMode = Boolean(out.maintenanceMode);
  if (out.allowNewRegistrations !== undefined) out.allowNewRegistrations = Boolean(out.allowNewRegistrations);
  if (out.contactEmail !== undefined) { const v=String(out.contactEmail||'').trim().toLowerCase(); if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw Object.assign(new Error('Invalid contact email.'),{status:400}); out.contactEmail=v; }
  if (out.supportPhone !== undefined) out.supportPhone = String(out.supportPhone || '').trim().slice(0,40);
  return out;
}

async function ensureRow(transaction = null) {
  const [row] = await PlatformSetting.findOrCreate({ where:{id:1}, defaults:{id:1,...DEFAULTS}, transaction });
  return row;
}
async function getPlatformSettings({ fresh=false } = {}) {
  if (!fresh && cached && Date.now() < expiresAt) return { ...cached };
  const row = await ensureRow(); cached = row.toJSON(); expiresAt = Date.now()+5000; return { ...cached };
}
function clearPlatformSettingsCache() { const had = cached ? 1 : 0; cached=null; expiresAt=0; return had; }
registerCache('platform-settings', clearPlatformSettingsCache);
async function updatePlatformSettings(patch, actor, reqMeta={}) {
  const normalized = normalizePatch(patch);
  return sequelize.transaction(async transaction => {
    const row = await ensureRow(transaction); const before=row.toJSON();
    await row.update({ ...normalized, updatedBy: actor?.id || null }, { transaction });
    await AuditLog.create({ schoolCode:null, actorUserId:actor?.id||null, actorRole:actor?.role||'super_admin', module:'platform', action:'platform.settings.update', entityType:'PlatformSetting', entityId:'1', before, after:row.toJSON(), ipAddress:reqMeta.ip||null, userAgent:reqMeta.userAgent||null, metadata:{ changed:Object.keys(normalized) } }, {transaction});
    clearPlatformSettingsCache(); return row.toJSON();
  });
}
async function resetPlatformSettings(actor, reqMeta={}) { return updatePlatformSettings(DEFAULTS, actor, reqMeta); }
module.exports = { DEFAULTS, getPlatformSettings, updatePlatformSettings, resetPlatformSettings, clearPlatformSettingsCache };
