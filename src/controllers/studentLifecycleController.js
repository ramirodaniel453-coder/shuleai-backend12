const { Op } = require('sequelize');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { sequelize, Student, User, Class, Teacher, Parent, StudentParent, StudentEnrollment, PromotionBatch, PromotionDecision, ClassTransferRequest, ReportSnapshot, Fee, AuditLog } = require('../models');
const realtime = require('../services/realtimeService');
const subjectSelections = require('../services/studentSubjectSelectionService');
const enrollmentService = require('../services/studentEnrollmentService');
const schoolLinkageService = require('../services/schoolLinkageService');
const { createAlert } = require('../services/notificationService');

const OUTCOMES = new Set(['promote','repeat','move_stream','graduate','transfer_out','withdraw','hold_review']);
function code(req){ if(String(req.user?.role||'').toLowerCase()==='super_admin')return req.body?.schoolCode||req.query?.schoolCode||req.user?.schoolCode||null; return req.user?.schoolCode||null; }
function fail(res,error){const status=Number(error?.status)||500;return res.status(status).json({success:false,code:error?.code||undefined,message:error?.message||'Student lifecycle request failed',data:error?.data||undefined});}
function isoToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function text(v){ return String(v || '').trim().toLowerCase(); }
function rankClass(cls){
  const s = `${cls.levelCode || ''} ${cls.levelLabel || ''} ${cls.grade || ''} ${cls.name || ''}`.toLowerCase();
  let m;
  if ((m=s.match(/(?:pp|pre[- ]?primary)\s*([12])/))) return Number(m[1]);
  if ((m=s.match(/grade\s*(\d{1,2})/))) return 2 + Number(m[1]);
  if ((m=s.match(/standard\s*(\d)/))) return 20 + Number(m[1]);
  if ((m=s.match(/form\s*(\d)/))) return 28 + Number(m[1]);
  return 1000;
}
function sameLevel(a,b){ return rankClass(a) === rankClass(b); }
function curriculumFamily(cls){
  const value=`${cls?.levelCode||''} ${cls?.levelLabel||''} ${cls?.grade||''} ${cls?.name||''}`.toLowerCase();
  if(/\b(pp\s*[12]|pre[- ]?primary|grade\s*\d{1,2})\b/.test(value))return 'cbe';
  if(/\b(standard\s*\d|form\s*\d)\b/.test(value))return '844';
  return String(cls?.curriculum||cls?.system||'other').toLowerCase();
}
function isTerminalClass(cls){const value=`${cls?.levelCode||''} ${cls?.levelLabel||''} ${cls?.grade||''} ${cls?.name||''}`.toLowerCase();return /grade\s*12\b|form\s*4\b/.test(value);}
function nextClassesFor(current, classes){
  if(!current||isTerminalClass(current))return [];
  const currentRank=rankClass(current),family=curriculumFamily(current);
  if(currentRank>=1000)return [];
  const candidates=classes.filter(c=>curriculumFamily(c)===family&&rankClass(c)>currentRank).sort((a,b)=>rankClass(a)-rankClass(b)||Number(a.id)-Number(b.id));
  if(!candidates.length)return [];
  const nextRank=rankClass(candidates[0]);
  return candidates.filter(candidate=>rankClass(candidate)===nextRank);
}
function chooseBalancedDestination(current,classes,proposedCounts){
  const candidates=nextClassesFor(current,classes);
  return candidates.sort((a,b)=>(proposedCounts.get(Number(a.id))||0)-(proposedCounts.get(Number(b.id))||0)||Number(a.id)-Number(b.id))[0]||null;
}
async function ensureCurrentEnrollment(student, cls, year, actorId, transaction, term='Term 1'){
  return enrollmentService.ensureCurrentEnrollment({student,schoolCode:student.User.schoolCode,academicYear:year,term,actorId,transaction});
}
async function loadBatch(req,id,transaction){ return PromotionBatch.findOne({ where:{ id:Number(id), schoolCode:code(req) }, transaction, lock:transaction?.LOCK?.UPDATE }); }

exports.preview = async (req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    const closingYear=Number(req.body.closingYear), newYear=Number(req.body.newYear), effectiveDate=String(req.body.effectiveDate || `${newYear}-01-01`).slice(0,10);
    const closingTerm=enrollmentService.normalizeTerm(req.body.closingTerm)||'Term 3', newTerm=enrollmentService.normalizeTerm(req.body.newTerm)||'Term 1';
    if(!closingYear||!newYear||newYear<=closingYear){ await transaction.rollback(); return res.status(400).json({success:false,message:'Choose a valid closing year and a later new academic year'}); }
    const classes=await Class.findAll({where:{schoolCode:code(req),isActive:true},transaction});
    const classIds=classes.map(c=>c.id);
    const students=await (Student.unscoped?Student.unscoped():Student).findAll({ where:{status:'active',classId:{[Op.in]:classIds}}, include:[{model:User,where:{schoolCode:code(req),role:'student'},attributes:['id','name','schoolCode']}], transaction });
    const batch=await PromotionBatch.create({schoolCode:code(req),closingYear,newYear,effectiveDate,status:'draft',createdBy:req.user.id,summary:{total:students.length},metadata:{placementMode:'balanced_preview',closingTerm,newTerm}},{transaction});
    const proposedCounts=new Map(classes.map(cls=>[Number(cls.id),0]));
    for(const st of students){
      const current=classes.find(c=>Number(c.id)===Number(st.classId));
      const enrollment=await ensureCurrentEnrollment(st,current,closingYear,req.user.id,transaction,closingTerm);
      const activeEnrollmentCount=await StudentEnrollment.count({where:{schoolCode:code(req),studentId:st.id,status:'active'},transaction});
      const openTransfer=await ClassTransferRequest.findOne({where:{schoolCode:code(req),studentId:st.id,status:{[Op.in]:enrollmentService.OPEN_TRANSFER_STATUSES}},attributes:['id','status','effectiveDate'],transaction});
      const next=chooseBalancedDestination(current,classes,proposedCounts);
      if(next)proposedCounts.set(Number(next.id),(proposedCounts.get(Number(next.id))||0)+1);
      const warnings=[];
      if(!current) warnings.push('Current class is missing or inactive');
      if(activeEnrollmentCount>1)warnings.push('Multiple active enrolments require review');
      if(openTransfer)warnings.push(`Open class transfer request #${openTransfer.id} (${openTransfer.status}) must be resolved before promotion`);
      if(!next&&current&&!isTerminalClass(current))warnings.push(`No valid next ${curriculumFamily(current).toUpperCase()} class exists in this school`);
      if(next&&curriculumFamily(next)!==curriculumFamily(current))warnings.push('Invalid curriculum transition');
      const finalReport=await ReportSnapshot.findOne({where:{schoolCode:code(req),studentId:st.id,year:closingYear,status:'published',isCurrent:true},transaction});
      if(!finalReport) warnings.push('No published final report found for the closing year');
      if(next&&/grade\s*1[0-2]\b|senior/i.test(`${next.name||''} ${next.grade||''} ${next.levelCode||''}`)){
        const selections=await subjectSelections.listStudentSubjectSelections({schoolCode:code(req),studentId:st.id}).catch(()=>[]);
        if(!selections.some(row=>['taking','approved','parent_supported'].includes(String(row.status||'').toLowerCase())))warnings.push('Senior-school subject/pathway selection is missing');
      }
      let outcome=next?'promote':'graduate';
      if(!current||warnings.some(w=>/Multiple active|Invalid curriculum|Open class transfer/i.test(w)))outcome='hold_review';
      await PromotionDecision.create({schoolCode:code(req),batchId:batch.id,studentId:st.id,currentEnrollmentId:enrollment.id,fromClassId:current?.id||null,toClassId:next?.id||null,fromStream:current?.stream||null,toStream:next?.stream||null,outcome,warnings,status:warnings.length?'warning':'proposed',metadata:{studentName:st.User?.name||null,fromClassName:current?.name||null,toClassName:next?.name||null,curriculumFamily:current?curriculumFamily(current):null,placementMode:'balanced_preview'}},{transaction});
    }
    await transaction.commit();
    return exports.getBatch({...req,params:{id:batch.id}},res);
  }catch(error){if(!transaction.finished)await transaction.rollback();res.status(500).json({success:false,message:error.message});}
};

