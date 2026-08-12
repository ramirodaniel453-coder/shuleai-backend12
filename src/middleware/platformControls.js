const { getPlatformSettings } = require('../services/platformSettingsService');

function maintenanceExempt(req) {
  const path=String(req.originalUrl||req.url||'').toLowerCase();
  if (/^\/(api\/)?health(?:\/|$)/.test(path)) return true;
  if (path.startsWith('/api/auth/super-admin/login')) return true;
  if (path.startsWith('/api/super-admin/')) return true;
  if (path.startsWith('/api/media/')) return true;
  if (/\/api\/payments\/(webhook|mpesa\/callback|daraja\/callback|callback)/.test(path)) return true;
  return false;
}
async function enforceMaintenanceMode(req,res,next){
  try { const settings=await getPlatformSettings(); if(settings.maintenanceMode && !maintenanceExempt(req)) return res.status(503).json({success:false,code:'PLATFORM_MAINTENANCE',message:'ShuleAI is temporarily in maintenance mode.'}); return next(); }
  catch(error){ return next(error); }
}
async function requireRegistrationsEnabled(req,res,next){
  try { const settings=await getPlatformSettings(); if(!settings.allowNewRegistrations) return res.status(403).json({success:false,code:'REGISTRATIONS_CLOSED',message:'New registrations are currently closed.'}); return next(); }
  catch(error){ return next(error); }
}
module.exports={enforceMaintenanceMode,requireRegistrationsEnabled};
