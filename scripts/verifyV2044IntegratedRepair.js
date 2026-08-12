'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(root, rel));
const checks=[];
function check(id, description, fn){
  try { const result=fn(); if(result===false) throw new Error('assertion returned false'); checks.push({id,description,ok:true}); }
  catch(error){ checks.push({id,description,ok:false,error:error.message}); }
}
function has(rel, re){ return re.test(read(rel)); }
function assert(cond,msg){ if(!cond) throw new Error(msg); }

check('CR-01','Platform settings persist, audit, and enforce maintenance/registration',()=>{
  assert(exists('backend/src/models/PlatformSetting.js'),'PlatformSetting model missing');
  assert(has('backend/src/services/platformSettingsService.js',/findOrCreate[\s\S]*AuditLog\.create/),'settings service is not persisted/audited');
  assert(has('backend/src/middleware/platformControls.js',/maintenanceMode[\s\S]*allowNewRegistrations/),'platform controls not enforced');
});
check('CR-02','Backup creates and verifies a real PostgreSQL artifact',()=>{
  const s=read('backend/src/services/platformBackupService.js');
  assert(/pg_dump/.test(s)&&/--format=custom/.test(s)&&/pg_restore/.test(s)&&/sha256|sha-256/i.test(s),'real dump/verification/checksum workflow missing');
  assert(!/size\s*:\s*0|0\s*MB/.test(read('backend/src/controllers/superAdminController.js')),'fake zero-size backup response remains');
});
check('CR-03','Full platform export excludes credential fields',()=>{
  const s=read('backend/src/controllers/superAdminController.js');
  assert(/User\.findAll\(\{\s*attributes:\s*\{\s*exclude:\s*\[[^\]]*password[^\]]*tokenVersion/.test(s),'credential exclusion missing');
});
check('CR-04','Frontend has context-safe helpers and audited XSS paths no longer use raw sink values',()=>{
  const idx=read('frontend/index.html'); const sec=read('frontend/js/security.js');
  assert(/Content-Security-Policy/i.test(idx),'CSP missing');
  assert(/ShuleSafe/.test(sec)&&/textContent|escapeHtml|attr/.test(sec),'safe DOM helpers missing');
  assert(!/statusDiv\.innerHTML\s*=\s*`[^`]*schoolName/.test(read('frontend/js/auth-modal.js')),'school-name innerHTML sink remains');
});
check('CR-05','Parent absence reports are requests, not authoritative attendance writes',()=>{
  const s=read('backend/src/controllers/parentController.js');
  const start=s.indexOf('exports.reportAbsence'); const end=s.indexOf('\nexports.',start+20); const body=s.slice(start,end>start?end:undefined);
  assert(/AbsenceReport\.create/.test(body),'AbsenceReport request creation missing');
  assert(!/Attendance\.(create|update|upsert|destroy)|\.update\([^\)]*Attendance/.test(body),'parent absence path still mutates Attendance');
});
check('CR-06','LearnFeed public signup cannot self-verify as teacher',()=>{
  const s=read('backend/src/controllers/learnFeedController.js');
  assert(/role:'student'/.test(s)&&/verificationStatus:requestedRole === 'teacher' \? 'pending' : 'unverified'/.test(s),'public signup role lock missing');
  assert(/verificationStatus === 'verified'/.test(s)&&/verifiedAt/.test(s),'verified badge is not proof-based');
});
check('CR-07','Socket.IO parser lock is patched',()=>{
  const l=require(path.join(backend,'package-lock.json')); assert(l.packages['node_modules/socket.io-parser']?.version==='4.2.7','socket.io-parser is not 4.2.7');
});
check('MO-01','Operational authorize middleware is defined',()=>assert(has('backend/src/app.js',/\{\s*protect\s*,\s*authorize\s*\}\s*=\s*require\(['"]\.\/middleware\/auth/),'authorize import missing'));
check('MO-02','Clear-cache action invalidates registered caches',()=>assert(has('backend/src/controllers/superAdminController.js',/clearRegisteredCaches\(/)&&has('backend/src/services/cacheRegistry.js',/registerCache[\s\S]*clearRegisteredCaches/),'real cache registry missing'));
check('MO-03','Password policy and token revocation are server-enforced',()=>{
  const a=read('backend/src/controllers/authController.js'), p=read('backend/src/utils/passwordPolicy.js'), u=read('backend/src/models/User.js'), e=read('backend/src/config/requiredEnv.js');
  assert(/length\s*<\s*12/.test(p)&&/assertStrongPassword/.test(a),'12-character server policy missing'); assert(/tokenVersion/.test(a)&&/tokenVersion/.test(u),'token revocation version missing'); assert(/JWT_REFRESH_SECRET/.test(e)&&/distinct|different|must not match/i.test(e),'distinct refresh secret enforcement missing');
});
check('MO-04','brace-expansion lock is patched',()=>{ const l=require(path.join(backend,'package-lock.json')); assert(l.packages['node_modules/brace-expansion']?.version==='5.0.9','brace-expansion is not 5.0.9'); });
check('MO-05','feeStructureId model types are canonical INTEGER',()=>{
  for(const f of ['Fee.js','Payment.js','FeeInvoice.js']){ const s=read('backend/src/models/'+f); const i=s.indexOf('feeStructureId'); assert(i>=0 && /DataTypes\.INTEGER/.test(s.slice(i,i+350)),`${f} feeStructureId not INTEGER`); }
});
check('MO-06','All audited school-scoped models declare Schools.schoolId references',()=>{
  const files=['UserRoleAssignment','Student','AcademicRecord','Attendance','Fee','Payment','PaymentEvent','Message','UploadLog','HomeTask','HomeTaskAssignment','ChatMessage','ClassroomThread','AchievementEvent','TutorSession','TutorMessage','TutorProgress','TutorUsage','AuditLog','ReportSnapshot','SchoolPaymentSetting','Subscription','SubscriptionPayment','RealtimeEvent','AttendanceSession','AttendanceCorrection','ClassRelease','StudentEnrollment','PromotionBatch','PromotionDecision','ClassTransferRequest','ReportShare','BirthdayEvent','MediaAsset','FinanceExpense','FeeInvoice','FeeInvoiceItem','StudentFeeAccount','PaymentTransaction','PaymentReconciliation','ProviderCredentialsAudit','PaymentRefund','PlatformSubscription','BackgroundJob'];
  const missing=[]; for(const n of files){ const s=read(`backend/src/models/${n}.js`); const i=s.indexOf('schoolCode'); if(i<0 || !/references\s*:\s*\{\s*model\s*:\s*['"]Schools['"]\s*,\s*key\s*:\s*['"]schoolId['"]/.test(s.slice(i,i+550))) missing.push(n); }
  assert(!missing.length,'missing tenant refs: '+missing.join(', '));
});
check('MO-07','Relation-like identifiers are constrained or explicitly documented',()=>{
  assert(exists('backend/MODEL_RELATIONSHIP_INTENT.md'),'relationship intent document missing');
  const m=read('backend/src/migrations/20260807000000-v2044-integrated-audit-repair.js'); assert(/relation|foreign key|constraint/i.test(m),'integrated relationship migration missing');
});
check('MO-08','Migrations are the sole schema mutation authority',()=>{
  const files=[]; function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name); if(d.isDirectory()){if(d.name!=='migrations'&&d.name!=='node_modules')walk(p);} else if(p.endsWith('.js'))files.push(p);}} walk(path.join(backend,'src'));
  const offenders=[]; for(const f of files){const s=fs.readFileSync(f,'utf8'); if(/sequelize\.sync\s*\(|queryInterface\.(addColumn|createTable|changeColumn|removeColumn)\s*\(|\bALTER\s+TABLE\b|\bCREATE\s+TABLE\b/i.test(s)) offenders.push(path.relative(root,f));}
  assert(!offenders.length,'runtime DDL remains: '+offenders.join(', '));
});
check('MO-09','Migrations do not silently advertise empty rollback support',()=>{
  const dir=path.join(backend,'src','migrations'); const weak=[]; for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.js'))){const s=fs.readFileSync(path.join(dir,name),'utf8'); const m=s.match(/\bdown\s*:\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\}/)||s.match(/\bdown\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/); if(m){const body=m[1].replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'').trim(); if(!body)weak.push(name);}}
  assert(!weak.length,'empty down(): '+weak.join(', '));
});
check('MO-10','database module has no import-time authentication side effect',()=>assert(!/sequelize\.authenticate\s*\(/.test(read('backend/src/config/database.js')),'database.js authenticates on import'));
check('MO-11','Auth middleware separates token errors from internal/database errors',()=>{
  const s=read('backend/src/middleware/auth.js'); assert(/jwt\.verify/.test(s)&&/next\(error\)|next\(err\)/.test(s),'auth internal error propagation missing');
});
check('MO-12','Unhandled rejection triggers graceful process exit',()=>{const s=read('backend/server.js'); assert(/unhandledRejection/.test(s)&&/process\.exit\(1\)/.test(s),'unhandled rejection does not terminate safely');});
check('MO-13','HTTP and Socket.IO share an exact CORS origin policy',()=>assert(has('backend/server.js',/corsOrigins/)&&has('backend/src/app.js',/corsOrigins/),'shared CORS module not used'));
check('MO-14','System-events database errors propagate instead of fake empty success',()=>{const s=read('backend/src/controllers/superAdminController.js'); const block=s.match(/exports\.getRecentEvents\s*=\s*async[\s\S]*?(?=\n\/\/ @desc|\nexports\.)/); assert(block && /catch\s*\([^)]*\)\s*\{[\s\S]*?return\s+next\(/.test(block[0]),'system-events catch does not propagate');});
check('MO-15','Load average is not fabricated as CPU percent',()=>{const s=read('backend/src/controllers/superAdminController.js'); const block=s.match(/exports\.getSystemMetrics\s*=\s*async[\s\S]*?(?=\n\/\/ @desc|\nexports\.)/); assert(block && /cpuSnapshot/.test(block[0]) && /cpuUsage/.test(block[0]) && /\[load1,\s*load5,\s*load15\]\s*=\s*os\.loadavg\(\)/.test(block[0]),'real CPU/load metrics are missing'); assert(!/cpuMin|cpuMax/.test(block[0]),'fabricated CPU min/max fields remain');});
check('MO-16','Business IDs use high-entropy/DB-safe generators',()=>{const models=['Student.js','Teacher.js','Parent.js','Admin.js','School.js','Payment.js'].map(f=>read('backend/src/models/'+f)).join('\n'); const ids=read('backend/src/utils/businessIds.js'); assert(/crypto\.randomBytes/.test(ids) && /crypto\.randomUUID/.test(ids),'high-entropy ID generator missing'); assert(/yearlyBusinessId/.test(models) && /createTransactionId|transactionId/.test(models),'models are not wired to canonical ID generator');});
check('MO-17','Media upload validates bytes and blocks active SVG serving',()=>{const s=read('backend/src/services/mediaAssetService.js')+read('backend/src/controllers/mediaController.js'); assert(/magic|signature|file-type|PNG|JPEG|WEBP/i.test(s)&&/svg/i.test(s)&&/nosniff/i.test(s),'media hardening incomplete');});
check('MO-18','Public duty sharing is opt-in and token protected',()=>{const s=read('backend/src/controllers/publicController.js'); assert(/shareToken/.test(s)&&/enabled/.test(s),'public duty token/enable gate missing');});
check('MO-19','CSV formula injection is neutralized',()=>{const s=read('frontend/js/helpers.js')+read('frontend/js/finance-fees.js'); assert(/\^\[=\+\\-@\\t\\r\]/.test(s),'CSV formula prefix neutralization missing');});
check('MO-20','PWA shell caches local application assets and third-party scripts are pinned',()=>{const sw=read('frontend/service-worker.js'), idx=read('frontend/index.html'); assert(/shared-runtime\.js/.test(sw)&&/security\.js/.test(sw)&&/cache\.addAll|addAll\(/.test(sw),'app shell cache incomplete'); assert(!/(cdn\.tailwindcss\.com\/(?:['"]|\s)|chart\.js\/dist|lucide@latest)/i.test(idx),'unpinned runtime CDN remains');});
check('MO-21','Helpful reply is persisted through a backend endpoint',()=>{const b=read('backend/src/controllers/chatV9Controller.js'), f=read('frontend/js/chat-v9-ui.js'); assert(/helpfulBy/.test(b)&&/v9HelpfulReply/.test(f)&&/apiRequest|chat/.test(f),'helpful action is not persisted');});
check('MO-22','Approved/fake visual override layer is removed from active runtime',()=>{const idx=read('frontend/index.html'); assert(!/approved-visuals\.js|runtime-integrity-guards\.js/.test(idx),'override/guard layer still loaded'); assert(!exists('frontend/js/approved-visuals.js'),'legacy approved visual override file remains');});
check('MO-23','Active frontend has no duplicate action/function owners across files',()=>{
  const idx=read('frontend/index.html'); const srcs=[...idx.matchAll(/<script[^>]+src=["'](js\/[^"'?]+)[^"']*["']/g)].map(m=>m[1]);
  const actionOwners=new Map(); const ignore=new Set(['currentSchool','customSubjects','dashboardData','schoolBranding','schoolSettings','studentDashboardData','__brokenProfileImageFiles','__teacherAssignments']);
  for(const src of srcs){const s=read('frontend/'+src); for(const m of s.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)){const n=m[1]; if(ignore.has(n))continue; if(!actionOwners.has(n))actionOwners.set(n,new Set()); actionOwners.get(n).add(src);}}
  const dup=[...actionOwners].filter(([,v])=>v.size>1).map(([k,v])=>`${k}:${[...v].join('|')}`); assert(!dup.length,'duplicate action owners: '+dup.join(', '));
});
check('MO-24','Advertised AI report endpoints are implemented, not permanent 403 stubs',()=>{const s=read('backend/src/controllers/tutorController.js'); assert(!/parent.*report[\s\S]{0,300}status\(403\)[\s\S]{0,100}not enabled/i.test(s),'AI report stub remains');});
check('MI-01','Chat emoji/group controls are wired',()=>{const s=read('frontend/js/chat-v9-ui.js'); assert(/v9InsertEmoji/.test(s)&&/v9CloseModal/.test(s),'chat controls are inert');});
check('MI-02','Notification delete/clear operations are implemented',()=>{const s=read('frontend/js/notifications.js'); assert(/deleteNotification[\s\S]*api/i.test(s)&&/clearAllNotifications[\s\S]*api/i.test(s),'notification actions remain empty');});
check('MI-03','Legacy simulated/local student chat is not shipped as an active path',()=>{const a=read('frontend/js/student-dashboard.js'), b=read('frontend/js/student-dashboard-extended.js'); assert(!/setTimeout\([^\n]*AI|simulat(e|ed).*response/i.test(a+b),'simulated chat path remains');});
check('MI-04','Manifest icon files match declared 192/512 dimensions',()=>{const m=JSON.parse(read('frontend/manifest.json')); assert(m.icons.some(x=>x.src.includes('icon-192.png')&&x.sizes==='192x192'),'192 icon metadata missing'); assert(m.icons.some(x=>x.src.includes('icon-512.png')&&x.sizes==='512x512'),'512 icon metadata missing'); assert(exists('frontend/assets/icon-192.png')&&exists('frontend/assets/icon-512.png'),'generated icon files missing');});
check('MI-05','PWA meta declarations are not duplicated',()=>{const idx=read('frontend/index.html'); const count=x=>(idx.match(new RegExp(x,'g'))||[]).length; assert(count('name="theme-color"')===1,'theme-color duplicated'); assert(count('apple-mobile-web-app-capable')===1,'apple capable duplicated');});
check('MI-06','Teacher marks permission helper has one canonical definition',()=>{const s=read('backend/src/controllers/teacherController.js'); const defs=(s.match(/(?:const|let|var)\s+v66CanEnterMarks\s*=|function\s+v66CanEnterMarks\s*\(/g)||[]); assert(defs.length===1,'teacher marks helper does not have exactly one definition'); assert(/const\s+v66CanEnterMarks\s*=/.test(s),'teacher marks helper is not immutable');});
check('MI-07','Super-admin request history is database-backed',()=>{assert(has('backend/src/controllers/superAdminController.js',/getRequestHistory[\s\S]*SchoolNameRequest/)&&has('frontend/js/superadmin-dashboard.js',/getRequestHistory/),'request history remains placeholder');});

const failed=checks.filter(x=>!x.ok);
for(const c of checks) console.log(`${c.ok?'PASS':'FAIL'} ${c.id} ${c.description}${c.ok?'':` :: ${c.error}`}`);
console.log(`\nV2044_AUDIT_CHECKS total=${checks.length} pass=${checks.length-failed.length} fail=${failed.length}`);
if(failed.length) process.exitCode=1;