exports.getBatch=async(req,res)=>{
  try{
    const batch=await PromotionBatch.findOne({where:{id:Number(req.params.id),schoolCode:code(req)},include:[{model:PromotionDecision,include:[{model:Student,include:[{model:User,attributes:['id','name','profileImage']}]}]}],order:[[PromotionDecision,'id','ASC']]});
    if(!batch)return res.status(404).json({success:false,message:'Promotion batch not found'});
    res.json({success:true,data:batch});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};

exports.listBatches=async(req,res)=>{try{res.json({success:true,data:await PromotionBatch.findAll({where:{schoolCode:code(req)},order:[['createdAt','DESC']],limit:50})});}catch(error){res.status(500).json({success:false,message:error.message});}};

exports.updateDecision=async(req,res)=>{
  try{
    const decision=await PromotionDecision.findOne({where:{id:Number(req.params.decisionId),schoolCode:code(req)},include:[PromotionBatch]});
    if(!decision||decision.PromotionBatch?.status!=='draft')return res.status(409).json({success:false,message:'Only draft promotion decisions can be changed'});
    const outcome=String(req.body.outcome||decision.outcome);
    if(!OUTCOMES.has(outcome))return res.status(400).json({success:false,message:'Invalid promotion outcome'});
    let toClassId=req.body.toClassId===undefined?decision.toClassId:(req.body.toClassId?Number(req.body.toClassId):null);
    if(['promote','move_stream'].includes(outcome)&&!toClassId)return res.status(400).json({success:false,message:'A destination class is required'});
    if(outcome==='repeat')toClassId=decision.fromClassId;
    const destination=toClassId?await Class.findOne({where:{id:toClassId,schoolCode:code(req),isActive:true}}):null;
    if(toClassId&&!destination)return res.status(404).json({success:false,message:'Destination class is not active in this school'});
    if(outcome==='move_stream'){const origin=await Class.findOne({where:{id:decision.fromClassId,schoolCode:code(req)}});if(!origin||!sameLevel(origin,destination))return res.status(400).json({success:false,message:'Move stream must remain within the same grade or level'});}
    await decision.update({outcome,toClassId,toStream:req.body.toStream!==undefined?req.body.toStream:(destination?.stream||decision.toStream),status:'proposed',warnings:[]});
    res.json({success:true,data:decision});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};

async function applyBatch(batch,actorId,transaction){
  const decisions=await PromotionDecision.findAll({where:{batchId:batch.id,schoolCode:batch.schoolCode},transaction,lock:transaction.LOCK.UPDATE});
  const summary={promote:0,repeat:0,move_stream:0,graduate:0,transfer_out:0,withdraw:0,hold_review:0,unresolved:0};
  const closingTerm=enrollmentService.normalizeTerm(batch.metadata?.closingTerm)||'Term 3';
  const newTerm=enrollmentService.normalizeTerm(batch.metadata?.newTerm)||'Term 1';
  for(const d of decisions){
    summary[d.outcome]=(summary[d.outcome]||0)+1;
    if(d.outcome==='hold_review'){summary.unresolved++;continue;}
    const student=await (Student.unscoped?Student.unscoped():Student).findByPk(d.studentId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!student){summary.unresolved++;continue;}
    const old=await StudentEnrollment.findOne({where:{id:d.currentEnrollmentId,schoolCode:batch.schoolCode},transaction,lock:transaction.LOCK.UPDATE});
    if(['promote','repeat','move_stream'].includes(d.outcome)){
      const activeNow=await StudentEnrollment.findOne({where:{schoolCode:batch.schoolCode,studentId:d.studentId,status:'active'},transaction,lock:transaction.LOCK.UPDATE});
      const openTransfer=await ClassTransferRequest.findOne({where:{schoolCode:batch.schoolCode,studentId:d.studentId,status:{[Op.in]:enrollmentService.OPEN_TRANSFER_STATUSES}},transaction,lock:transaction.LOCK.UPDATE});
      if(!activeNow||Number(activeNow.id)!==Number(d.currentEnrollmentId)){summary.unresolved++;await d.update({status:'blocked',warnings:['Student class changed after this promotion preview. Generate a fresh preview.']},{transaction});continue;}
      if(openTransfer){summary.unresolved++;await d.update({status:'blocked',warnings:[`Open class transfer request #${openTransfer.id} must be resolved before promotion.`]},{transaction});continue;}
      if(!d.toClassId){summary.unresolved++;await d.update({status:'blocked',warnings:['Destination class is missing']},{transaction});continue;}
      try{
        const result=await enrollmentService.applyDirectMovement({schoolCode:batch.schoolCode,studentId:d.studentId,toClassId:d.toClassId,effectiveDate:String(batch.effectiveDate),academicYear:batch.newYear,term:newTerm,movementType:d.outcome==='move_stream'?'promotion_stream_change':d.outcome,reason:`Academic year transition ${batch.closingYear} to ${batch.newYear}`,actorId,actorRole:'admin',sourceId:`promotion:${batch.id}:${d.id}`,transaction,createTargetFeeAccount:true});
        const feeResult=result.feeResult?{created:!!result.feeResult.created,changed:!!result.feeResult.changed,feeId:result.feeResult.fee?.id||null,structureId:result.feeResult.structure?.id||null,before:result.feeResult.before||null,target:result.feeResult.target??null,reason:result.feeResult.reason||null}:null;
        await d.update({status:'applied',appliedEnrollmentId:result.enrollment.id,metadata:{...(d.metadata||{}),previousEnrollmentId:result.previousEnrollment.id,feeAccountId:feeResult?.feeId||null,feeResult}},{transaction});
      }catch(error){summary.unresolved++;await d.update({status:'blocked',warnings:[error.message]},{transaction});}
    }else{
      if(old)await old.update({status:'closed',effectiveTo:enrollmentService.dayBefore(String(batch.effectiveDate)),endTerm:closingTerm,endedReason:d.outcome,movementType:d.outcome,movementReason:`Academic year transition ${batch.closingYear} to ${batch.newYear}`,classTeacherIdAtEnd:old.classTeacherIdAtStart||null,closedBy:actorId,version:Number(old.version||1)+1},{transaction,hooks:false});
      const status=d.outcome==='graduate'?'graduated':d.outcome==='transfer_out'?'transferred':'inactive';
      await student.update({status,activeEnrollmentId:null},{transaction,hooks:false});
      await d.update({status:'applied'},{transaction});
      await realtime.emitToStudentContext(batch.schoolCode,student.id,'student:school_status_changed',{studentId:student.id,status,outcome:d.outcome,effectiveDate:batch.effectiveDate,batchId:batch.id},{transaction,entityType:'PromotionDecision',entityId:d.id,version:1});
    }
  }
  await batch.update({status:'applied',confirmedBy:actorId,confirmedAt:new Date(),summary},{transaction});
  await AuditLog.create({schoolCode:batch.schoolCode,actorUserId:actorId,actorRole:'admin',module:'student_lifecycle',action:'promotion_applied',entityType:'PromotionBatch',entityId:String(batch.id),after:summary,metadata:{effectiveDate:batch.effectiveDate,newYear:batch.newYear,closingTerm,newTerm}},{transaction});
  await realtime.emit({type:'promotion:completed',schoolCode:batch.schoolCode,audience:{school:true},entityType:'PromotionBatch',entityId:batch.id,version:1,data:{batchId:batch.id,effectiveDate:batch.effectiveDate,newYear:batch.newYear,summary},transaction});
  await realtime.emitToSchool(batch.schoolCode,'analytics:invalidated',{scope:'students_and_academics',batchId:batch.id},{transaction});
  return summary;
}

exports.confirm=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    const batch=await loadBatch(req,req.params.id,transaction);
    if(!batch||batch.status!=='draft'){await transaction.rollback();return res.status(409).json({success:false,message:'Only a draft promotion batch can be confirmed'});}
    const blocked=await PromotionDecision.count({where:{batchId:batch.id,outcome:'hold_review'},transaction});
    if(blocked&&!req.body.allowUnresolved){await transaction.rollback();return res.status(409).json({success:false,message:`${blocked} learner(s) are still held for review. Resolve them or explicitly allow unresolved records.`});}
    if(batch.effectiveDate>isoToday()){
      await batch.update({status:'scheduled',confirmedBy:req.user.id,confirmedAt:new Date(),summary:{...(batch.summary||{}),unresolved:blocked}},{transaction});
      await transaction.commit();
      return res.json({success:true,message:`Promotion scheduled for ${batch.effectiveDate}. Current classes remain active until that date.`,data:batch});
    }
    const summary=await applyBatch(batch,req.user.id,transaction);
    await transaction.commit();
    res.json({success:true,message:'Academic-year transition completed without deleting historical records.',data:{batchId:batch.id,summary}});
  }catch(error){if(!transaction.finished)await transaction.rollback();res.status(500).json({success:false,message:error.message});}
};

