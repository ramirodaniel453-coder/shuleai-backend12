'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, Country, CurriculumPack, School, SchoolCurriculumAssignment,
  SchoolGradingProfile, Student, StudentEnrollment, Class, AuditLog
} = require('../models');
const classGeneration = require('./classGenerationService');

const SELECTABLE_REVIEW_STATES = new Set(['reviewed','legacy_active']);
const LEGACY_SYSTEMS = new Set(['cbc','844','british','american']);

function appError(message,status=400,code='CURRICULUM_VALIDATION_FAILED',data) {
  const error=new Error(message); error.statusCode=status; error.code=code; if(data!==undefined)error.data=data; return error;
}
function uniqueStrings(value) { return [...new Set((Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean))]; }
function json(value) { return value && typeof value.toJSON==='function' ? value.toJSON() : value; }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function publicCountry(row) {
  if(!row)return null;
  const value=json(row)||{};
  return { isoCode:value.isoCode,iso3Code:value.iso3Code,name:value.name,currencyCode:value.currencyCode,timezone:value.timezone,languages:value.languages||[],region:value.region,isSupported:value.isSupported!==false };
}
function publicPack(row,{includeContent=true}={}) {
  const value=json(row)||{};
  const base={
    id:value.id,countryIsoCode:value.countryIsoCode,name:value.name,officialCode:value.officialCode,version:value.version,
    authorityName:value.authorityName,authorityUrl:value.authorityUrl,effectiveFrom:value.effectiveFrom,effectiveTo:value.effectiveTo,
    reviewStatus:value.reviewStatus,activationStatus:value.activationStatus,reviewNotes:value.reviewNotes,
    selectable:value.activationStatus==='active'&&SELECTABLE_REVIEW_STATES.has(value.reviewStatus),
    sourceReferences:value.sourceReferences||[],metadata:value.metadata||{}
  };
  if(!includeContent)return base;
  return {...base,educationStages:value.educationStages||[],levels:value.levels||[],subjectStructure:value.subjectStructure||[],requiredSubjects:value.requiredSubjects||[],optionalSubjects:value.optionalSubjects||[],classNamingRules:value.classNamingRules||{},streamGenerationRules:value.streamGenerationRules||{},assessmentTypes:value.assessmentTypes||[],gradingProfiles:value.gradingProfiles||[],academicPathways:value.academicPathways||[]};
}
function packSnapshot(pack) {
  const value=publicPack(pack);
  return {
    id:value.id,countryIsoCode:value.countryIsoCode,name:value.name,officialCode:value.officialCode,version:value.version,
    authorityName:value.authorityName,sourceChecksum:json(pack).sourceChecksum||null,educationStages:value.educationStages,
    levels:value.levels,subjectStructure:value.subjectStructure,assessmentTypes:value.assessmentTypes,
    gradingProfiles:value.gradingProfiles,academicPathways:value.academicPathways,classNamingRules:value.classNamingRules,
    streamGenerationRules:value.streamGenerationRules,sourceReferences:value.sourceReferences
  };
}

async function listCountries() {
  const rows=await Country.findAll({where:{isSupported:true},order:[['name','ASC']]});
  return rows.map(publicCountry);
}

async function listPacksForCountry(countryIsoCode,{includePending=false}={}) {
  const iso=String(countryIsoCode||'').trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(iso))throw appError('A valid ISO country code is required.');
  const where={countryIsoCode:iso};
  if(!includePending){where.activationStatus='active';where.reviewStatus={[Op.in]:[...SELECTABLE_REVIEW_STATES]};}
  const rows=await CurriculumPack.findAll({where,order:[['activationStatus','DESC'],['name','ASC'],['version','DESC']]});
  return rows.map(row=>publicPack(row));
}

