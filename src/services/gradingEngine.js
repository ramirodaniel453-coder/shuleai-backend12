'use strict';

const curriculumPackService = require('./curriculumPackService');

const ENGINE_VERSION = 'v2045.1';

const LEGACY_PROFILES = Object.freeze({
  cbc: { code:'ke_cbc_competency_legacy', version:'1', mode:'competency_bands', bands:[
    {min:80,max:100,label:'EE',descriptor:'Exceeding Expectations'},
    {min:60,max:79.999,label:'ME',descriptor:'Meeting Expectations'},
    {min:40,max:59.999,label:'AE',descriptor:'Approaching Expectations'},
    {min:0,max:39.999,label:'BE',descriptor:'Below Expectations'}
  ]},
  '844': { code:'ke_844_marks_legacy', version:'1', mode:'numerical_bands', bands:[
    {min:81,max:100,label:'A'},{min:75,max:80.999,label:'A-'},{min:70,max:74.999,label:'B+'},
    {min:65,max:69.999,label:'B'},{min:60,max:64.999,label:'B-'},{min:55,max:59.999,label:'C+'},
    {min:50,max:54.999,label:'C'},{min:45,max:49.999,label:'C-'},{min:40,max:44.999,label:'D+'},
    {min:35,max:39.999,label:'D'},{min:30,max:34.999,label:'D-'},{min:0,max:29.999,label:'E'}
  ]},
  british: { code:'cambridge_qualification_legacy', version:'1', mode:'qualification_boundary_table', fallbackBands:[
    {min:90,max:100,label:'A*'},{min:80,max:89.999,label:'A'},{min:70,max:79.999,label:'B'},
    {min:60,max:69.999,label:'C'},{min:50,max:59.999,label:'D'},{min:40,max:49.999,label:'E'},
    {min:30,max:39.999,label:'F'},{min:20,max:29.999,label:'G'},{min:0,max:19.999,label:'U'}
  ]},
  american: { code:'american_gpa_legacy', version:'1', mode:'gpa_bands', bands:[
    {min:90,max:100,label:'A',points:4},{min:80,max:89.999,label:'B',points:3},
    {min:70,max:79.999,label:'C',points:2},{min:60,max:69.999,label:'D',points:1},
    {min:0,max:59.999,label:'F',points:0}
  ]}
});