exports.applyDueSystem = async () => {
  const transaction = await sequelize.transaction();
  try {
    const batches = await PromotionBatch.findAll({ where:{ status:'scheduled', effectiveDate:{ [Op.lte]:isoToday() } }, transaction, lock:transaction.LOCK.UPDATE });
    const results = [];
    for (const batch of batches) {
      const actorId = batch.confirmedBy || batch.createdBy;
      results.push({ batchId:batch.id, schoolCode:batch.schoolCode, summary:await applyBatch(batch, actorId, transaction) });
    }
    await transaction.commit();
    return results;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
};

exports.applyDue=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    const batches=await PromotionBatch.findAll({where:{schoolCode:code(req),status:'scheduled',effectiveDate:{[Op.lte]:isoToday()}},transaction,lock:transaction.LOCK.UPDATE});
    const results=[];for(const batch of batches)results.push({batchId:batch.id,summary:await applyBatch(batch,req.user.id,transaction)});
    await transaction.commit();res.json({success:true,data:results});
  }catch(error){if(!transaction.finished)await transaction.rollback();res.status(500).json({success:false,message:error.message});}
};

exports.rollback=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    const batch=await loadBatch(req,req.params.id,transaction);
    if(!batch||batch.status!=='applied'){await transaction.rollback();return res.status(409).json({success:false,message:'Only an applied transition can be rolled back'});}
    const reason=String(req.body.reason||'').trim();if(!reason){await transaction.rollback();return res.status(400).json({success:false,message:'A rollback reason is required'});}
    const decisions=await PromotionDecision.findAll({where:{batchId:batch.id,status:'applied'},transaction,lock:transaction.LOCK.UPDATE});
    for(const d of decisions){
      if(!d.appliedEnrollmentId)continue;
      const activeNow=await StudentEnrollment.findOne({where:{schoolCode:batch.schoolCode,studentId:d.studentId,status:'active'},transaction,lock:transaction.LOCK.UPDATE});
      if(Number(activeNow?.id)!==Number(d.appliedEnrollmentId)){
        await transaction.rollback();
        return res.status(409).json({success:false,message:'At least one learner moved again after this promotion. Roll back the latest class movement first; no promotion records were changed.'});
      }
    }
    for(const d of decisions){
      const student=await (Student.unscoped?Student.unscoped():Student).findByPk(d.studentId,{transaction,lock:transaction.LOCK.UPDATE});
      if(d.appliedEnrollmentId){const newer=await StudentEnrollment.findByPk(d.appliedEnrollmentId,{transaction,lock:transaction.LOCK.UPDATE});if(newer)await newer.update({status:'reversed',effectiveTo:isoToday(),endedReason:'promotion_rollback',closedBy:req.user.id},{transaction});}
      const old=await StudentEnrollment.findByPk(d.currentEnrollmentId,{transaction,lock:transaction.LOCK.UPDATE});
      if(old){
        await old.update({status:'active',effectiveTo:null,endTerm:null,endedReason:null,closedBy:null,classTeacherIdAtEnd:null,movementType:'promotion_rollback',movementReason:reason,version:Number(old.version||1)+1},{transaction,hooks:false});
        const restoredClass=await Class.findByPk(old.classId,{transaction});
        await student?.update({classId:old.classId,grade:restoredClass?.name||student.grade,activeEnrollmentId:old.id,status:'active'},{transaction,hooks:false});
        const feeResult=d.metadata?.feeResult||null;
        const feeId=feeResult?.feeId||d.metadata?.feeAccountId;
        if(feeId&&feeResult?.changed!==false){
          const fee=await Fee.findByPk(feeId,{transaction,lock:transaction.LOCK.UPDATE});
          if(fee){
            const covered=Number(fee.parentPaidAmount??fee.paidAmount??0)+Number(fee.creditAmount||0);
            const before=feeResult?.before&&typeof feeResult.before==='object'?feeResult.before:null;
            const structure=before?null:await enrollmentService.getFeeStructure({schoolCode:batch.schoolCode,classId:old.classId,term:enrollmentService.normalizeTerm(batch.metadata?.newTerm)||'Term 1',year:batch.newYear,transaction});
            const total=before?Math.max(covered,Number(before.totalAmount||0)):structure?Math.max(covered,Number(structure.totalAmount||0)):Number(fee.totalAmount||0);
            const restoredClassId=before?.classId??old.classId;
            const restoredStructureId=before?.feeStructureId?Number(before.feeStructureId):(structure?Number(structure.id):fee.feeStructureId);
            const auditTrail=[...(Array.isArray(fee.auditTrail)?fee.auditTrail:[]),{action:'promotion_fee_account_rollback',batchId:batch.id,decisionId:d.id,restoredClassId,structureId:restoredStructureId||null,actorId:req.user.id,at:new Date().toISOString(),note:before?'Restored the exact pre-promotion fee state':structure?'Reassigned to restored class fee structure':'Previous-class fee structure missing; amount preserved for finance review'}];
            await fee.update({classId:restoredClassId,totalAmount:total,feeStructureId:restoredStructureId,dueDate:before?.dueDate||structure?.dueDate||fee.dueDate,currency:before?.currency||structure?.currency||fee.currency,status:covered>=total&&total>0?'paid':covered>0?'partial':'unpaid',auditTrail},{transaction});
          }
        }
      }
      await d.update({status:'reversed',metadata:{...(d.metadata||{}),rollbackReason:reason,rolledBackAt:new Date().toISOString()}},{transaction});
    }
    await batch.update({status:'rolled_back',rollbackBy:req.user.id,rollbackAt:new Date(),metadata:{...(batch.metadata||{}),rollbackReason:reason}},{transaction});
    await AuditLog.create({schoolCode:code(req),actorUserId:req.user.id,actorRole:req.user.role,module:'student_lifecycle',action:'promotion_rolled_back',entityType:'PromotionBatch',entityId:String(batch.id),reason},{transaction});
    await realtime.emitToSchool(code(req),'promotion:rolled_back',{batchId:batch.id,reason},{transaction});
    await transaction.commit();res.json({success:true,message:'Promotion rollback completed and previous enrolments restored.',data:{batchId:batch.id}});
  }catch(error){if(!transaction.finished)await transaction.rollback();res.status(500).json({success:false,message:error.message});}
};

