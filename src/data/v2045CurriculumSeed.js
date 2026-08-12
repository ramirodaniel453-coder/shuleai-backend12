'use strict';

/*
 * Release-pinned curriculum registry. Kenya entries preserve the live v2044
 * curriculum banks during the v2045 data backfill. All other national packs
 * are deliberately pending_review: their authority URL and structural shell
 * are stored, but no administrator can activate them until a human reviewer
 * imports and approves the full official subject and grading material.
 */

const legacy = require('../services/curriculumStructureEngine');

const COUNTRIES = [
  ['KE','KEN','Kenya','KES','Africa/Nairobi',['English','Kiswahili'],'East African Community'],
  ['UG','UGA','Uganda','UGX','Africa/Kampala',['English','Kiswahili'],'East African Community'],
  ['TZ','TZA','Tanzania','TZS','Africa/Dar_es_Salaam',['Kiswahili','English'],'East African Community'],
  ['RW','RWA','Rwanda','RWF','Africa/Kigali',['Kinyarwanda','English','French','Kiswahili'],'East African Community'],
  ['BI','BDI','Burundi','BIF','Africa/Bujumbura',['Kirundi','French','English'],'East African Community'],
  ['SS','SSD','South Sudan','SSP','Africa/Juba',['English'],'East African Community'],
  ['SO','SOM','Somalia','SOS','Africa/Mogadishu',['Somali','Arabic'],'East African Community'],
  ['CD','COD','Democratic Republic of the Congo','CDF','Africa/Kinshasa',['French'],'East African Community'],
  ['NG','NGA','Nigeria','NGN','Africa/Lagos',['English'],'West Africa']
].map(([isoCode,iso3Code,name,currencyCode,timezone,languages,subregion]) => ({
  isoCode, iso3Code, name, currencyCode, timezone, languages, region:'Africa', isSupported:true, metadata:{ subregion }
}));

const UUIDS = Object.freeze({
  KE_CBC: '11111111-2045-4000-8000-000000000001',
  KE_844: '11111111-2045-4000-8000-000000000002',
  KE_BRITISH: '11111111-2045-4000-8000-000000000003',
  KE_AMERICAN: '11111111-2045-4000-8000-000000000004',
  UG_NATIONAL: '11111111-2045-4000-8000-000000000101',
  TZ_NATIONAL: '11111111-2045-4000-8000-000000000201',
  RW_CBC: '11111111-2045-4000-8000-000000000301',
  BI_NATIONAL: '11111111-2045-4000-8000-000000000401',
  SS_NATIONAL: '11111111-2045-4000-8000-000000000501',
  SO_NATIONAL: '11111111-2045-4000-8000-000000000601',
  CD_NATIONAL: '11111111-2045-4000-8000-000000000701',
  NG_BEC: '11111111-2045-4000-8000-000000000801'
});

const BAND_844 = [
  [81,100,'A','Excellent'],[75,80,'A-','Very Good'],[70,74,'B+','Good'],
  [65,69,'B','Above Average'],[60,64,'B-','Average'],[55,59,'C+','Below Average'],
  [50,54,'C','Fair'],[45,49,'C-','Needs Improvement'],[40,44,'D+','Needs Support'],
  [35,39,'D','Needs Support'],[30,34,'D-','Needs Support'],[0,29,'E','Below Standard']
].map(([min,max,label,descriptor]) => ({ min,max,label,descriptor }));

const BAND_CBC = [
  { min:80,max:100,label:'EE',descriptor:'Exceeding Expectations' },
  { min:60,max:79.999,label:'ME',descriptor:'Meeting Expectations' },
  { min:40,max:59.999,label:'AE',descriptor:'Approaching Expectations' },
  { min:0,max:39.999,label:'BE',descriptor:'Below Expectations' }
];

const BAND_BRITISH_LEGACY = [
  [90,100,'A*'],[80,89.999,'A'],[70,79.999,'B'],[60,69.999,'C'],
  [50,59.999,'D'],[40,49.999,'E'],[30,39.999,'F'],[20,29.999,'G'],[0,19.999,'U']
].map(([min,max,label]) => ({ min,max,label }));

