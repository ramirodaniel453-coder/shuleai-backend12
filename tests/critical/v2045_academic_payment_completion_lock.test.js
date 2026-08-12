'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const seed = require('../../src/data/v2045CurriculumSeed');

test('v2045 country registry contains only the locked first-release scope', () => {
  assert.deepEqual(seed.COUNTRIES.map(row => row.isoCode).sort(), ['BI','CD','KE','NG','RW','SO','SS','TZ','UG']);
  assert.equal(new Set(seed.COUNTRIES.map(row => row.isoCode)).size, 9);
  assert.ok(seed.COUNTRIES.every(row => row.region === 'Africa' && row.isSupported));
});

test('v2045 packs are country-filterable and unreviewed national content cannot activate', () => {
  for (const country of seed.COUNTRIES) {
    assert.ok(seed.CURRICULUM_PACKS.some(pack => pack.countryIsoCode === country.isoCode), `missing pack for ${country.isoCode}`);
  }
  const pending = seed.CURRICULUM_PACKS.filter(pack => pack.countryIsoCode !== 'KE');
  assert.ok(pending.length >= 8);
  assert.ok(pending.every(pack => pack.reviewStatus === 'pending_review' && pack.activationStatus === 'inactive'));
  assert.ok(pending.every(pack => pack.metadata.humanActivationRequired === true));
  assert.ok(seed.CURRICULUM_PACKS.every(pack => Array.isArray(pack.sourceReferences) && pack.sourceReferences.length));
});

test('v2045 legacy Kenya mappings cover every existing School.system value', () => {
  for (const key of ['cbc','844','british','american']) {
    assert.match(seed.LEGACY_SYSTEM_PACK_IDS[key], /^[0-9a-f-]{36}$/i);
    const pack = seed.CURRICULUM_PACKS.find(row => row.id === seed.LEGACY_SYSTEM_PACK_IDS[key]);
    assert.ok(pack && pack.countryIsoCode === 'KE');
    assert.equal(pack.activationStatus, 'active');
    assert.ok(pack.levels.length > 0);
    assert.ok(pack.subjectStructure.length > 0);
    assert.ok(pack.gradingProfiles.length > 0);
  }
});

test('v2045 canonical models and immutable assessment snapshot columns are defined', () => {
  const index = read('src/models/index.js');
  for (const model of ['Country','CurriculumPack','SchoolCurriculumAssignment','SchoolGradingProfile']) {
    assert.match(index, new RegExp(`require\\('./${model}'\\)`));
    assert.ok(fs.existsSync(path.join(root, `src/models/${model}.js`)));
  }
  const academic = read('src/models/AcademicRecord.js');
  for (const column of ['curriculumPackId','curriculumPackVersion','curriculumSnapshot','gradingProfileCode','gradingProfileVersion','gradingSnapshot','competencyEvidence']) {
    assert.match(academic, new RegExp(`\\b${column}\\b`));
  }
});

