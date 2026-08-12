'use strict';

const crypto=require('crypto');
const {Class,School,AuditLog,sequelize}=require('../models');

const STREAM_MODES=new Set(['none','global','per_level','custom']);

function generationError(message,statusCode=400,code='CLASS_GENERATION_INVALID',data){
  const error=new Error(message);error.statusCode=statusCode;error.code=code;if(data!==undefined)error.data=data;return error;
}
function cleanText(value){return String(value??'').trim().replace(/\s+/g,' ');}
function key(value){return cleanText(value).toLocaleLowerCase('en');}
function uniqueTexts(values){const seen=new Set(),out=[];for(const value of Array.isArray(values)?values:[]){const text=cleanText(value),normalized=key(text);if(text&&!seen.has(normalized)){seen.add(normalized);out.push(text);}}return out;}
function normalizeCustomClasses(values){
  const seen=new Set(),out=[];
  for(const raw of Array.isArray(values)?values:[]){
    const item=typeof raw==='string'?{name:raw}:raw||{};
    const name=cleanText(item.name||item.className),normalized=key(name);
    if(!name||seen.has(normalized))continue;
    seen.add(normalized);
    out.push({name,grade:cleanText(item.grade)||null,stream:cleanText(item.stream)||null,levelCode:cleanText(item.levelCode)||null,custom:true});
  }
  return out;
}
function normalizePerLevelStreams(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).map(([levelCode,streams])=>[cleanText(levelCode),uniqueTexts(streams)]).filter(([levelCode])=>levelCode));
}
function inferMode(raw,streams,perLevelStreams,customClasses,currentMode){
  const requested=cleanText(raw.streamMode||raw.mode||currentMode).toLowerCase();
  if(requested)return requested;
  if(Object.keys(perLevelStreams).length)return 'per_level';
  if(streams.length)return 'global';
  if(customClasses.length)return 'custom';
  return 'none';
}
function getConfig(school,assignment=null){
  const settings=school?.settings||{};
  const raw=assignment?.classGenerationConfig||settings.classGeneration||settings.curriculumEngine?.classGeneration||{};
  const streams=uniqueTexts(raw.streams),perLevelStreams=normalizePerLevelStreams(raw.perLevelStreams),customClasses=normalizeCustomClasses(raw.customClasses);
  return {streamMode:inferMode(raw,streams,perLevelStreams,customClasses,'none'),streams,perLevelStreams,customClasses,namingSeparator:cleanText(raw.namingSeparator)||' ',updatedAt:raw.updatedAt||null,updatedBy:raw.updatedBy||null};
}
function normalizeConfigPatch(school,patch={},actorUserId=null,pack=null){
  const current=getConfig(school);
  const raw=patch.classGeneration&&typeof patch.classGeneration==='object'?patch.classGeneration:patch;
  const streams=raw.streams!==undefined?uniqueTexts(raw.streams):current.streams;
  const perLevelStreams=raw.perLevelStreams!==undefined?normalizePerLevelStreams(raw.perLevelStreams):current.perLevelStreams;
  const customClasses=raw.customClasses!==undefined?normalizeCustomClasses(raw.customClasses):current.customClasses;
  const streamMode=inferMode(raw,streams,perLevelStreams,customClasses,current.streamMode);
  const config={streamMode,streams,perLevelStreams,customClasses,namingSeparator:cleanText(pack?.classNamingRules?.separator)||' ',updatedAt:new Date().toISOString(),updatedBy:actorUserId||current.updatedBy||null};
  if(pack)validateConfigAgainstPack(pack,null,config);
  return config;
}
function enabledLevels(pack,assignment){
  const enabled=new Set((assignment?.enabledLevelCodes||[]).map(String));
  return (pack.levels||[]).filter(level=>enabled.has(String(level.code))).sort((a,b)=>Number(a.order||0)-Number(b.order||0));
}
function resolveCustomLevel(levels,item){
  const wanted=[item.levelCode,item.grade].map(key).filter(Boolean);
  return levels.find(level=>wanted.includes(key(level.code))||wanted.includes(key(level.label)))||null;
}
function validateConfigAgainstPack(pack,assignment,config){
  const rules=pack.streamGenerationRules||{};
  const allowedModes=new Set((rules.modes||['none','global','per_level','custom']).map(String));
  if(!STREAM_MODES.has(config.streamMode)||!allowedModes.has(config.streamMode))throw generationError('The selected stream mode is not allowed by this curriculum pack.',400,'STREAM_MODE_NOT_ALLOWED',{streamMode:config.streamMode});
  const levelRows=assignment?enabledLevels(pack,assignment):(pack.levels||[]);
  const levelCodes=new Set(levelRows.map(level=>String(level.code)));
  const unknownOverrides=Object.keys(config.perLevelStreams).filter(code=>!levelCodes.has(code));
  if(unknownOverrides.length)throw generationError('Per-level streams contain levels outside the school curriculum selection.',400,'STREAM_LEVEL_NOT_ENABLED',{unknownLevelCodes:unknownOverrides});
  const maxStreams=Number(rules.maxStreamsPerLevel||20);
  if(config.streams.length>maxStreams||Object.values(config.perLevelStreams).some(streams=>streams.length>maxStreams))throw generationError(`A level may not have more than ${maxStreams} streams.`,400,'STREAM_LIMIT_EXCEEDED');
  const invalidCustom=config.customClasses.filter(item=>!resolveCustomLevel(levelRows,item));
  if(invalidCustom.length)throw generationError('Every custom class name must map to an enabled curriculum level.',400,'CUSTOM_CLASS_LEVEL_REQUIRED',{classNames:invalidCustom.map(item=>item.name)});
  if(config.streamMode==='custom'&&!config.customClasses.length)throw generationError('Custom mode requires at least one custom class name.',400,'CUSTOM_CLASSES_REQUIRED');
  return config;
}
async function curriculumContext(schoolCode,options={}){
  return require('./curriculumPackService').getSchoolCurriculumContext(schoolCode,options);
}
function buildExpectedClasses(school,context){
  if(!context?.pack||!context?.assignment)throw generationError('Active curriculum context is required.',409,'SCHOOL_CURRICULUM_NOT_CONFIGURED');
  const pack=context.pack.toJSON?context.pack.toJSON():context.pack;
  const assignment=context.assignment.toJSON?context.assignment.toJSON():context.assignment;
  const config=validateConfigAgainstPack(pack,assignment,getConfig(school,assignment));
  const levels=enabledLevels(pack,assignment),expected=[],seen=new Set();
  const separator=cleanText(pack.classNamingRules?.separator)||' ';
  if(config.streamMode!=='custom'){
    for(const level of levels){
      let streams=[];
      if(config.streamMode==='global')streams=config.streams;
      if(config.streamMode==='per_level')streams=config.perLevelStreams[level.code]||[];
      const variants=streams.length?streams:[null];
      for(const stream of variants){
        const name=stream?`${level.label}${separator}${stream}`:String(level.label),normalized=key(name);
        if(!name||seen.has(normalized))continue;
        seen.add(normalized);
        expected.push({name,grade:String(level.label),stream:stream||null,levelCode:String(level.code),levelLabel:String(level.label),curriculumLevel:level.group||null,curriculum:pack.legacySystemCode||pack.officialCode,curriculumPackId:pack.id,curriculumPackVersion:pack.version,custom:false});
      }
    }
  }
  for(const custom of config.customClasses){
    const level=resolveCustomLevel(levels,custom),normalized=key(custom.name);
    if(!level||seen.has(normalized))continue;
    seen.add(normalized);
    expected.push({...custom,grade:custom.grade||String(level.label),levelCode:String(level.code),levelLabel:String(level.label),curriculumLevel:level.group||null,curriculum:pack.legacySystemCode||pack.officialCode,curriculumPackId:pack.id,curriculumPackVersion:pack.version});
  }
  return expected;
}
function previewToken(school,context,expected,existing){
  const payload={schoolCode:school.schoolId,assignmentId:context.assignment.id,assignmentVersion:context.assignment.assignmentVersion,curriculumPackId:context.pack.id,curriculumPackVersion:context.pack.version,config:getConfig(school,context.assignment),expected:expected.map(item=>[key(item.name),item.levelCode,key(item.stream)]),existing:existing.map(row=>[Number(row.id),key(row.name),Boolean(row.isActive),row.updatedAt?new Date(row.updatedAt).toISOString():null])};
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
async function preview(school,options={}){
  const context=options.context||await curriculumContext(school.schoolId,{transaction:options.transaction,lock:false});
  const existing=await Class.findAll({where:{schoolCode:school.schoolId},attributes:['id','name','grade','stream','levelCode','isActive','teacherId','updatedAt'],order:[['name','ASC']],transaction:options.transaction,lock:options.lock});
  const expected=buildExpectedClasses(school,context),existingByName=new Map(existing.map(row=>[key(row.name),row])),toCreate=[],skippedExisting=[];
  for(const item of expected){const found=existingByName.get(key(item.name));if(found)skippedExisting.push({expected:item,existing:found.toJSON?found.toJSON():found,reason:found.isActive===false?'existing_archived_class':'already_exists'});else toCreate.push(item);}
  return {schoolCode:school.schoolId,countryIsoCode:context.pack.countryIsoCode,curriculumPackId:context.pack.id,curriculumPackVersion:context.pack.version,assignmentId:context.assignment.id,assignmentVersion:context.assignment.assignmentVersion,config:getConfig(school,context.assignment),expectedCount:expected.length,existingCount:existing.length,createCount:toCreate.length,skipCount:skippedExisting.length,toCreate,skippedExisting,invalid:[],previewToken:previewToken(school,context,expected,existing),destructiveChanges:false,learnersMoved:false,note:'Only missing classes will be created. Existing classes, learners, teachers, assignments, and history will not be changed.'};
}
function classSettings(context,spec){
  const pack=context.pack.toJSON?context.pack.toJSON():context.pack;
  const selected=new Set((context.assignment.selectedSubjectCodes||[]).map(String));
  const subjects=(pack.subjectStructure||[]).filter(subject=>{
    const id=String(subject.id||subject.code),levels=(subject.levelCodes||[]).map(String);
    return (!selected.size||selected.has(id))&&(!levels.length||levels.includes(String(spec.levelCode)));
  });
  return {generatedFromCurriculumPack:true,generatedAt:new Date().toISOString(),curriculumMeta:{countryIsoCode:pack.countryIsoCode,curriculumPackId:pack.id,curriculumPackVersion:pack.version,curriculumOfficialCode:pack.officialCode,assignmentId:context.assignment.id,assignmentVersion:context.assignment.assignmentVersion,levelCode:spec.levelCode,levelLabel:spec.levelLabel,curriculumLevel:spec.curriculumLevel},subjects:subjects.map(subject=>({id:subject.id||subject.code,name:subject.name,category:subject.category,isCore:!!subject.isCore,isOptional:!!subject.isOptional,countsInFinalByDefault:subject.countsInFinalByDefault!==false}))};
}
async function apply(school,actorUserId,suppliedToken,actorRole='admin'){
  return sequelize.transaction(async transaction=>{
    const lockedSchool=await School.findOne({where:{id:school.id},transaction,lock:transaction.LOCK.UPDATE});
    if(!lockedSchool)throw generationError('School no longer exists.',404,'SCHOOL_NOT_FOUND');
    const context=await curriculumContext(lockedSchool.schoolId,{transaction,lock:true});
    const current=await preview(lockedSchool,{transaction,lock:transaction.LOCK.UPDATE,context});
    if(!suppliedToken||suppliedToken!==current.previewToken){const error=generationError('Curriculum selection, stream configuration, or classes changed after preview. Review again before confirming.',409,'CLASS_GENERATION_PREVIEW_STALE');error.preview=current;throw error;}
    const lockedExisting=await Class.findAll({where:{schoolCode:lockedSchool.schoolId},attributes:['id','name'],transaction,lock:transaction.LOCK.UPDATE});
    const existingNames=new Set(lockedExisting.map(row=>key(row.name))),created=[];
    for(const spec of current.toCreate){
      if(existingNames.has(key(spec.name)))continue;
      const row=await Class.create({name:spec.name,grade:spec.grade,stream:spec.stream||null,schoolCode:lockedSchool.schoolId,teacherId:null,subjectTeachers:[],academicYear:String(new Date().getFullYear()),curriculum:spec.curriculum,curriculumPackId:spec.curriculumPackId,curriculumPackVersion:spec.curriculumPackVersion,levelCode:spec.levelCode,levelLabel:spec.levelLabel||spec.grade,curriculumLevel:spec.curriculumLevel||null,isActive:true,settings:classSettings(context,spec)},{transaction,realtimeHandled:true});
      existingNames.add(key(spec.name));created.push(row.toJSON?row.toJSON():row);
    }
    await AuditLog.create({schoolCode:lockedSchool.schoolId,actorUserId:actorUserId||null,actorRole,module:'curriculum',action:'missing_classes_generated',entityType:'SchoolCurriculumAssignment',entityId:String(context.assignment.id),before:null,after:{createdClassIds:created.map(row=>row.id),createdNames:created.map(row=>row.name)},reason:'Admin confirmed curriculum class-generation preview',metadata:{previewToken:suppliedToken,countryIsoCode:context.pack.countryIsoCode,curriculumPackId:context.pack.id,curriculumPackVersion:context.pack.version,assignmentVersion:context.assignment.assignmentVersion,skippedExistingIds:current.skippedExisting.map(row=>row.existing?.id).filter(Boolean),destructiveChanges:false,learnersMoved:false}},{transaction});
    if(transaction.afterCommit&&global.io)transaction.afterCommit(()=>global.io.to(`school-${lockedSchool.schoolId}`).emit('classes:generated',{schoolCode:lockedSchool.schoolId,created,count:created.length}));
    return {...current,created,createdCount:created.length};
  });
}
async function refreshExistingClassMetadata(){return {preserved:true,updatedClassIds:[],createdClassIds:[],deactivatedClassIds:[],note:'Existing class metadata is immutable during curriculum changes; active curriculum is resolved from the school assignment.'};}

module.exports={STREAM_MODES,cleanText,getConfig,normalizeConfigPatch,validateConfigAgainstPack,buildExpectedClasses,preview,apply,refreshExistingClassMetadata};