const BAND_AMERICAN = [
  [90,100,'A',4],[80,89.999,'B',3],[70,79.999,'C',2],[60,69.999,'D',1],[0,59.999,'F',0]
].map(([min,max,label,points]) => ({ min,max,label,points }));

function stageRows(curriculum) {
  return (legacy.LEVEL_GROUPS[curriculum] || []).map(group => ({
    code: group.code,
    name: group.label,
    description: group.description,
    levelCodes: group.levelCodes
  }));
}

function legacyKenyaPack({ id, system, name, officialCode, authorityName, authorityUrl, gradingProfiles, reviewNotes }) {
  const bank = legacy.SUBJECT_BANK[system];
  const requiredSubjects = bank.subjects.filter(subject => subject.isCore).map(subject => subject.id);
  const optionalSubjects = bank.subjects.filter(subject => subject.isOptional).map(subject => subject.id);
  return {
    id,
    countryIsoCode:'KE',
    authorityName,
    authorityUrl,
    name,
    officialCode,
    legacySystemCode:system,
    version:'v2045-legacy-backfill-1',
    effectiveFrom:'2026-01-01',
    effectiveTo:null,
    educationStages:stageRows(system),
    levels:bank.levels,
    subjectStructure:bank.subjects,
    requiredSubjects,
    optionalSubjects,
    classNamingRules:{ separator:' ', levelLabelField:'label', preserveExistingNames:true },
    streamGenerationRules:{ modes:['none','global','per_level','custom'], previewRequired:true, createMissingOnly:true },
    assessmentTypes:legacy.defaultAssessmentSettings(),
    gradingProfiles,
    academicPathways:[...new Set(bank.subjects.map(subject => subject.pathway).filter(Boolean))].map(code => ({ code, name:code })),
    sourceReferences:[{ authority:authorityName, url:authorityUrl, type:'official_curriculum_authority' }],
    reviewStatus:'legacy_active',
    activationStatus:'active',
    reviewNotes,
    metadata:{ contentCompleteness:'legacy_live_bank_preserved', requiresPeriodicAuthorityReview:true }
  };
}

function draftNationalPack({ id, countryIsoCode, name, officialCode, authorityName, authorityUrl, stages=[], levels=[], mode='national_profile' }) {
  return {
    id, countryIsoCode, authorityName, authorityUrl, name, officialCode,
    legacySystemCode:null,
    version:'authority-review-required-1',
    effectiveFrom:null,
    effectiveTo:null,
    educationStages:stages,
    levels,
    subjectStructure:[],
    requiredSubjects:[],
    optionalSubjects:[],
    classNamingRules:{ separator:' ', levelLabelField:'label', preserveExistingNames:true },
    streamGenerationRules:{ modes:['none','global','per_level','custom'], previewRequired:true, createMissingOnly:true },
    assessmentTypes:[],
    gradingProfiles:[{ code:'official_profile_pending', version:'1', mode, activationBlocked:true, stageProfiles:{} }],
    academicPathways:[],
    sourceReferences:[{ authority:authorityName, url:authorityUrl, type:'official_curriculum_authority' }],
    reviewStatus:'pending_review',
    activationStatus:'inactive',
    reviewNotes:'Human curriculum specialist must import, compare, and approve the complete official subjects, assessment rules, grading rules, pathways and effective dates before activation.',
    metadata:{ contentCompleteness:'authority_reference_and_structure_shell_only', humanActivationRequired:true }
  };
}

