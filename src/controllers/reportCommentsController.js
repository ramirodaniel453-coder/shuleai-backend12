
const { Op } = require('sequelize');
const { ReportSnapshot, Student, User, Parent, StudentParent, Teacher, Class, AcademicRecord, AuditLog } = require('../models');
const schoolLinkageService = require('../services/schoolLinkageService');
const remarkService = require('../services/reportRemarkService');
const { callDeepSeekChat } = require('../services/aiProviderService');

function code(req){ return req.user?.schoolCode; }
function cleanText(value){ return String(value || '').trim(); }
function commentAssessmentKey(){ return 'report_comments'; }
async function studentInSchool(studentId, schoolCode){
  return (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ id:Number(studentId)||0 }, include:[{ model:User, required:true, where:{ schoolCode, role:'student' }, attributes:['id','name','schoolCode','profileImage','profilePicture'] }] });
}
async function canAccess(req, student, mode='read'){
  if (!student || student.User?.schoolCode !== code(req)) return false;
  if (['admin','super_admin'].includes(req.user.role)) return true;
  if (req.user.role === 'parent') {
    if (mode !== 'read') return false;
    const parent = await Parent.findOne({ where:{ userId:req.user.id } });
    return !!(parent && await StudentParent.findOne({ where:{ parentId:parent.id, studentId:student.id } }));
  }
  if (req.user.role === 'student') return mode === 'read' && Number(student.userId) === Number(req.user.id);
  if (req.user.role === 'teacher') {
    const classId = student.classId || null;
    if (!classId) return false;
    const assigned = await schoolLinkageService.resolveTeacherAssignedClasses(req.user.id, code(req), { classTeacherOnly: mode !== 'subject' }).catch(() => []);
    return assigned.some(cls => Number(cls.id) === Number(classId));
  }
  return false;
}
async function getDraft({ schoolCode, studentId, term, year }){
  return ReportSnapshot.findOne({ where:{ schoolCode, studentId:Number(studentId), term, year:Number(year), reportType:'academic', assessmentKey:commentAssessmentKey(), status:'draft', isCurrent:true }, order:[['updatedAt','DESC']] });
}
function emptyDraft({ student, term, year }){
  return { studentId:student.id, term, year:Number(year), subjectRemarks:{}, strengths:'', areasNeedingSupport:'', recommendation:'', classTeacherComment:'', headteacherComment:'', attendanceRemark:'', behaviourComment:'', coreValues:{}, promotionStatus:'', approvalStatus:'draft', approved:false, source:'manual' };
}
async function upsertDraft({ req, student, term, year, patch }){
  let row = await getDraft({ schoolCode:code(req), studentId:student.id, term, year });
  const previous = row?.snapshot || emptyDraft({ student, term, year });
  const next = { ...previous, ...patch, subjectRemarks:{ ...(previous.subjectRemarks||{}), ...(patch.subjectRemarks||{}) }, coreValues:{ ...(previous.coreValues||{}), ...(patch.coreValues||{}) }, updatedBy:req.user.id, updatedByRole:req.user.role, updatedAt:new Date().toISOString(), requiresHumanApproval: patch.requiresHumanApproval !== false };
  if (row) await row.update({ snapshot:next, metadata:{ ...(row.metadata||{}), commentDraft:true, updatedBy:req.user.id } });
  else row = await ReportSnapshot.create({ schoolCode:code(req), studentId:student.id, classId:student.classId || null, term, year:Number(year), curriculum:student.curriculum || null, reportType:'academic', assessmentKey:commentAssessmentKey(), status:'draft', generatedBy:req.user.id, snapshot:next, sourceRecordIds:[], metadata:{ commentDraft:true, createdBy:req.user.id }, version:1, isCurrent:true, formatVersion:'report-comments-current' });
  await AuditLog.create({ schoolCode:code(req), actorUserId:req.user.id, actorRole:req.user.role, module:'reports', action:'report_comments_saved', entityType:'ReportSnapshot', entityId:String(row.id), after:{ studentId:student.id, term, year:Number(year) } }).catch(()=>null);
  return row;
}
exports.getComments = async (req,res)=>{
  try{
    const { studentId, term='Term 1', year=new Date().getFullYear() } = req.query;
    if(!studentId) return res.status(400).json({ success:false, message:'studentId is required' });
    const student=await studentInSchool(studentId, code(req)); if(!student) return res.status(404).json({ success:false, message:'Student not found' });
    if(!(await canAccess(req, student, 'read'))) return res.status(403).json({ success:false, message:'You are not allowed to view report comments for this learner' });
    const row=await getDraft({ schoolCode:code(req), studentId:student.id, term, year });
    res.json({ success:true, data: row?.snapshot || emptyDraft({ student, term, year }) });
  }catch(error){ console.error('Get report comments error:', error); res.status(500).json({ success:false, message:error.message }); }
};
exports.saveComments = async (req,res)=>{
  try{
    const { studentId, term='Term 1', year=new Date().getFullYear(), subjectRemarks={}, ...rest } = req.body || {};
    if(!studentId) return res.status(400).json({ success:false, message:'studentId is required' });
    const student=await studentInSchool(studentId, code(req)); if(!student) return res.status(404).json({ success:false, message:'Student not found' });
    if(!(await canAccess(req, student, 'write'))) return res.status(403).json({ success:false, message:'Only the class teacher/admin can save overall report comments' });
    const patch={};
    ['strengths','areasNeedingSupport','recommendation','classTeacherComment','headteacherComment','attendanceRemark','behaviourComment','promotionStatus','approvalStatus'].forEach(k=>{ if(rest[k]!==undefined) patch[k]=cleanText(rest[k]); });
    if (subjectRemarks && typeof subjectRemarks === 'object') patch.subjectRemarks = Object.fromEntries(Object.entries(subjectRemarks).map(([k,v])=>[cleanText(k), cleanText(v)]).filter(([k])=>k));
    if (rest.coreValues && typeof rest.coreValues === 'object') patch.coreValues = rest.coreValues;
    const row=await upsertDraft({ req, student, term, year, patch });
    // Keep subject-level report remarks synchronized with unpublished AcademicRecords when possible.
    for (const [subject, remark] of Object.entries(patch.subjectRemarks || {})) {
      await AcademicRecord.update({ remarks: remark }, { where:{ schoolCode:code(req), studentId:student.id, term, year:Number(year), subject, isPublished:false, status:{ [Op.ne]:'locked' } } }).catch(()=>null);
    }
    res.json({ success:true, message:'Report comments saved for draft review.', data:row.snapshot });
  }catch(error){ console.error('Save report comments error:', error); res.status(500).json({ success:false, message:error.message }); }
};
exports.bulkSaveComments = async (req,res)=>{
  try{
    const items=Array.isArray(req.body?.items)?req.body.items:[];
    const results=[];
    for(const item of items){
      const fake={...req, body:item};
      let payload=null, status=200;
      await exports.saveComments(fake,{ status(c){status=c; return this;}, json(obj){payload=obj;} });
      results.push({ studentId:item.studentId, success:payload?.success && status<400, message:payload?.message, data:payload?.data });
    }
    res.json({ success:true, data:{ results } });
  }catch(error){ res.status(500).json({ success:false, message:error.message }); }
};
exports.generateComments = async (req,res)=>{
  try{
    const { studentId, term='Term 1', year=new Date().getFullYear(), subjects=[], average=0, attendanceRate=0, strengths='', areasNeedingSupport='' } = req.body || {};
    if(!studentId) return res.status(400).json({ success:false, message:'studentId is required' });
    const student=await studentInSchool(studentId, code(req)); if(!student) return res.status(404).json({ success:false, message:'Student not found' });
    if(!(await canAccess(req, student, 'write'))) return res.status(403).json({ success:false, message:'Only the class teacher/admin can generate draft report comments' });
    let generated=remarkService.generateReportRemarks({ studentName:student.User?.name||'The learner', subjects, average, attendanceRate, strengths, areasNeedingSupport });
    if (req.body?.useAI === true) {
      try {
        const result = await callDeepSeekChat({
          messages:[
            { role:'system', content:'You draft Kenyan school report-card remarks. Return only JSON with subjectRemarks object, strengths, areasNeedingSupport, recommendation, classTeacherComment, headteacherComment. Do not publish or approve; these are suggestions for a teacher/admin to review.' },
            { role:'user', content:JSON.stringify({ studentName:student.User?.name||'The learner', subjects, average, attendanceRate, strengths, areasNeedingSupport }, null, 2) }
          ],
          maxTokens:700,
          temperature:0.25,
          responseFormat:{ type:'json_object' }
        });
        const parsed = JSON.parse(result.text || '{}');
        generated = { ...generated, ...parsed, subjectRemarks:{ ...(generated.subjectRemarks||{}), ...(parsed.subjectRemarks||{}) }, source:'ai_generated_draft', provider:result.provider, model:result.model, requiresHumanApproval:true };
      } catch (aiError) {
        generated = { ...generated, aiFallback:true, source:'system_generated_rule_based', reason:'AI was unavailable, so free system-generated remarks were used.' };
      }
    }
    res.json({ success:true, data:generated, message:'Report comment suggestions created. Review/edit before saving or publishing.' });
  }catch(error){ res.status(500).json({ success:false, message:error.message }); }
};
exports.saveHeadteacherComment = async (req,res)=>{
  try{
    if(!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success:false, message:'Only admin/headteacher can save final headteacher comments' });
    const { studentId, term='Term 1', year=new Date().getFullYear(), headteacherComment='', promotionStatus='' } = req.body || {};
    const student=await studentInSchool(studentId, code(req)); if(!student) return res.status(404).json({ success:false, message:'Student not found' });
    const row=await upsertDraft({ req, student, term, year, patch:{ headteacherComment:cleanText(headteacherComment), promotionStatus:cleanText(promotionStatus), approvalStatus:'headteacher_reviewed' } });
    res.json({ success:true, data:row.snapshot, message:'Headteacher comment saved.' });
  }catch(error){ res.status(500).json({ success:false, message:error.message }); }
};
exports.mergeDraftCommentsIntoSnapshot = async function mergeDraftCommentsIntoSnapshot({ schoolCode, studentId, term, year, snapshot }){
  const row = await getDraft({ schoolCode, studentId, term, year }).catch(()=>null);
  const draft = row?.snapshot || {};
  const next = { ...(snapshot || {}) };
  next.comments = { ...(next.comments || {}), ...(draft || {}) };
  next.subjects = (next.subjects || []).map(sub => ({ ...sub, remark: draft.subjectRemarks?.[sub.subject] || sub.remark || sub.teacherRemark || sub.remarks || '', teacherRemark: draft.subjectRemarks?.[sub.subject] || sub.teacherRemark || sub.remark || '' }));
  next.teacherFeedback = { strengths:draft.strengths||'', areasNeedingSupport:draft.areasNeedingSupport||'', recommendation:draft.recommendation||'' };
  next.promotionStatus = draft.promotionStatus || next.promotionStatus || '';
  next.coreValues = draft.coreValues || next.coreValues || {};
  return next;
}