async function getSchoolCurriculumContext(schoolCode,{transaction,lock=false}={}) {
  const school=await School.findOne({
    where:{schoolId:String(schoolCode||'').trim()},
    include:[
      {model:Country,as:'country',required:false},
      {model:CurriculumPack,as:'activeCurriculumPack',required:false},
      {model:SchoolCurriculumAssignment,as:'activeCurriculumAssignment',required:false}
    ],
    transaction,
    lock:lock&&transaction?transaction.LOCK.UPDATE:undefined
  });
  if(!school)throw appError('School not found.',404,'SCHOOL_NOT_FOUND');
  let pack=school.activeCurriculumPack;
  if(!pack&&school.activeCurriculumPackId)pack=await CurriculumPack.findByPk(school.activeCurriculumPackId,{transaction});
  let assignment=school.activeCurriculumAssignment;
  if(!assignment)assignment=await SchoolCurriculumAssignment.findOne({where:{schoolCode:school.schoolId,status:'active'},order:[['assignmentVersion','DESC']],transaction});
  if(!pack||!assignment)throw appError('The school curriculum migration is incomplete. Run the v2045 migration before academic activity.',409,'SCHOOL_CURRICULUM_NOT_CONFIGURED');
  let customGradingProfile=null;
  if(assignment.customGradingProfileId)customGradingProfile=await SchoolGradingProfile.findOne({where:{id:assignment.customGradingProfileId,schoolCode:school.schoolId,status:'active'},transaction});
  const profiles=Array.isArray(pack.gradingProfiles)?pack.gradingProfiles:[];
  const gradingProfile=customGradingProfile?.profile||profiles.find(profile=>String(profile.code)===String(assignment.gradingProfileCode));
  if(!gradingProfile)throw appError('The assigned grading profile no longer exists.',409,'GRADING_PROFILE_MISSING');
  return {school,country:school.country||null,pack,assignment,gradingProfile,customGradingProfile};
}

function validateWorkflowSelection(pack,payload) {
  const value=json(pack);
  if(value.activationStatus!=='active'||!SELECTABLE_REVIEW_STATES.has(value.reviewStatus)) {
    throw appError('This curriculum pack is awaiting official-authority content review and cannot be activated.',409,'CURRICULUM_PACK_NOT_REVIEWED',{reviewStatus:value.reviewStatus,activationStatus:value.activationStatus,reviewNotes:value.reviewNotes});
  }
  const selectedStageCodes=uniqueStrings(payload.selectedStageCodes);
  const enabledLevelCodes=uniqueStrings(payload.enabledLevelCodes);
  let selectedSubjectCodes=uniqueStrings(payload.selectedSubjectCodes);
  const selectedPathwayCodes=uniqueStrings(payload.selectedPathwayCodes);
  const stageMap=new Map((value.educationStages||[]).map(stage=>[String(stage.code),stage]));
  const levelMap=new Map((value.levels||[]).map(level=>[String(level.code),level]));
  const subjectMap=new Map((value.subjectStructure||[]).map(subject=>[String(subject.id||subject.code),subject]));
  const pathwayMap=new Map((value.academicPathways||[]).map(pathway=>[String(pathway.code||pathway.name),pathway]));
  const unknownStages=selectedStageCodes.filter(code=>!stageMap.has(code));
  const unknownLevels=enabledLevelCodes.filter(code=>!levelMap.has(code));
  const unknownSubjects=selectedSubjectCodes.filter(code=>!subjectMap.has(code));
  const unknownPathways=selectedPathwayCodes.filter(code=>!pathwayMap.has(code));
  if(unknownStages.length||unknownLevels.length||unknownSubjects.length||unknownPathways.length)throw appError('The curriculum selection contains values outside the selected official pack.',400,'CURRICULUM_SELECTION_OUT_OF_PACK',{unknownStages,unknownLevels,unknownSubjects,unknownPathways});
  if(!selectedStageCodes.length)throw appError('Select at least one education stage.');
  if(!enabledLevelCodes.length)throw appError('Select at least one education level.');
  if(selectedStageCodes.length){
    const allowedByStage=new Set(selectedStageCodes.flatMap(code=>stageMap.get(code)?.levelCodes||[]).map(String));
    const outside=enabledLevelCodes.filter(code=>!allowedByStage.has(code));
    if(outside.length)throw appError('One or more levels are outside the selected education stages.',400,'CURRICULUM_LEVEL_STAGE_MISMATCH',{outside});
  }
  const enabledSet=new Set(enabledLevelCodes);
  const eligibleSubjects=(value.subjectStructure||[]).filter(subject=>{
    const levels=Array.isArray(subject.levelCodes)?subject.levelCodes.map(String):[];
    return !levels.length||levels.some(code=>enabledSet.has(code));
  });
  const eligibleSubjectCodes=new Set(eligibleSubjects.map(subject=>String(subject.id||subject.code)));
  selectedSubjectCodes=selectedSubjectCodes.filter(code=>eligibleSubjectCodes.has(code));
  const requiredCodes=new Set((value.requiredSubjects||[]).map(String));
  const requiredForEnabledLevels=eligibleSubjects
    .map(subject=>String(subject.id||subject.code))
    .filter(code=>requiredCodes.has(code));
  const selectedSet=new Set(selectedSubjectCodes);
  const missingRequiredSubjects=requiredForEnabledLevels.filter(code=>!selectedSet.has(code));
  if(missingRequiredSubjects.length)throw appError('All required subjects for the selected levels must be included.',400,'CURRICULUM_REQUIRED_SUBJECTS_MISSING',{missingRequiredSubjects});
  const profileCodes=new Set((value.gradingProfiles||[]).map(profile=>String(profile.code)));
  if(!payload.customGradingProfileId&&!profileCodes.has(String(payload.gradingProfileCode||'')))throw appError('Select a grading profile from the active curriculum pack.');
  return {selectedStageCodes,enabledLevelCodes,selectedSubjectCodes,selectedPathwayCodes,gradingProfileCode:String(payload.gradingProfileCode||'').trim()};
}