// Enrollment history and transfer endpoints are defined below.


exports.exportBatch = async (req,res) => {
  try {
    const format=String(req.params.format||'xlsx').toLowerCase();
    const batch=await PromotionBatch.findOne({where:{id:Number(req.params.id),schoolCode:code(req)},include:[{model:PromotionDecision,include:[{model:Student,include:[{model:User,attributes:['id','name']}]}]}]});
    if(!batch)return res.status(404).json({success:false,message:'Promotion batch not found'});
    const decisions=batch.PromotionDecisions||[];
    const classes=await Class.findAll({where:{schoolCode:code(req)},attributes:['id','name','stream']});
    const className=id=>classes.find(c=>Number(c.id)===Number(id))?.name||'';
    const rows=decisions.map(d=>({
      student:d.Student?.User?.name||d.metadata?.studentName||`Student ${d.studentId}`,
      fromClass:className(d.fromClassId)||d.metadata?.fromClassName||'',
      toClass:className(d.toClassId)||d.metadata?.toClassName||'',
      fromStream:d.fromStream||'',toStream:d.toStream||'',outcome:d.outcome,status:d.status,
      warnings:Array.isArray(d.warnings)?d.warnings.join('; '):''
    }));
    const base=`Academic_Year_Transition_${batch.closingYear}_to_${batch.newYear}`;
    if(format==='pdf'){
      res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${base}_Summary.pdf"`);
      const doc=new PDFDocument({size:'A4',margin:40});doc.pipe(res);
      doc.font('Helvetica-Bold').fontSize(18).text('Academic Year Transition Summary',{align:'center'});
      doc.moveDown(.5).font('Helvetica').fontSize(10).text(`Closing year: ${batch.closingYear}    New year: ${batch.newYear}    Effective date: ${batch.effectiveDate}    Status: ${batch.status}`,{align:'center'});
      doc.moveDown();const grouped=rows.reduce((a,r)=>{a[r.outcome]=(a[r.outcome]||0)+1;return a;},{});
      Object.entries(grouped).forEach(([k,v])=>doc.font('Helvetica-Bold').fontSize(11).text(`${k.replace(/_/g,' ')}: ${v}`));
      doc.moveDown().font('Helvetica-Bold').fontSize(10).text('Learner decisions');
      rows.forEach((r,i)=>{if(doc.y>740)doc.addPage();doc.font('Helvetica').fontSize(8).text(`${i+1}. ${r.student} — ${r.fromClass||'—'} → ${r.toClass||r.outcome} — ${r.outcome}${r.warnings?` — ${r.warnings}`:''}`);});
      doc.end();return;
    }
    if(format!=='xlsx')return res.status(400).json({success:false,message:'Use pdf or xlsx export format'});
    const workbook=new ExcelJS.Workbook();workbook.creator='Shule AI';workbook.created=new Date();
    const addSheet=(name,data)=>{const ws=workbook.addWorksheet(name);ws.columns=[{header:'Student',key:'student',width:28},{header:'From Class',key:'fromClass',width:18},{header:'To Class',key:'toClass',width:18},{header:'From Stream',key:'fromStream',width:14},{header:'To Stream',key:'toStream',width:14},{header:'Outcome',key:'outcome',width:18},{header:'Status',key:'status',width:15},{header:'Warnings',key:'warnings',width:45}];ws.addRows(data);ws.getRow(1).font={bold:true};ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:'H1'};};
    const overview=workbook.addWorksheet('Overview');overview.addRows([['Closing Year',batch.closingYear],['New Year',batch.newYear],['Effective Date',String(batch.effectiveDate)],['Status',batch.status],['Total Learners',rows.length],...Object.entries(rows.reduce((a,r)=>{a[r.outcome]=(a[r.outcome]||0)+1;return a;},{})).map(([k,v])=>[k.replace(/_/g,' '),v])]);overview.getColumn(1).width=28;overview.getColumn(2).width=20;overview.getColumn(1).font={bold:true};
    addSheet('Promoted Students',rows.filter(r=>['promote','move_stream'].includes(r.outcome)));
    addSheet('Repeaters',rows.filter(r=>r.outcome==='repeat'));
    addSheet('Graduates',rows.filter(r=>r.outcome==='graduate'));
    addSheet('Transfers Withdrawals',rows.filter(r=>['transfer_out','withdraw'].includes(r.outcome)));
    addSheet('Unresolved Students',rows.filter(r=>r.outcome==='hold_review'||r.status==='blocked'||r.warnings));
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${base}.xlsx"`);await workbook.xlsx.write(res);res.end();
  }catch(error){if(!res.headersSent)res.status(500).json({success:false,message:error.message});else res.end();}
};

