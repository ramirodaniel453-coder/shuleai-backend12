'use strict';

const curriculumService=require('../services/curriculumPackService');

function fail(res,error){
  console.error('[v2045 curriculum]',error.code||'',error.message);
  return res.status(error.statusCode||500).json({success:false,code:error.code||'CURRICULUM_REQUEST_FAILED',message:error.statusCode?error.message:'The curriculum request could not be completed.',...(error.data!==undefined?{data:error.data}:{})});
}

exports.listCountries=async(req,res)=>{try{res.json({success:true,data:await curriculumService.listCountries()});}catch(error){fail(res,error);}};
exports.listPacks=async(req,res)=>{try{
  const includePending=req.user.role==='super_admin'&&String(req.query.includePending||'').toLowerCase()==='true';
  res.json({success:true,data:await curriculumService.listPacksForCountry(req.query.countryIsoCode||req.query.country,{includePending})});
}catch(error){fail(res,error);}};
exports.getWorkflow=async(req,res)=>{try{
  const context=await curriculumService.getSchoolCurriculumContext(req.user.schoolCode);
  const [countries,packs,customProfiles]=await Promise.all([
    curriculumService.listCountries(),curriculumService.listPacksForCountry(context.school.countryIsoCode||'KE',{includePending:req.user.role==='super_admin'}),curriculumService.listCustomGradingProfiles(context.school.schoolId)
  ]);
  res.json({success:true,data:{school:{id:context.school.id,schoolId:context.school.schoolId,name:context.school.name,countryIsoCode:context.school.countryIsoCode,curriculumVersion:context.school.curriculumVersion},country:curriculumService.publicCountry(context.country),curriculumPack:curriculumService.publicPack(context.pack),assignment:context.assignment,countries,packs,customGradingProfiles:customProfiles}});
}catch(error){fail(res,error);}};
exports.updateWorkflow=async(req,res)=>{try{
  const result=await curriculumService.updateSchoolCurriculum({schoolCode:req.user.schoolCode,actor:req.user,payload:req.body||{}});
  res.json({success:true,message:'Curriculum configuration version saved. Existing classes, learners, grades, reports, and history were not changed. Review the class preview before generating missing classes.',data:{school:{schoolId:result.school.schoolId,countryIsoCode:result.school.countryIsoCode,curriculumVersion:result.school.curriculumVersion},country:curriculumService.publicCountry(result.country),curriculumPack:curriculumService.publicPack(result.pack),assignment:result.assignment}});
}catch(error){fail(res,error);}};
exports.listCustomGradingProfiles=async(req,res)=>{try{res.json({success:true,data:await curriculumService.listCustomGradingProfiles(req.user.schoolCode)});}catch(error){fail(res,error);}};
exports.createCustomGradingProfile=async(req,res)=>{try{const row=await curriculumService.createCustomGradingProfile({schoolCode:req.user.schoolCode,actor:req.user,payload:req.body||{}});res.status(201).json({success:true,message:'Versioned custom grading profile saved as draft. Activate it explicitly before school use.',data:row});}catch(error){fail(res,error);}};
exports.activateCustomGradingProfile=async(req,res)=>{try{const row=await curriculumService.activateCustomGradingProfile({schoolCode:req.user.schoolCode,actor:req.user,profileId:req.params.profileId});res.json({success:true,message:'Custom grading profile activated and audit-logged.',data:row});}catch(error){fail(res,error);}};