function selectedSubjectRows(pack,codes) {
  const selected=new Set(codes);
  return (pack.subjectStructure||[]).filter(subject=>selected.has(String(subject.id||subject.code))).map(subject=>({
    subjectId:String(subject.id||subject.code),name:subject.name,code:subject.code||subject.id,category:subject.category,
    levelCodes:subject.levelCodes||[],pathway:subject.pathway||null,track:subject.track||null,isCore:!!subject.isCore,
    isOptional:!!subject.isOptional,countsInFinalByDefault:subject.countsInFinalByDefault!==false,isOffered:true,
    source:'curriculum_pack',curriculumPackId:pack.id,curriculumPackVersion:pack.version
  }));
}

function resolveClassLevelCode(pack,classItem) {
  if(classItem?.levelCode)return String(classItem.levelCode);
  const normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  const candidates=[classItem?.grade,classItem?.name,classItem?.curriculumLevel].map(normalize).filter(Boolean);
  const match=(pack.levels||[]).find(level=>candidates.includes(normalize(level.code))||candidates.includes(normalize(level.label)));
  return match?String(match.code):null;
}

async function updateSchoolCurriculum({schoolCode,actor,payload}) {
  if(!actor?.id)throw appError('Authenticated admin is required.',401,'AUTH_REQUIRED');
  const reason=String(payload.changeReason||'').trim();
  if(reason.length<5)throw appError('A curriculum change reason of at least 5 characters is required.');
  return sequelize.transaction(async transaction=>{
    const school=await School.findOne({where:{schoolId:schoolCode},transaction,lock:transaction.LOCK.UPDATE});
    if(!school)throw appError('School not found.',404,'SCHOOL_NOT_FOUND');
    const countryIsoCode=String(payload.countryIsoCode||'').trim().toUpperCase();
    const [country,pack]=await Promise.all([
      Country.findOne({where:{isoCode:countryIsoCode,isSupported:true},transaction}),
      CurriculumPack.findOne({where:{id:payload.curriculumPackId,countryIsoCode},transaction})
    ]);
    if(!country)throw appError('The selected country is not in the supported release scope.');
    if(!pack)throw appError('The selected curriculum pack does not belong to the selected country.');
    const selection=validateWorkflowSelection(pack,payload);
    let customProfile=null;
    if(payload.customGradingProfileId){
      customProfile=await SchoolGradingProfile.findOne({where:{id:payload.customGradingProfileId,schoolCode:school.schoolId,curriculumPackId:pack.id,status:'active'},transaction});
      if(!customProfile)throw appError('The selected custom grading profile is not active for this school and curriculum pack.');
      selection.gradingProfileCode=customProfile.code;
    }
    const current=await SchoolCurriculumAssignment.findOne({where:{schoolCode:school.schoolId,status:'active'},transaction,lock:transaction.LOCK.UPDATE});
    const previousAssignmentSnapshot=current?json(current):null;
    const assignmentVersion=Number(current?.assignmentVersion||0)+1;
    const classGenerationConfig=classGeneration.normalizeConfigPatch(school,payload.classGeneration||{},actor.id,pack);
    if(current)await current.update({status:'superseded',effectiveTo:new Date()},{transaction,hooks:false});
    const snapshot={pack:packSnapshot(pack),selection:{...selection,classGenerationConfig},customGradingProfile:customProfile?{id:customProfile.id,code:customProfile.code,version:customProfile.version,checksum:customProfile.checksum}:null};
    const assignment=await SchoolCurriculumAssignment.create({
      schoolCode:school.schoolId,countryIsoCode,curriculumPackId:pack.id,previousAssignmentId:current?.id||null,
      assignmentVersion,...selection,customGradingProfileId:customProfile?.id||null,classGenerationConfig,status:'active',
      effectiveFrom:new Date(),changeReason:reason,changedBy:actor.id,source:'admin_workflow',snapshot
    },{transaction});
    const legacySystem=LEGACY_SYSTEMS.has(String(pack.legacySystemCode||''))?pack.legacySystemCode:school.system;
    const currentSettings=school.settings||{};
    const schoolSubjects=selectedSubjectRows(pack,selection.selectedSubjectCodes);
    school.countryIsoCode=countryIsoCode;
    school.activeCurriculumPackId=pack.id;
    school.activeCurriculumAssignmentId=assignment.id;
    school.curriculumVersion=pack.version;
    school.system=legacySystem;
    school.enabledLevels=selection.enabledLevelCodes;
    school.settings={
      ...currentSettings,
      countryIsoCode,
      curriculum:legacySystem,
      curriculumPackId:pack.id,
      curriculumOfficialCode:pack.officialCode,
      curriculumVersion:pack.version,
      curriculumPackSnapshot:snapshot.pack,
      classGeneration:classGenerationConfig,
      curriculumEngine:{
        ...(currentSettings.curriculumEngine||{}),curriculum:legacySystem,countryIsoCode,curriculumPackId:pack.id,
        curriculumOfficialCode:pack.officialCode,curriculumVersion:pack.version,enabledLevels:selection.enabledLevelCodes,
        enabledLevelGroups:selection.selectedStageCodes,schoolSubjects,assessmentSettings:pack.assessmentTypes||[],
        gradingProfileCode:selection.gradingProfileCode,customGradingProfileId:customProfile?.id||null,
        selectedPathwayCodes:selection.selectedPathwayCodes,updatedAt:new Date().toISOString(),updatedBy:actor.id
      }
    };
    await school.save({transaction,hooks:false});
    await AuditLog.create({schoolCode:school.schoolId,actorUserId:actor.id,actorRole:actor.role,module:'curriculum',action:'school_curriculum_changed',entityType:'SchoolCurriculumAssignment',entityId:String(assignment.id),before:previousAssignmentSnapshot,after:{assignment:json(assignment),pack:{id:pack.id,officialCode:pack.officialCode,version:pack.version}},reason,metadata:{countryIsoCode,nonDestructive:true,existingClassesMutated:false,historicalRecordsMutated:false}},{transaction});
    if(transaction.afterCommit&&global.io)transaction.afterCommit(()=>global.io.to(`school-${school.schoolId}`).emit('curriculum:updated',{schoolCode:school.schoolId,countryIsoCode,curriculumPackId:pack.id,curriculumVersion:pack.version,assignmentVersion}));
    return {school,country,pack,assignment};
  });
}