function transferInclude(){
  return [
    {model:Student,include:[{model:User,attributes:['id','name','email','phone']}]},
    {model:Class,as:'FromClass',attributes:['id','name','grade','stream','teacherId']},
    {model:Class,as:'ToClass',attributes:['id','name','grade','stream','teacherId']}
  ];
}

async function assertHistoryAccess(req, student, rows){
  const role=String(req.user.role||'').toLowerCase();
  if(['admin','super_admin'].includes(role))return true;
  if(role==='student'){
    const profile=await Student.findOne({where:{userId:req.user.id}});
    return Number(profile?.id)===Number(student.id);
  }
  if(role==='parent'){
    const parent=await Parent.findOne({where:{userId:req.user.id}});
    if(!parent)return false;
    return !!(await StudentParent.findOne({where:{studentId:student.id,parentId:parent.id}}));
  }
  if(role==='teacher'){
    const teacher=await Teacher.findOne({where:{userId:req.user.id}});
    if(!teacher)return false;
    const classIds=[...new Set(rows.map(r=>Number(r.classId)).filter(Boolean))];
    if(rows.some(r=>Number(r.classTeacherIdAtStart)===Number(teacher.id)||Number(r.classTeacherIdAtEnd)===Number(teacher.id)))return true;
    if(!classIds.length)return false;
    const classes=await Class.findAll({where:{id:{[Op.in]:classIds},schoolCode:code(req)}});
    for(const cls of classes){
      const ids=await enrollmentService.classTeacherIdsForClass({cls,schoolCode:code(req)});
      if(ids.includes(Number(teacher.id)))return true;
    }
    return false;
  }
  return false;
}

exports.enrollmentHistory=async(req,res)=>{
  try{
    const schoolCode=code(req);
    const student=await enrollmentService.findStudentInSchool({schoolCode,studentId:req.params.studentId});
    if(!student)return res.status(404).json({success:false,message:'Student not found'});
    const rows=await StudentEnrollment.findAll({where:{schoolCode,studentId:student.id},include:[{model:Class,attributes:['id','name','grade','stream','isActive']}],order:[['effectiveFrom','DESC'],['id','DESC']]});
    if(!(await assertHistoryAccess(req,student,rows)))return res.status(403).json({success:false,message:'You are not allowed to view this student enrollment history'});
    res.json({success:true,data:{student:{id:student.id,name:student.User?.name,elimuid:student.elimuid,currentClassId:student.classId},enrollments:rows}});
  }catch(error){fail(res,error);}
};

exports.myEnrollmentHistory=async(req,res)=>{
  try{
    if(req.user.role!=='student')return res.status(403).json({success:false,message:'Student access only'});
    const student=await Student.findOne({where:{userId:req.user.id}});
    if(!student)return res.status(404).json({success:false,message:'Student profile not found'});
    req.params.studentId=student.id;
    return exports.enrollmentHistory(req,res);
  }catch(error){fail(res,error);}
};

exports.childEnrollmentHistory=async(req,res)=>{
  try{
    if(req.user.role!=='parent')return res.status(403).json({success:false,message:'Parent access only'});
    return exports.enrollmentHistory(req,res);
  }catch(error){fail(res,error);}
};

exports.previewTransfer=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    if(!['admin','super_admin','teacher'].includes(req.user.role)){await transaction.rollback();return res.status(403).json({success:false,message:'Only school administrators and class teachers can preview a class transfer'});}
    const result=await enrollmentService.validateMovement({schoolCode:code(req),studentId:req.body.studentId,toClassId:req.body.toClassId,effectiveDate:req.body.effectiveDate,academicYear:req.body.academicYear,term:req.body.term,reason:req.body.reason,feeAction:req.body.feeAction||'keep_current_period',actor:req.user,transaction});
    await transaction.commit();
    res.json({success:true,data:{student:{id:result.student.id,name:result.student.User?.name,elimuid:result.student.elimuid},currentEnrollment:{id:result.currentEnrollment.id,effectiveFrom:result.currentEnrollment.effectiveFrom,academicYear:result.currentEnrollment.academicYear,startTerm:result.currentEnrollment.startTerm},fromClass:enrollmentService.publicClass(result.fromClass),toClass:enrollmentService.publicClass(result.toClass),academicYear:result.academicYear,term:result.term,effectiveDate:result.effectiveDate,reason:result.reason,feeAction:result.feeAction,feePreview:result.feePreview,impactPreview:result.impactPreview,warnings:[...(result.impactPreview.requiresAcknowledgement?['This backdated movement affects existing attendance, marks, or a published report. Administrator acknowledgement is required.']:[]),...(result.feePreview.requiresChoice?['The target class has a different fee structure. Select how the difference should be handled.']:[])]}});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
};