test('v2045 migration preserves locked counts, digests history, and refuses unsafe rollback', () => {
  const migration = read('src/migrations/20260811000000-v2045-country-curriculum-academic-lock.js');
  assert.match(migration, /PROTECTED_TABLES/);
  assert.match(migration, /academicLegacyDigest/);
  assert.match(migration, /v2045_kenya_backfill/);
  assert.match(migration, /zero-data-loss gate failed/);
  assert.match(migration, /Unsafe rollback refused/);
  assert.match(migration, /SchemaRepairQuarantine/);
  assert.match(migration, /addIndexIfMissing/);
  assert.match(migration, /forwardRepair:up/);
  assert.doesNotMatch(migration, /DROP TABLE[^\n]+Schools/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+"?(Schools|Students|Classes|AcademicRecords)/i);
});

test('v2045 admin workflow is country-filtered, versioned, audited, and non-destructive', () => {
  const routes=read('src/routes/adminRoutes.js');
  const service=read('src/services/curriculumPackService.js');
  const api=read('../frontend/js/api.js');
  for(const route of ['/curriculum/countries','/curriculum/packs','/curriculum/workflow','/curriculum/grading-profiles']) assert.ok(routes.includes(route));
  assert.match(service,/SchoolCurriculumAssignment\.create/);
  assert.match(service,/school_curriculum_changed/);
  assert.match(service,/status:'superseded'/);
  assert.match(service,/CURRICULUM_PACK_NOT_REVIEWED/);
  assert.match(service,/existingClassesMutated:false/);
  assert.doesNotMatch(service,/Class\.(destroy|update)\(/);
  assert.match(api,/getCurriculumWorkflow/);
  assert.match(api,/saveCurriculumWorkflow/);
});

test('v2045 learner curriculum resolver follows enrollment to class to school pack only', () => {
  const service=read('src/services/curriculumPackService.js');
  const resolver=service.slice(service.indexOf('async function resolveStudentCurriculum'),service.indexOf('module.exports='));
  assert.match(service,/StudentEnrollment\.findOne/);
  assert.match(service,/Class\.findOne\(\{where:\{id:enrollment\.classId,schoolCode\}/);
  assert.match(service,/getSchoolCurriculumContext\(schoolCode/);
  assert.match(service,/CLASS_CURRICULUM_LEVEL_MISMATCH/);
  assert.doesNotMatch(resolver,/\bpayload\b/);
  assert.doesNotMatch(resolver,/\breq\b/);
});

test('v2045 custom grading profiles are admin-owned, immutable versions with activation audit', () => {
  const service=read('src/services/curriculumPackService.js');
  assert.match(service,/version:Number\(previous\?\.version\|\|0\)\+1/);
  assert.match(service,/custom_grading_profile_created/);
  assert.match(service,/custom_grading_profile_activated/);
  assert.match(service,/checksum:hash\(profile\)/);
  assert.match(service,/Grading bands must not overlap/);
});

test('v2045 has one backend grading engine for competency, numerical, qualification, GPA, and programme profiles', () => {
  const engine=require('../../src/services/gradingEngine');
  assert.equal(engine.evaluateProfile({rawMark:80,profile:engine.LEGACY_PROFILES.cbc}).grade,'EE');
  assert.equal(engine.evaluateProfile({rawMark:81,profile:engine.LEGACY_PROFILES['844']}).grade,'A');
  assert.equal(engine.evaluateProfile({rawMark:92,profile:engine.LEGACY_PROFILES.british}).grade,'A*');
  assert.equal(engine.evaluateProfile({rawMark:95,profile:engine.LEGACY_PROFILES.american}).points,4);
  const nigeria={code:'ng_stage',version:'review-test',mode:'programme_stage_bands',stages:{jss_1:{bands:[{min:70,max:100,label:'A'},{min:0,max:69.999,label:'B'}]}}};
  assert.equal(engine.evaluateProfile({rawMark:72,profile:nigeria,levelCode:'jss_1'}).grade,'A');
  const evidence={outcome:'Can explain the method',artifactId:'evidence-1'};
  assert.equal(engine.evaluateProfile({rawMark:65,profile:engine.LEGACY_PROFILES.cbc,competencyEvidence:evidence}).evidenceStatus,'provided');
  assert.equal(engine.normalizeMark(40,50).percentage,80);
});

test('v2045 assessment creation resolves curriculum server-side and persists immutable snapshots', () => {
  const engine=read('src/services/gradingEngine.js');
  const teacher=read('src/controllers/teacherController.js');
  const academic=read('src/models/AcademicRecord.js');
  assert.match(engine,/curriculumPackService\.resolveStudentCurriculum/);
  assert.match(engine,/buildSnapshots/);
  assert.match(engine,/assignmentVersion/);
  assert.match(teacher,/gradingEngine\.gradeNewAssessment/);
  assert.match(teacher,/gradingEngine\.gradeDraftUpdate/);
  assert.match(teacher,/TEACHER_GRADING_SCALE_FORBIDDEN/);
  assert.doesNotMatch(teacher,/req\.body\.gradingScale/);
  assert.match(academic,/Historical assessment field \$\{field\} is immutable/);
  assert.match(academic,/beforeBulkUpdate/);
});

test('v2045 removes browser and student-controller grading calculations', () => {
  const frontendRoot=path.resolve(root,'../frontend/js');
  const frontendFiles=fs.readdirSync(frontendRoot).filter(name=>name.endsWith('.js'));
  for(const name of frontendFiles){
    const source=fs.readFileSync(path.join(frontendRoot,name),'utf8');
    assert.doesNotMatch(source,/\bgetGradeFromScore\s*\(/,`${name} calculates a grade in the browser`);
    assert.doesNotMatch(source,/gradingScale\s*:\s*(gradingScale|window\.)/,`${name} submits a grading scale`);
  }
  const student=read('src/controllers/studentController.js');
  const parent=read('src/controllers/parentController.js');
  assert.doesNotMatch(student,/function\s+getGradeFromScore/);
  assert.match(student,/gradingEngine\.storedGrade/);
  assert.doesNotMatch(parent,/const\s+gradeFromScore\s*=/);
  assert.match(parent,/gradingEngine\.storedGrade/);
});

test('v2045 Kenya backfill initializes assignment scope and class links without moving learners', () => {
  const migration=read('src/migrations/20260811000000-v2045-country-curriculum-academic-lock.js');
  assert.match(migration,/jsonb_array_elements\(p\."educationStages"\)/);
  assert.match(migration,/jsonb_array_elements\(p\.levels\)/);
  assert.match(migration,/jsonb_array_elements\(p\."subjectStructure"\)/);
  assert.match(migration,/UPDATE "Classes" c[\s\S]*"curriculumPackId"/);
  assert.doesNotMatch(migration,/UPDATE "Students"[\s\S]*"classId"/);
  assert.doesNotMatch(migration,/UPDATE "StudentEnrollments"[\s\S]*"classId"/);
});

test('v2045 class generation is curriculum-pack controlled and supports all locked modes', () => {
  const service=require('../../src/services/classGenerationService');
  const pack={id:'pack-1',version:'2026',officialCode:'OFFICIAL',legacySystemCode:'cbc',countryIsoCode:'KE',levels:[{code:'grade_1',label:'Grade 1',group:'Primary',order:1},{code:'grade_2',label:'Grade 2',group:'Primary',order:2}],classNamingRules:{separator:' '},streamGenerationRules:{modes:['none','global','per_level','custom']},subjectStructure:[]};
  const school={schoolId:'SCHOOL',settings:{}};
  const makeContext=config=>({pack,assignment:{id:'assignment-1',assignmentVersion:2,enabledLevelCodes:['grade_1','grade_2'],selectedSubjectCodes:[],classGenerationConfig:config}});
  assert.deepEqual(service.buildExpectedClasses(school,makeContext({streamMode:'none'})).map(row=>row.name),['Grade 1','Grade 2']);
  assert.deepEqual(service.buildExpectedClasses(school,makeContext({streamMode:'global',streams:['East','West']})).map(row=>row.name),['Grade 1 East','Grade 1 West','Grade 2 East','Grade 2 West']);
  assert.deepEqual(service.buildExpectedClasses(school,makeContext({streamMode:'per_level',perLevelStreams:{grade_1:['A','B']}})).map(row=>row.name),['Grade 1 A','Grade 1 B','Grade 2']);
  assert.deepEqual(service.buildExpectedClasses(school,makeContext({streamMode:'custom',customClasses:[{name:'Foundations Blue',levelCode:'grade_1'}]})).map(row=>row.name),['Foundations Blue']);
});

test('v2045 class generation retains preview-token, transaction, create-missing-only, and learner-preservation locks', () => {
  const service=read('src/services/classGenerationService.js');
  const frontend=read('../frontend/js/curriculum.js');
  assert.match(service,/CLASS_GENERATION_PREVIEW_STALE/);
  assert.match(service,/sequelize\.transaction/);
  assert.match(service,/existingNames\.has/);
  assert.match(service,/curriculumPackId:spec\.curriculumPackId/);
  assert.match(service,/learnersMoved:false/);
  assert.doesNotMatch(service,/Class\.(destroy|update)\(/);
  assert.doesNotMatch(service,/Student\.(update|destroy)\(/);
  assert.doesNotMatch(frontend,/\bprompt\s*\(/);
  assert.doesNotMatch(frontend,/generateClassesFromCurriculum/);
  assert.match(frontend,/previewClassGeneration/);
  assert.match(frontend,/generateClassesFromSettings\(preview\.previewToken\)/);
});

test('v2045 payment certification decision rejects or holds every unsafe finalization case', () => {
  const engine=require('../../src/services/paymentProviderEngine');
  const payment={paymentGateway:'mpesa',schoolCode:'SCH-1',amount:1000,currency:'KES',expiresAt:new Date(Date.now()+60000)};
  assert.equal(engine.certificationDecision({payment,provider:'mpesa',status:'paid',amount:1000,currency:'KES',schoolCode:'SCH-1'}).action,'complete');
  assert.deepEqual(engine.certificationDecision({payment,provider:'pesapal',status:'paid',amount:1000,currency:'KES'}),{action:'reject',reason:'provider_mismatch'});
  assert.deepEqual(engine.certificationDecision({payment,provider:'mpesa',status:'paid',amount:1000,currency:'KES',schoolCode:'SCH-2'}),{action:'reject',reason:'school_mismatch'});
  assert.equal(engine.certificationDecision({payment,provider:'mpesa',status:'paid',amount:999,currency:'KES'}).reason,'amount_mismatch');
  assert.equal(engine.certificationDecision({payment,provider:'mpesa',status:'paid',amount:1000,currency:'USD'}).reason,'currency_mismatch');
  assert.equal(engine.certificationDecision({payment,provider:'mpesa',status:'paid',amount:null,currency:'KES'}).reason,'missing_confirmed_amount');
  assert.equal(engine.certificationDecision({payment:{...payment,expiresAt:new Date(Date.now()-60000)},provider:'mpesa',status:'paid',amount:1000,currency:'KES'}).reason,'late_provider_confirmation');
  assert.equal(engine.certificationDecision({payment,provider:'mpesa',status:'failed',amount:null,currency:'KES'}).action,'fail');
  assert.equal(engine.certificationDecision({payment,provider:'mpesa',status:'pending',amount:null,currency:'KES'}).action,'pending');
});

test('v2045 payment matrix has provider query, replay, manual review, and subscription activation locks', () => {
  const engine=read('src/services/paymentProviderEngine.js');
  const routes=read('src/routes/paymentRoutes.js');
  const controller=read('src/controllers/paymentController.js');
  const ledger=read('src/services/financeLedgerService.js');
  const event=read('src/models/PaymentEvent.js');
  const payment=read('src/models/Payment.js');
  const frontendRoot=path.resolve(root,'../frontend/js');
  assert.match(engine,/daraja\.querySTKStatus/,'M-Pesa STK must query provider status');
  assert.match(engine,/queryPesapalTransactionStatus/,'PesaPal IPN must be verified by status query');
  assert.match(engine,/verifyProviderTransaction/);
  assert.match(engine,/if \(event\?\.processed\) return \{ accepted: true, duplicate: true \}/);
  assert.match(engine,/Provider mismatch/);
  assert.match(engine,/School mismatch/);
  assert.match(engine,/Confirmed amount .* does not exactly match expected amount/);
  assert.match(engine,/verified_provider_status_query/);
  assert.match(event,/provider.*providerEventId[\s\S]*unique: true/);
  assert.match(routes,/authorize\('admin', 'finance_officer'\).*approveManualPayment/);
  assert.match(routes,/authorize\('super_admin'\).*reviewPlatformManualPayment/);
  assert.match(ledger,/manualReviewOnly/);
  assert.match(ledger,/authorized_manual_review/);
  assert.match(controller,/sequelize\.transaction/);
  assert.match(controller,/renewSubscription\(subscription,subPlan,subscriptionPayment\.billingCycle,locked\.id,\{transaction\}\)/);
  assert.match(engine,/if \(paid\)[\s\S]*renewSubscription/);
  assert.match(payment,/Payment completion requires a certified backend authority/);
  assert.doesNotMatch(payment,/markAsCompleted/);
  for(const name of fs.readdirSync(frontendRoot).filter(file=>file.endsWith('.js'))){
    const source=fs.readFileSync(path.join(frontendRoot,name),'utf8');
    assert.doesNotMatch(source,/status\s*:\s*['"]completed['"]/,`${name} attempts to complete a payment`);
  }
});

test('v2045 payment certification fields are migration-owned with rollback protection', () => {
  const migration=read('src/migrations/20260811000000-v2045-country-curriculum-academic-lock.js');
  const payment=read('src/models/Payment.js');
  for(const field of ['completionAuthority','completionEvidence','completionCertifiedAt']){
    assert.match(migration,new RegExp(field));
    assert.match(payment,new RegExp(field));
  }
  assert.match(migration,/certified payment completions exist/);
});

test('v2045 ships a read-only staging database certification gate', () => {
  const pkg=JSON.parse(read('package.json'));
  const certification=read('scripts/certifyV2045Database.js');
  assert.equal(pkg.scripts['certify:v2045:db'],'node scripts/certifyV2045Database.js');
  assert.match(certification,/staging-only and refuses NODE_ENV=production/);
  assert.match(certification,/countsBefore/);
  assert.match(certification,/countsAfter/);
  assert.match(certification,/newRecordsWithoutSnapshots/);
  assert.match(certification,/uncertifiedCompletions/);
  assert.doesNotMatch(certification,/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/);
});