const CURRICULUM_PACKS = [
  legacyKenyaPack({
    id:UUIDS.KE_CBC, system:'cbc', name:'Kenya Competency Based Curriculum / Education', officialCode:'KE-CBC-CBE',
    authorityName:'Kenya Institute of Curriculum Development', authorityUrl:'https://kicd.ac.ke/cbc-materials/curriculum-designs/',
    gradingProfiles:[{ code:'ke_cbc_competency_legacy', version:'1', mode:'competency_bands', requiresEvidence:true, bands:BAND_CBC }],
    reviewNotes:'Preserves the live v2044 Kenya CBC/CBE structure. Official KICD source is recorded; exact assessment bands remain flagged for curriculum-specialist confirmation.'
  }),
  legacyKenyaPack({
    id:UUIDS.KE_844, system:'844', name:'Kenya 8-4-4 Legacy Curriculum', officialCode:'KE-844-LEGACY',
    authorityName:'Kenya Institute of Curriculum Development', authorityUrl:'https://kicd.ac.ke/',
    gradingProfiles:[{ code:'ke_844_marks_legacy', version:'1', mode:'numerical_bands', bands:BAND_844 }],
    reviewNotes:'Legacy-active only so existing 8-4-4 schools are never broken or rewritten.'
  }),
  legacyKenyaPack({
    id:UUIDS.KE_BRITISH, system:'british', name:'British / Cambridge International (Kenya school)', officialCode:'KE-CAMBRIDGE-LEGACY',
    authorityName:'Cambridge International Education', authorityUrl:'https://www.cambridgeinternational.org/programmes-and-qualifications/',
    gradingProfiles:[{ code:'cambridge_qualification_legacy', version:'1', mode:'qualification_boundary_table', requiresQualification:true, requiresBoundaryTable:true, fallbackBands:BAND_BRITISH_LEGACY }],
    reviewNotes:'Qualification and exam-series grade boundaries must be imported per subject/session. The legacy fallback is preserved only for existing internal school assessments.'
  }),
  legacyKenyaPack({
    id:UUIDS.KE_AMERICAN, system:'american', name:'American Curriculum (Kenya school)', officialCode:'KE-US-LEGACY',
    authorityName:'School-defined accredited American programme', authorityUrl:'https://www.ed.gov/',
    gradingProfiles:[{ code:'american_gpa_legacy', version:'1', mode:'gpa_bands', bands:BAND_AMERICAN }],
    reviewNotes:'Legacy-active for existing schools. Accreditation and local programme rules remain school-verification requirements.'
  }),
  draftNationalPack({
    id:UUIDS.UG_NATIONAL,countryIsoCode:'UG',name:'Uganda National Curriculum',officialCode:'UG-NCDC',authorityName:'National Curriculum Development Centre Uganda',authorityUrl:'https://ncdc.go.ug/',
    stages:[{code:'primary',name:'Primary',levelCodes:Array.from({length:7},(_,i)=>`p${i+1}`)},{code:'lower_secondary',name:'Lower Secondary',levelCodes:Array.from({length:4},(_,i)=>`s${i+1}`)},{code:'upper_secondary',name:'Upper Secondary',levelCodes:['s5','s6']}],
    levels:[...Array.from({length:7},(_,i)=>({code:`p${i+1}`,label:`Primary ${i+1}`,group:'Primary',order:i+1})),...Array.from({length:6},(_,i)=>({code:`s${i+1}`,label:`Secondary ${i+1}`,group:i<4?'Lower Secondary':'Upper Secondary',order:i+8}))]
  }),
  draftNationalPack({
    id:UUIDS.TZ_NATIONAL,countryIsoCode:'TZ',name:'Tanzania National Curriculum',officialCode:'TZ-TIE-2023',authorityName:'Tanzania Institute of Education',authorityUrl:'https://www.tie.go.tz/',
    stages:[{code:'primary',name:'Primary',levelCodes:Array.from({length:7},(_,i)=>`standard_${i+1}`)},{code:'ordinary_secondary',name:'Ordinary Secondary',levelCodes:Array.from({length:4},(_,i)=>`form_${i+1}`)},{code:'advanced_secondary',name:'Advanced Secondary',levelCodes:['form_5','form_6']}],
    levels:[...Array.from({length:7},(_,i)=>({code:`standard_${i+1}`,label:`Standard ${i+1}`,group:'Primary',order:i+1})),...Array.from({length:6},(_,i)=>({code:`form_${i+1}`,label:`Form ${i+1}`,group:i<4?'Ordinary Secondary':'Advanced Secondary',order:i+8}))]
  }),
  draftNationalPack({
    id:UUIDS.RW_CBC,countryIsoCode:'RW',name:'Rwanda Competence Based Curriculum',officialCode:'RW-REB-CBC',authorityName:'Rwanda Basic Education Board',authorityUrl:'https://www.reb.gov.rw/curriculum-teaching-learning-resources-department',mode:'competency_bands',
    stages:[{code:'nursery',name:'Nursery',levelCodes:['n1','n2','n3']},{code:'primary',name:'Primary',levelCodes:Array.from({length:6},(_,i)=>`p${i+1}`)},{code:'secondary',name:'Secondary',levelCodes:Array.from({length:6},(_,i)=>`s${i+1}`)}],
    levels:[...Array.from({length:3},(_,i)=>({code:`n${i+1}`,label:`Nursery ${i+1}`,group:'Nursery',order:i+1})),...Array.from({length:6},(_,i)=>({code:`p${i+1}`,label:`Primary ${i+1}`,group:'Primary',order:i+4})),...Array.from({length:6},(_,i)=>({code:`s${i+1}`,label:`Secondary ${i+1}`,group:'Secondary',order:i+10}))]
  }),
  draftNationalPack({ id:UUIDS.BI_NATIONAL,countryIsoCode:'BI',name:'Burundi National Curriculum',officialCode:'BI-MENRS',authorityName:"Ministère de l'Education Nationale et de la Recherche Scientifique",authorityUrl:'https://mesrs.gov.bi/' }),
  draftNationalPack({ id:UUIDS.SS_NATIONAL,countryIsoCode:'SS',name:'South Sudan National Curriculum',officialCode:'SS-MOGEI',authorityName:'Ministry of General Education and Instruction',authorityUrl:'https://mogei.gov.ss/' }),
  draftNationalPack({ id:UUIDS.SO_NATIONAL,countryIsoCode:'SO',name:'Somalia National Curriculum',officialCode:'SO-MOECHE',authorityName:'Ministry of Education, Culture and Higher Education',authorityUrl:'https://moe.gov.so/' }),
  draftNationalPack({ id:UUIDS.CD_NATIONAL,countryIsoCode:'CD',name:'DR Congo National Curriculum',officialCode:'CD-MINEDU-NC',authorityName:"Ministère de l'Éducation Nationale et Nouvelle Citoyenneté",authorityUrl:'https://edu-nc.gouv.cd/programmes-nationaux' }),
  draftNationalPack({
    id:UUIDS.NG_BEC,countryIsoCode:'NG',name:'Nigeria Revised Basic and Senior Secondary Curriculum',officialCode:'NG-NERDC-REVISED',authorityName:'Nigerian Educational Research and Development Council',authorityUrl:'https://www.nerdc.gov.ng/content_manager/new_curriculum_home.html',mode:'programme_stage_bands',
    stages:[{code:'primary',name:'Primary',levelCodes:Array.from({length:6},(_,i)=>`primary_${i+1}`)},{code:'junior_secondary',name:'Junior Secondary',levelCodes:Array.from({length:3},(_,i)=>`jss_${i+1}`)},{code:'senior_secondary',name:'Senior Secondary',levelCodes:Array.from({length:3},(_,i)=>`sss_${i+1}`)}],
    levels:[...Array.from({length:6},(_,i)=>({code:`primary_${i+1}`,label:`Primary ${i+1}`,group:'Primary',order:i+1})),...Array.from({length:3},(_,i)=>({code:`jss_${i+1}`,label:`Junior Secondary ${i+1}`,group:'Junior Secondary',order:i+7})),...Array.from({length:3},(_,i)=>({code:`sss_${i+1}`,label:`Senior Secondary ${i+1}`,group:'Senior Secondary',order:i+10}))]
  })
];

const LEGACY_SYSTEM_PACK_IDS = Object.freeze({
  cbc:UUIDS.KE_CBC,
  cbe:UUIDS.KE_CBC,
  '844':UUIDS.KE_844,
  '8-4-4':UUIDS.KE_844,
  british:UUIDS.KE_BRITISH,
  american:UUIDS.KE_AMERICAN
});

module.exports = { COUNTRIES, CURRICULUM_PACKS, UUIDS, LEGACY_SYSTEM_PACK_IDS };