async function createTransferRequest(req,res,{teacherRequest=false}={}){
  const transaction=await sequelize.transaction();
  try{
    const role=req.user.role;
    if(teacherRequest&&role!=='teacher'){await transaction.rollback();return res.status(403).json({success:false,message:'Teacher access only'});}
    if(!teacherRequest&&!['admin','super_admin'].includes(role)){await transaction.rollback();return res.status(403).json({success:false,message:'Administrator access only'});}
    const result=await enrollmentService.validateMovement({schoolCode:code(req),studentId:req.body.studentId,toClassId:req.body.toClassId,effectiveDate:req.body.effectiveDate,academicYear:req.body.academicYear,term:req.body.term,reason:req.body.reason,feeAction:teacherRequest?'keep_current_period':(req.body.feeAction||'keep_current_period'),actor:req.user,transaction});
    if(!teacherRequest&&result.impactPreview.requiresAcknowledgement&&req.body.acknowledgeHistoricalImpact!==true){await transaction.rollback();return res.status(409).json({success:false,code:'HISTORICAL_IMPACT_ACK_REQUIRED',message:'This backdated transfer affects existing records. Review the preview and explicitly acknowledge the historical impact.',data:{impactPreview:result.impactPreview,feePreview:result.feePreview}});}
    const request=await ClassTransferRequest.create({schoolCode:code(req),studentId:result.student.id,requestedBy:req.user.id,requestedByRole:role,fromEnrollmentId:result.currentEnrollment.id,fromClassId:result.fromClass.id,toClassId:result.toClass.id,academicYear:result.academicYear,term:result.term,effectiveDate:result.effectiveDate,reason:result.reason,note:String(req.body.note||'').trim()||null,feeAction:teacherRequest?'keep_current_period':result.feeAction,feePreview:result.feePreview,impactPreview:result.impactPreview,status:teacherRequest?'pending':'approved',approvedBy:teacherRequest?null:req.user.id,approvedAt:teacherRequest?null:new Date(),metadata:{createdFrom:teacherRequest?'class_teacher_request':'admin_direct_transfer',acknowledgedHistoricalImpact:req.body.acknowledgeHistoricalImpact===true}},{transaction});
    await AuditLog.create({schoolCode:code(req),actorUserId:req.user.id,actorRole:role,module:'student_lifecycle',action:teacherRequest?'class_transfer_requested':'class_transfer_approved',entityType:'ClassTransferRequest',entityId:String(request.id),after:request.toJSON(),reason:request.reason},{transaction});
    if(teacherRequest){
      const admins=await User.findAll({where:{schoolCode:code(req),role:'admin',isActive:true},attributes:['id'],transaction});
      for(const admin of admins)await createAlert({userId:admin.id,role:'admin',type:'approval',severity:'info',title:'Class transfer request awaiting approval',message:`${result.student.User?.name||'A learner'}: ${result.fromClass.name} → ${result.toClass.name}, effective ${result.effectiveDate}.`,categoryLabel:'Student School Cycle',sourceType:'class_transfer_request',sourceLabel:'Class Teacher',studentId:result.student.id,classId:result.fromClass.id,dedupeKey:`class-transfer-request:${request.id}:${admin.id}`,actionUrl:'#class-transfers',data:{schoolCode:code(req),requestId:request.id,studentId:result.student.id},transaction});
      await realtime.emitToRole(code(req),'admin','student:class_transfer_requested',{requestId:request.id,studentId:result.student.id,fromClassId:result.fromClass.id,toClassId:result.toClass.id,effectiveDate:result.effectiveDate},{transaction,entityType:'ClassTransferRequest',entityId:request.id,version:1});
    }
    if(!teacherRequest)await enrollmentService.applyRequest({requestId:request.id,actorId:req.user.id,actorRole:role,transaction});
    await transaction.commit();
    const saved=await ClassTransferRequest.findByPk(request.id,{include:transferInclude()});
    res.status(teacherRequest?201:200).json({success:true,message:teacherRequest?'Transfer request sent to the school administrator for approval.':(saved.status==='scheduled'?`Transfer scheduled for ${saved.effectiveDate}.`:'Student transferred without deleting historical records.'),data:saved});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
}

exports.requestTransfer=(req,res)=>createTransferRequest(req,res,{teacherRequest:true});
exports.createTransfer=(req,res)=>createTransferRequest(req,res,{teacherRequest:false});

exports.listTransfers=async(req,res)=>{
  try{
    if(!['admin','super_admin','teacher'].includes(req.user.role))return res.status(403).json({success:false,message:'Forbidden'});
    const where={schoolCode:code(req)};
    if(req.user.role==='teacher')where.requestedBy=req.user.id;
    if(req.query.status)where.status=String(req.query.status);
    if(req.query.studentId)where.studentId=Number(req.query.studentId);
    const rows=await ClassTransferRequest.findAll({where,include:transferInclude(),order:[['createdAt','DESC']],limit:100});
    res.json({success:true,data:rows});
  }catch(error){fail(res,error);}
};

exports.getTransfer=async(req,res)=>{
  try{
    const row=await ClassTransferRequest.findOne({where:{id:Number(req.params.id),schoolCode:code(req)},include:transferInclude()});
    if(!row)return res.status(404).json({success:false,message:'Class transfer request not found'});
    if(req.user.role==='teacher'&&Number(row.requestedBy)!==Number(req.user.id))return res.status(403).json({success:false,message:'You can view only transfer requests you submitted'});
    if(!['admin','super_admin','teacher'].includes(req.user.role))return res.status(403).json({success:false,message:'Forbidden'});
    res.json({success:true,data:row});
  }catch(error){fail(res,error);}
};

exports.approveTransfer=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    if(!['admin','super_admin'].includes(req.user.role)){await transaction.rollback();return res.status(403).json({success:false,message:'Administrator approval is required'});}
    const request=await ClassTransferRequest.findOne({where:{id:Number(req.params.id),schoolCode:code(req)},transaction,lock:transaction.LOCK.UPDATE});
    if(!request||request.status!=='pending'){await transaction.rollback();return res.status(409).json({success:false,message:'Only a pending transfer request can be approved'});}
    const feeAction=req.body.feeAction||request.feeAction||'keep_current_period';
    const result=await enrollmentService.validateMovement({schoolCode:code(req),studentId:request.studentId,toClassId:request.toClassId,effectiveDate:request.effectiveDate,academicYear:request.academicYear,term:request.term,reason:request.reason,feeAction,actor:req.user,transaction,allowExistingRequestId:request.id});
    if(result.impactPreview.requiresAcknowledgement&&req.body.acknowledgeHistoricalImpact!==true){await transaction.rollback();return res.status(409).json({success:false,code:'HISTORICAL_IMPACT_ACK_REQUIRED',message:'This backdated transfer affects existing records. Explicit administrator acknowledgement is required.',data:{impactPreview:result.impactPreview,feePreview:result.feePreview}});}
    await request.update({feeAction,feePreview:result.feePreview,impactPreview:result.impactPreview,status:'approved',approvedBy:req.user.id,approvedAt:new Date(),version:Number(request.version||1)+1,metadata:{...(request.metadata||{}),approvalNote:String(req.body.note||'').trim()||null,acknowledgedHistoricalImpact:req.body.acknowledgeHistoricalImpact===true}},{transaction});
    const appliedRequest=await enrollmentService.applyRequest({requestId:request.id,actorId:req.user.id,actorRole:req.user.role,transaction});
    await AuditLog.create({schoolCode:code(req),actorUserId:req.user.id,actorRole:req.user.role,module:'student_lifecycle',action:'class_transfer_request_approved',entityType:'ClassTransferRequest',entityId:String(request.id),reason:request.reason},{transaction});
    await createAlert({userId:request.requestedBy,role:request.requestedByRole,type:'approval',severity:'success',title:'Class transfer request approved',message:`The transfer request has been ${request.effectiveDate>isoToday()?'approved and scheduled':'approved and applied'}.`,categoryLabel:'Student School Cycle',sourceType:'class_transfer_approval',sourceLabel:'School Administration',studentId:request.studentId,dedupeKey:`class-transfer-approved:${request.id}:${request.requestedBy}`,actionUrl:'#student-lifecycle',data:{schoolCode:code(req),requestId:request.id},transaction});
    await transaction.commit();
    res.json({success:true,message:appliedRequest.status==='scheduled'?`Transfer approved and scheduled for ${request.effectiveDate}.`:'Transfer approved and applied.',data:await ClassTransferRequest.findByPk(request.id,{include:transferInclude()})});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
};