function validateCustomGradingProfile(profile) {
  if(!profile||typeof profile!=='object'||Array.isArray(profile))throw appError('A grading profile object is required.');
  const mode=String(profile.mode||'').trim();
  if(!['competency_bands','numerical_bands','gpa_bands','qualification_boundary_table','programme_stage_bands'].includes(mode))throw appError('Unsupported grading profile mode.');
  const normalized={...profile,mode};
  if(['competency_bands','numerical_bands','gpa_bands'].includes(mode)){
    if(!Array.isArray(profile.bands)||!profile.bands.length)throw appError('The grading profile requires at least one mark band.');
    const bands=profile.bands.map((band,index)=>{
      const min=Number(band.min),max=Number(band.max),label=String(band.label||'').trim();
      if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max>100||min>max||!label)throw appError(`Invalid grading band at position ${index+1}.`);
      return {...band,min,max,label};
    }).sort((a,b)=>a.min-b.min);
    for(let index=1;index<bands.length;index++)if(bands[index].min<=bands[index-1].max)throw appError('Grading bands must not overlap.');
    normalized.bands=bands;
  }
  return normalized;
}

async function createCustomGradingProfile({schoolCode,actor,payload}) {
  const name=String(payload.name||'').trim(),code=String(payload.code||name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,80);
  const reason=String(payload.changeReason||'').trim();
  if(name.length<3||!code||reason.length<5)throw appError('Name, code, and a change reason are required.');
  const profile=validateCustomGradingProfile(payload.profile);
  return sequelize.transaction(async transaction=>{
    const context=await getSchoolCurriculumContext(schoolCode,{transaction,lock:true});
    const previous=await SchoolGradingProfile.findOne({where:{schoolCode,code},order:[['version','DESC']],transaction,lock:transaction.LOCK.UPDATE});
    const row=await SchoolGradingProfile.create({schoolCode,curriculumPackId:context.pack.id,code,name,version:Number(previous?.version||0)+1,profile,checksum:hash(profile),status:'draft',supersedesId:previous?.id||null,changeReason:reason,createdBy:actor.id},{transaction});
    await AuditLog.create({schoolCode,actorUserId:actor.id,actorRole:actor.role,module:'curriculum',action:'custom_grading_profile_created',entityType:'SchoolGradingProfile',entityId:String(row.id),before:previous?json(previous):null,after:json(row),reason,metadata:{adminOnly:true,versioned:true}},{transaction});
    return row;
  });
}

