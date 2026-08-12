const FULL_FINANCE=['overview','fee_structures','invoices','payments','verification','balances','defaulters','receipts','bursaries','expenses','reconciliation','analytics','reports','settings','alerts','audit'];
const BURSAR=['overview','fee_structures','invoices','payments','verification','balances','defaulters','receipts','bursaries','reports','settings','analytics','alerts'];
const ACCOUNTANT=['overview','payments','verification','expenses','reconciliation','analytics','reports','audit'];
function titleOf(user){return String(user?.financeTitle||user?.preferences?.finance?.title||'Finance Officer').trim().toLowerCase();}
function defaultsFor(user){const title=titleOf(user);if(title==='bursar')return BURSAR;if(title==='accountant')return ACCOUNTANT;return FULL_FINANCE;}
function allowedPermissions(user){const custom=user?.financePermissions||user?.preferences?.finance?.permissions;if(Array.isArray(custom)&&custom.length){const allowed=[...new Set(custom)];if(titleOf(user)==='bursar'){['settings','analytics'].forEach(p=>{if(!allowed.includes(p))allowed.push(p);});}return allowed;}return defaultsFor(user);}
module.exports=function(permission,{adminAllowed=false}={}){return(req,res,next)=>{if(req.user?.role==='super_admin')return next();if(adminAllowed&&req.user?.role==='admin')return next();if(req.user?.role==='admin')return res.status(403).json({success:false,code:'ADMIN_FINANCE_OVERVIEW_ONLY',message:'School Admin has Finance Overview only. Assign Finance Officer/Bursar/Accountant for operations.'});if(req.user?.role!=='finance_officer')return res.status(403).json({success:false,message:'Finance staff access required.'});const allowed=allowedPermissions(req.user);if(!allowed.includes(permission))return res.status(403).json({success:false,code:'FINANCE_PERMISSION_REQUIRED',message:`Finance permission required: ${permission}`});next();};};
module.exports.allowedPermissions=allowedPermissions;
module.exports.defaultsFor=defaultsFor;
module.exports.FULL_FINANCE=FULL_FINANCE;
module.exports.BURSAR=BURSAR;
module.exports.ACCOUNTANT=ACCOUNTANT;