function gradingError(message,statusCode=400,code='GRADING_VALIDATION_FAILED',data) {
  const error=new Error(message); error.statusCode=statusCode; error.status=statusCode; error.code=code;
  if(data!==undefined)error.data=data;
  return error;
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function key(value) { return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
function normalizeCurriculumKey(value) {
  const normalized=key(value);
  if(['8_4_4','844'].includes(normalized))return '844';
  if(['british','igcse','cambridge'].includes(normalized))return 'british';
  if(['american','us','usa'].includes(normalized))return 'american';
  return 'cbc';
}

function normalizeMark(rawMark,maxScore=100) {
  const raw=Number(rawMark),maximum=Number(maxScore);
  if(!Number.isFinite(raw)||!Number.isFinite(maximum)||maximum<=0||raw<0||raw>maximum) {
    throw gradingError('Raw mark must be a number between zero and the assessment maximum.',400,'INVALID_RAW_MARK',{rawMark,maxScore});
  }
  return {rawMark:raw,maxScore:maximum,percentage:Number(((raw/maximum)*100).toFixed(4))};
}

function normalizeBands(bands) {
  if(!Array.isArray(bands)||!bands.length)throw gradingError('The resolved grading profile has no usable bands.',409,'GRADING_BANDS_MISSING');
  return bands.map((band,index)=>{
    const min=Number(band.min??band.range?.[0]),max=Number(band.max??band.range?.[1]);
    const label=String(band.label||band.grade||'').trim();
    if(!Number.isFinite(min)||!Number.isFinite(max)||!label)throw gradingError(`Invalid grading band at position ${index+1}.`,409,'GRADING_BAND_INVALID');
    return {...band,min,max,label};
  });
}

function boundaryRows(profile,{subject,assessmentType,qualification,levelCode}={}) {
  const tables=Array.isArray(profile.boundaryTables)?profile.boundaryTables:[];
  const wanted={subject:key(subject?.code||subject?.id||subject?.name||subject),assessmentType:key(assessmentType),qualification:key(qualification),levelCode:key(levelCode)};
  const table=tables.find(row=>{
    const checks=[['subject',wanted.subject],['assessmentType',wanted.assessmentType],['qualification',wanted.qualification],['levelCode',wanted.levelCode]];
    return checks.every(([field,expected])=>!row[field]||!expected||key(row[field])===expected);
  });
  return table?.bands||table?.boundaries||null;
}

function programmeRows(profile,{levelCode,stageCode,programme}={}) {
  if(profile.stages&&typeof profile.stages==='object') {
    const stage=profile.stages[levelCode]||profile.stages[stageCode]||profile.stages[programme];
    if(stage?.bands)return stage.bands;
    if(Array.isArray(stage))return stage;
  }
  const programmes=Array.isArray(profile.programmes)?profile.programmes:[];
  const match=programmes.find(row=>{
    const levels=(row.levelCodes||[]).map(key);
    return (levelCode&&levels.includes(key(levelCode)))||(programme&&key(row.code||row.name)===key(programme))||(stageCode&&key(row.stageCode)===key(stageCode));
  });
  return match?.bands||profile.bands||null;
}

function evaluateProfile({rawMark,maxScore=100,competencyEvidence=null,profile,subject=null,assessmentType=null,levelCode=null,stageCode=null,qualification=null,programme=null}) {
  if(!profile||typeof profile!=='object')throw gradingError('A resolved grading profile is required.',409,'GRADING_PROFILE_MISSING');
  const mark=normalizeMark(rawMark,maxScore);
  const mode=String(profile.mode||'numerical_bands');
  let bands=profile.bands;
  let boundarySource='profile_bands';
  if(mode==='qualification_boundary_table') {
    bands=boundaryRows(profile,{subject,assessmentType,qualification,levelCode});
    if(!bands) { bands=profile.fallbackBands; boundarySource='internal_assessment_fallback'; }
    else boundarySource='qualification_boundary_table';
  } else if(mode==='programme_stage_bands') {
    bands=programmeRows(profile,{levelCode,stageCode,programme});
    boundarySource='programme_stage_profile';
  } else if(!['competency_bands','numerical_bands','gpa_bands'].includes(mode)) {
    throw gradingError(`Unsupported grading mode: ${mode}`,409,'GRADING_MODE_UNSUPPORTED');
  }
  const band=normalizeBands(bands).find(row=>mark.percentage>=row.min&&mark.percentage<=row.max);
  if(!band)throw gradingError('The mark is outside every band in the resolved grading profile.',409,'GRADE_BAND_NOT_FOUND',{percentage:mark.percentage});
  const evidence=competencyEvidence&&typeof competencyEvidence==='object'&&!Array.isArray(competencyEvidence)?clone(competencyEvidence):null;
  return {
    engineVersion:ENGINE_VERSION,grade:band.label,label:band.label,descriptor:band.descriptor||null,
    points:Number.isFinite(Number(band.points))?Number(band.points):null,mode,boundarySource,
    rawMark:mark.rawMark,maxScore:mark.maxScore,percentage:mark.percentage,
    competencyEvidence:mode==='competency_bands'?evidence:null,
    evidenceStatus:mode==='competency_bands'?(evidence&&Object.keys(evidence).length?'provided':'not_provided'):'not_applicable'
  };
}

function findLevel(pack,levelCode) {
  return (pack.levels||[]).find(level=>key(level.code)===key(levelCode))||null;
}

function findStage(pack,levelCode) {
  return (pack.educationStages||[]).find(stage=>(stage.levelCodes||[]).some(code=>key(code)===key(levelCode)))||null;
}

function resolveSubject(context,subjectInput) {
  const wanted=key(subjectInput);
  if(!wanted)throw gradingError('Subject is required.',400,'SUBJECT_REQUIRED');
  const levelCode=String(context.levelCode);
  const candidates=(context.pack.subjectStructure||[]).filter(subject=>{
    const levels=(subject.levelCodes||[]).map(key);
    return !levels.length||levels.includes(key(levelCode));
  });
  const subject=candidates.find(row=>[row.id,row.code,row.name].some(value=>key(value)===wanted));
  if(!subject)throw gradingError('The subject is not part of the learner level in the active curriculum pack.',400,'SUBJECT_NOT_IN_CURRICULUM',{subject:subjectInput,levelCode});
  const selected=new Set((context.assignment.selectedSubjectCodes||[]).map(key));
  if(selected.size&&!selected.has(key(subject.id||subject.code)))throw gradingError('The subject is not offered by this school.',400,'SUBJECT_NOT_OFFERED',{subjectId:subject.id||subject.code});
  return subject;
}

function resolveAssessmentType(pack,input) {
  const wanted=key(input||'test');
  const rows=Array.isArray(pack.assessmentTypes)?pack.assessmentTypes:[];
  if(!rows.length)return {key:wanted,label:String(input||'Test'),unregisteredLegacyType:true};
  const row=rows.find(item=>[item.key,item.code,item.assessmentType,item.label].some(value=>key(value)===wanted));
  if(!row)throw gradingError('The assessment type is not configured in the active curriculum pack.',400,'ASSESSMENT_TYPE_NOT_IN_CURRICULUM',{assessmentType:input});
  return row;
}

function buildSnapshots(context,{subject,assessmentType,result}) {
  const pack=context.pack.toJSON?context.pack.toJSON():context.pack;
  const assignment=context.assignment.toJSON?context.assignment.toJSON():context.assignment;
  const profile=clone(context.gradingProfile);
  const level=findLevel(pack,context.levelCode);
  const stage=findStage(pack,context.levelCode);
  const curriculumSnapshot={
    schemaVersion:1,capturedByEngine:ENGINE_VERSION,capturedAt:new Date().toISOString(),
    countryIsoCode:pack.countryIsoCode,curriculumPackId:pack.id,curriculumPackVersion:pack.version,
    curriculumOfficialCode:pack.officialCode,curriculumName:pack.name,authorityName:pack.authorityName,
    sourceChecksum:pack.sourceChecksum||null,assignmentId:assignment.id,assignmentVersion:assignment.assignmentVersion,
    level:clone(level),stage:clone(stage),subject:clone(subject),assessmentType:clone(assessmentType)
  };
  const gradingSnapshot={
    schemaVersion:1,capturedByEngine:ENGINE_VERSION,capturedAt:curriculumSnapshot.capturedAt,
    profileCode:assignment.gradingProfileCode,profileVersion:String(context.customGradingProfile?.version||profile.version||pack.version),
    customGradingProfileId:context.customGradingProfile?.id||null,profileChecksum:context.customGradingProfile?.checksum||null,
    profile,levelCode:context.levelCode,stageCode:stage?.code||null,subjectId:subject.id||subject.code,
    assessmentTypeKey:assessmentType.key||assessmentType.code||key(assessmentType.assessmentType||assessmentType.label),
    resultContract:{mode:result.mode,boundarySource:result.boundarySource}
  };
  return {curriculumSnapshot,gradingSnapshot};
}

async function gradeNewAssessment({studentId,classId,subject,assessmentType='test',rawMark,maxScore=100,competencyEvidence=null,assessmentDate=new Date(),qualification=null,programme=null,transaction}) {
  const context=await curriculumPackService.resolveStudentCurriculum({studentId,assessmentDate,transaction,lock:false});
  if(classId!=null&&Number(classId)!==Number(context.classItem.id))throw gradingError('The submitted class does not match the learner active enrollment.',409,'ASSESSMENT_CLASS_MISMATCH');
  const resolvedSubject=resolveSubject(context,subject);
  const resolvedAssessmentType=resolveAssessmentType(context.pack,assessmentType);
  const stage=findStage(context.pack,context.levelCode);
  const result=evaluateProfile({rawMark,maxScore,competencyEvidence,profile:context.gradingProfile,subject:resolvedSubject,assessmentType:resolvedAssessmentType.key||assessmentType,levelCode:context.levelCode,stageCode:stage?.code,qualification,programme});
  const snapshots=buildSnapshots(context,{subject:resolvedSubject,assessmentType:resolvedAssessmentType,result});
  return {
    context,result,...snapshots,
    persistence:{
      grade:result.grade,curriculumPackId:context.pack.id,curriculumPackVersion:context.pack.version,
      curriculumOfficialCode:context.pack.officialCode,countryIsoCode:context.pack.countryIsoCode,
      gradingProfileCode:context.assignment.gradingProfileCode,
      gradingProfileVersion:snapshots.gradingSnapshot.profileVersion,curriculumSnapshot:snapshots.curriculumSnapshot,
      gradingSnapshot:snapshots.gradingSnapshot,competencyEvidence:result.competencyEvidence,
      gradingScale:null,curriculum:context.pack.legacySystemCode||context.pack.officialCode
    }
  };
}

async function gradeDraftUpdate({record,rawMark,maxScore,competencyEvidence,transaction}) {
  const snapshot=record.gradingSnapshot;
  if(snapshot?.profile) {
    const result=evaluateProfile({rawMark,maxScore:maxScore??record.maxScore??100,competencyEvidence:competencyEvidence??record.competencyEvidence,profile:snapshot.profile,subject:snapshot.subjectId,assessmentType:snapshot.assessmentTypeKey,levelCode:snapshot.levelCode,stageCode:snapshot.stageCode});
    return {result,persistence:{grade:result.grade,competencyEvidence:result.competencyEvidence,gradingScale:null}};
  }
  return gradeNewAssessment({studentId:record.studentId,classId:record.classId,subject:record.subject,assessmentType:record.assessmentType,rawMark,maxScore:maxScore??record.maxScore??100,competencyEvidence,assessmentDate:record.date,transaction});
}

function gradeFromSnapshot(rawMark,maxScore,gradingSnapshot,competencyEvidence=null) {
  if(!gradingSnapshot?.profile)throw gradingError('The historical grading snapshot is unavailable.',409,'HISTORICAL_GRADING_SNAPSHOT_MISSING');
  return evaluateProfile({rawMark,maxScore,competencyEvidence,profile:gradingSnapshot.profile,subject:gradingSnapshot.subjectId,assessmentType:gradingSnapshot.assessmentTypeKey,levelCode:gradingSnapshot.levelCode,stageCode:gradingSnapshot.stageCode});
}

function storedGrade(record) {
  const row=record?.toJSON?record.toJSON():record;
  return row?.grade||null;
}

function gradeAggregate(records) {
  const rows=(records||[]).map(row=>row?.toJSON?row.toJSON():row).filter(Boolean);
  const scored=rows.filter(row=>Number.isFinite(Number(row.score))&&Number(row.maxScore||100)>0);
  if(!scored.length)return {average:null,grade:null,gradingSource:'none'};
  const average=Number((scored.reduce((sum,row)=>sum+(Number(row.score)/Number(row.maxScore||100))*100,0)/scored.length).toFixed(2));
  const latest=[...scored].sort((a,b)=>new Date(b.date||b.createdAt||0)-new Date(a.date||a.createdAt||0))[0];
  if(latest.gradingSnapshot?.profile) {
    return {average,grade:gradeFromSnapshot(average,100,latest.gradingSnapshot).grade,gradingSource:'immutable_snapshot'};
  }
  return {average,grade:getGradeFromScore(average,latest.curriculum||'cbc'),gradingSource:'legacy_compatibility'};
}

function gradeValueForRecords(value,records) {
  const rows=(records||[]).map(row=>row?.toJSON?row.toJSON():row).filter(Boolean);
  const latest=[...rows].sort((a,b)=>new Date(b.date||b.createdAt||0)-new Date(a.date||a.createdAt||0))[0];
  if(latest?.gradingSnapshot?.profile)return gradeFromSnapshot(value,100,latest.gradingSnapshot).grade;
  return getGradeFromScore(value,latest?.curriculum||'cbc');
}

function getGradeFromScore(score,curriculum='cbc',level=null,customScale=null) {
  let profile=LEGACY_PROFILES[normalizeCurriculumKey(curriculum)]||LEGACY_PROFILES.cbc;
  if(Array.isArray(customScale)&&customScale.length)profile={code:'legacy_admin_scale',version:'legacy',mode:'numerical_bands',bands:customScale.map(row=>({min:row.min??row.minScore??row.range?.[0],max:row.max??row.maxScore??row.range?.[1],label:row.label||row.grade}))};
  try{return evaluateProfile({rawMark:score,maxScore:100,profile,levelCode:level}).grade;}catch(_){return 'N/A';}
}

module.exports={
  ENGINE_VERSION,LEGACY_PROFILES,normalizeCurriculumKey,normalizeMark,evaluateProfile,findLevel,findStage,
  resolveSubject,resolveAssessmentType,buildSnapshots,gradeNewAssessment,gradeDraftUpdate,gradeFromSnapshot,
  storedGrade,gradeAggregate,gradeValueForRecords,getGradeFromScore
};