async function activateCustomGradingProfile({schoolCode,actor,profileId}) {
  return sequelize.transaction(async transaction=>{
    const row=await SchoolGradingProfile.findOne({where:{id:profileId,schoolCode},transaction,lock:transaction.LOCK.UPDATE});
    if(!row)throw appError('Custom grading profile not found.',404,'CUSTOM_GRADING_PROFILE_NOT_FOUND');
    if(row.status==='active')return row;
    await SchoolGradingProfile.update({status:'retired'},{where:{schoolCode,code:row.code,status:'active'},transaction,hooks:false});
    await row.update({status:'active',activatedBy:actor.id,activatedAt:new Date()},{transaction,hooks:false});
    await AuditLog.create({schoolCode,actorUserId:actor.id,actorRole:actor.role,module:'curriculum',action:'custom_grading_profile_activated',entityType:'SchoolGradingProfile',entityId:String(row.id),before:{status:'draft'},after:{status:'active',version:row.version,checksum:row.checksum},reason:row.changeReason,metadata:{adminOnly:true,versioned:true}},{transaction});
    return row;
  });
}

async function listCustomGradingProfiles(schoolCode) {
  return SchoolGradingProfile.findAll({where:{schoolCode},order:[['code','ASC'],['version','DESC']]});
}

async function resolveStudentCurriculum({studentId,assessmentDate=new Date(),transaction,lock=false}) {
  const student=await (Student.unscoped?Student.unscoped():Student).findByPk(Number(studentId),{transaction,lock:lock&&transaction?transaction.LOCK.UPDATE:undefined});
  if(!student)throw appError('Student not found.',404,'STUDENT_NOT_FOUND');
  const date=new Date(assessmentDate); if(Number.isNaN(date.getTime()))throw appError('Assessment date is invalid.');
  const day=date.toISOString().slice(0,10);
  let enrollment=null;
  if(student.activeEnrollmentId)enrollment=await StudentEnrollment.findOne({where:{id:student.activeEnrollmentId,studentId:student.id,status:'active'},transaction});
  if(!enrollment)enrollment=await StudentEnrollment.findOne({where:{studentId:student.id,status:'active',effectiveFrom:{[Op.lte]:day},[Op.or]:[{effectiveTo:null},{effectiveTo:{[Op.gte]:day}}]},order:[['effectiveFrom','DESC'],['id','DESC']],transaction});
  if(!enrollment)throw appError('Student has no active enrollment for this assessment.',409,'ACTIVE_ENROLLMENT_REQUIRED');
  if(!enrollment.classId)throw appError('The active enrollment has no class.',409,'ACTIVE_CLASS_REQUIRED');
  const schoolCode=enrollment.schoolCode||student.schoolCode;
  const classItem=await Class.findOne({where:{id:enrollment.classId,schoolCode},transaction});
  if(!classItem)throw appError('The active enrollment class is missing or belongs to another school.',409,'ACTIVE_CLASS_INVALID');
  const context=await getSchoolCurriculumContext(schoolCode,{transaction,lock:false});
  const enabled=new Set(context.assignment.enabledLevelCodes||[]);
  const levelCode=classItem.settings?.curriculumMeta?.levelCode||resolveClassLevelCode(context.pack,classItem);
  if(!levelCode||!enabled.has(String(levelCode)))throw appError('The learner class is not mapped to an enabled level in the active curriculum pack.',409,'CLASS_CURRICULUM_LEVEL_MISMATCH',{classId:classItem.id,levelCode});
  return {...context,student,enrollment,classItem,levelCode,assessmentDate:date};
}

module.exports={
  SELECTABLE_REVIEW_STATES,publicCountry,publicPack,packSnapshot,listCountries,listPacksForCountry,
  getSchoolCurriculumContext,updateSchoolCurriculum,createCustomGradingProfile,activateCustomGradingProfile,
  listCustomGradingProfiles,resolveStudentCurriculum,resolveClassLevelCode,validateCustomGradingProfile,validateWorkflowSelection
};