exports.rejectTransfer=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    if(!['admin','super_admin'].includes(req.user.role)){await transaction.rollback();return res.status(403).json({success:false,message:'Administrator access only'});}
    const rejectionReason=String(req.body.reason||'').trim();if(!rejectionReason){await transaction.rollback();return res.status(400).json({success:false,message:'A rejection reason is required'});}
    const request=await ClassTransferRequest.findOne({where:{id:Number(req.params.id),schoolCode:code(req)},transaction,lock:transaction.LOCK.UPDATE});
    if(!request||request.status!=='pending'){await transaction.rollback();return res.status(409).json({success:false,message:'Only a pending transfer request can be rejected'});}
    await request.update({status:'rejected',rejectedBy:req.user.id,rejectedAt:new Date(),rejectionReason,version:Number(request.version||1)+1},{transaction});
    await AuditLog.create({schoolCode:code(req),actorUserId:req.user.id,actorRole:req.user.role,module:'student_lifecycle',action:'class_transfer_request_rejected',entityType:'ClassTransferRequest',entityId:String(request.id),reason:rejectionReason},{transaction});
    await createAlert({userId:request.requestedBy,role:request.requestedByRole,type:'approval',severity:'warning',title:'Class transfer request rejected',message:rejectionReason,categoryLabel:'Student School Cycle',sourceType:'class_transfer_rejection',sourceLabel:'School Administration',studentId:request.studentId,dedupeKey:`class-transfer-rejected:${request.id}:${request.requestedBy}`,actionUrl:'#student-lifecycle',data:{schoolCode:code(req),requestId:request.id},transaction});
    await transaction.commit();res.json({success:true,message:'Transfer request rejected.',data:request});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
};

exports.cancelTransfer=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    const request=await ClassTransferRequest.findOne({where:{id:Number(req.params.id),schoolCode:code(req)},transaction,lock:transaction.LOCK.UPDATE});
    if(!request){await transaction.rollback();return res.status(404).json({success:false,message:'Transfer request not found'});}
    const admin=['admin','super_admin'].includes(req.user.role),owner=Number(request.requestedBy)===Number(req.user.id);
    if(!admin&&!owner){await transaction.rollback();return res.status(403).json({success:false,message:'You cannot cancel this transfer request'});}
    if(!['pending','approved','scheduled'].includes(request.status)){await transaction.rollback();return res.status(409).json({success:false,message:'This transfer request can no longer be cancelled'});}
    await request.update({status:'cancelled',version:Number(request.version||1)+1,metadata:{...(request.metadata||{}),cancelledBy:req.user.id,cancelledAt:new Date().toISOString(),cancelReason:String(req.body.reason||'').trim()||null}},{transaction});
    await AuditLog.create({schoolCode:code(req),actorUserId:req.user.id,actorRole:req.user.role,module:'student_lifecycle',action:'class_transfer_cancelled',entityType:'ClassTransferRequest',entityId:String(request.id),reason:String(req.body.reason||'').trim()||null},{transaction});
    await transaction.commit();res.json({success:true,message:'Transfer request cancelled.',data:request});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
};

exports.rollbackTransfer=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    if(!['admin','super_admin'].includes(req.user.role)){await transaction.rollback();return res.status(403).json({success:false,message:'Administrator access only'});}
    const request=await enrollmentService.rollbackRequest({requestId:req.params.id,actor:req.user,reason:req.body.reason,transaction});
    await transaction.commit();res.json({success:true,message:'Class transfer rolled back. Enrollment history was preserved.',data:request});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
};

exports.applyDueTransfersSystem=async()=>{
  const requests=await ClassTransferRequest.findAll({where:{status:'scheduled',effectiveDate:{[Op.lte]:isoToday()}},attributes:['id'],order:[['effectiveDate','ASC'],['id','ASC']]});
  const results=[];
  for(const row of requests){
    const transaction=await sequelize.transaction();
    try{
      const full=await ClassTransferRequest.findByPk(row.id,{transaction,lock:transaction.LOCK.UPDATE});
      if(!full||full.status!=='scheduled'){await transaction.rollback();results.push({id:row.id,status:full?.status||'missing'});continue;}
      const applied=await enrollmentService.applyRequest({requestId:full.id,actorId:full.approvedBy||full.requestedBy,actorRole:'system',transaction});
      await transaction.commit();results.push({id:applied.id,status:applied.status});
    }catch(error){
      if(!transaction.finished)await transaction.rollback();
      const terminal=error?.code==='STALE_TRANSFER_REQUEST'||error?.code==='OPEN_CLASS_TRANSFER'||[404,409].includes(Number(error?.status));
      const current=await ClassTransferRequest.findByPk(row.id).catch(()=>null);
      if(current&&current.status==='scheduled')await current.update({status:terminal?'failed':'scheduled',version:Number(current.version||1)+1,metadata:{...(current.metadata||{}),schedulerFailed:terminal,schedulerRetryPending:!terminal,schedulerAttempts:Number(current.metadata?.schedulerAttempts||0)+1,lastSchedulerError:String(error.message||'Scheduled transfer failed').slice(0,500),lastSchedulerAttemptAt:new Date().toISOString()}}).catch(()=>null);
      console.error('[Class transfer scheduler]',row.id,error.message);
      results.push({id:row.id,status:terminal?'failed':'retry_scheduled',error:error.message});
    }
  }
  return results;
};

exports.transferOptions=async(req,res)=>{
  try{
    if(!['admin','super_admin','teacher'].includes(req.user.role))return res.status(403).json({success:false,message:'Forbidden'});
    const schoolCode=code(req);
    const activeClassWhere={schoolCode,[Op.or]:[{isActive:true},{isActive:null}]};
    let classes=await Class.findAll({where:activeClassWhere,attributes:['id','name','grade','stream','teacherId','curriculum','levelCode','isActive'],order:[['grade','ASC'],['name','ASC'],['stream','ASC']]});
    if(req.user.role==='teacher') classes=await schoolLinkageService.resolveTeacherAssignedClasses(req.user.id, schoolCode, { classTeacherOnly:true }).catch(()=>[]);
    const students=await schoolLinkageService.resolveClassStudents(classes, schoolCode, { userAttributes:['id','name','email','phone','profileImage','profilePicture'] });
    res.json({success:true,data:{classes,students}});
  }catch(error){fail(res,error);}
};

async function validateTransferOutPayload(req,{transaction,lock=false}={}){
  const schoolCode=code(req);
  const studentId=Number(req.body.studentId);
  const effectiveDate=String(req.body.effectiveDate||'').slice(0,10);
  const academicYear=Number(req.body.academicYear);
  const term=enrollmentService.normalizeTerm(req.body.term);
  const reason=String(req.body.reason||'').trim();
  const targetSchoolName=String(req.body.targetSchoolName||req.body.toSchoolName||'').trim();
  const targetClassName=String(req.body.targetClassName||req.body.toClassName||'').trim();
  if(!['admin','super_admin'].includes(String(req.user.role||'').toLowerCase()))throw Object.assign(new Error('Only administrators can transfer a learner to another school.'),{status:403});
  if(!studentId)throw Object.assign(new Error('Select the student being transferred.'),{status:400});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))throw Object.assign(new Error('Select a valid effective date.'),{status:400});
  if(!Number.isInteger(academicYear)||academicYear<2000||academicYear>2200)throw Object.assign(new Error('Select a valid academic year.'),{status:400});
  if(!term)throw Object.assign(new Error('Select Term 1, Term 2, or Term 3.'),{status:400});
  if(!reason)throw Object.assign(new Error('Transfer reason is required.'),{status:400});
  if(!targetSchoolName)throw Object.assign(new Error('Enter the receiving school name for an external transfer.'),{status:400});
  const student=await enrollmentService.findStudentInSchool({schoolCode,studentId,transaction,lock});
  if(!student)throw Object.assign(new Error('Student not found in this school.'),{status:404});
  if(student.status!=='active')throw Object.assign(new Error('Only an active learner can be transferred out.'),{status:409});
  const current=await enrollmentService.ensureCurrentEnrollment({student,schoolCode,academicYear,term,actorId:req.user.id,transaction});
  const fromClass=current.classId?await Class.findOne({where:{id:current.classId,schoolCode},transaction}):null;
  if(!fromClass)throw Object.assign(new Error('The learner has no current class to transfer from.'),{status:409});
  return {schoolCode,student,current,fromClass,effectiveDate,academicYear,term,reason,targetSchoolName,targetClassName,note:String(req.body.note||'').trim()||null};
}

exports.previewTransferOut=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    const data=await validateTransferOutPayload(req,{transaction});
    const impact=await enrollmentService.buildImpactPreview({schoolCode:data.schoolCode,student:data.student,currentEnrollment:data.current,effectiveDate:data.effectiveDate,academicYear:data.academicYear,term:data.term,transaction});
    await transaction.commit();
    res.json({success:true,data:{student:{id:data.student.id,name:data.student.User?.name,elimuid:data.student.elimuid},fromClass:enrollmentService.publicClass(data.fromClass),movementType:'transfer_out',targetSchoolName:data.targetSchoolName,targetClassName:data.targetClassName,effectiveDate:data.effectiveDate,academicYear:data.academicYear,term:data.term,reason:data.reason,impactPreview:impact,warnings:[impact.requiresAcknowledgement?'This transfer out touches existing attendance, marks, or a published report. Acknowledgement is required.':null].filter(Boolean)}});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
};

exports.createTransferOut=async(req,res)=>{
  const transaction=await sequelize.transaction();
  try{
    const data=await validateTransferOutPayload(req,{transaction,lock:true});
    const impact=await enrollmentService.buildImpactPreview({schoolCode:data.schoolCode,student:data.student,currentEnrollment:data.current,effectiveDate:data.effectiveDate,academicYear:data.academicYear,term:data.term,transaction});
    if(impact.requiresAcknowledgement&&req.body.acknowledgeHistoricalImpact!==true){await transaction.rollback();return res.status(409).json({success:false,code:'HISTORICAL_IMPACT_ACK_REQUIRED',message:'This transfer out affects existing records. Review the preview and acknowledge the historical impact.',data:{impactPreview:impact}});}
    await data.current.update({status:'closed',effectiveTo:enrollmentService.dayBefore(data.effectiveDate),endTerm:data.term,endedReason:'transfer_out',movementType:'transfer_out',movementReason:data.reason,closedBy:req.user.id,version:Number(data.current.version||1)+1,metadata:{...(data.current.metadata||{}),targetSchoolName:data.targetSchoolName,targetClassName:data.targetClassName,note:data.note}},{transaction,hooks:false});
    await data.student.update({status:'transferred',classId:null,activeEnrollmentId:null,grade:data.fromClass?.name||data.student.grade},{transaction,hooks:false});
    await AuditLog.create({schoolCode:data.schoolCode,actorUserId:req.user.id,actorRole:req.user.role,module:'student_lifecycle',action:'student_transfer_out',entityType:'Student',entityId:String(data.student.id),before:{classId:data.fromClass.id,status:'active'},after:{classId:null,status:'transferred',targetSchoolName:data.targetSchoolName,targetClassName:data.targetClassName},reason:data.reason,metadata:{effectiveDate:data.effectiveDate,term:data.term,academicYear:data.academicYear,note:data.note,impactPreview:impact}},{transaction});
    await transaction.commit();
    await realtime.emitToSchool(data.schoolCode,'student:transferred_out',{studentId:data.student.id,fromClassId:data.fromClass.id,targetSchoolName:data.targetSchoolName,effectiveDate:data.effectiveDate},{entityType:'Student',entityId:data.student.id,version:1}).catch(()=>null);
    res.json({success:true,message:`${data.student.User?.name||'Student'} transferred out from ${data.fromClass.name} to ${data.targetSchoolName}. Historical records remain preserved.`,data:{studentId:data.student.id,fromClass:enrollmentService.publicClass(data.fromClass),targetSchoolName:data.targetSchoolName,targetClassName:data.targetClassName,effectiveDate:data.effectiveDate,status:'transferred'}});
  }catch(error){if(!transaction.finished)await transaction.rollback();fail(res,error);}
};
