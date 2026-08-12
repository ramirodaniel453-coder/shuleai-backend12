const express = require('express');
const { Op } = require('sequelize');
const { protect, authorize } = require('../middleware/auth');
const { User, Teacher, Student, Parent, Class, AcademicRecord, Attendance, School, Alert, Task, Payment, SchoolNameRequest, ApprovalRequest, AuditLog } = require('../models');
const paymentController = require('../controllers/paymentController');
const schoolLinkageService = require('../services/schoolLinkageService');

const router = express.Router();
router.use(protect);

function ok(res, data = null, message = 'OK') { return res.json({ success: true, message, data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, message }); }
function grade(score){ if(score == null) return null; const s=Number(score); if(s>=80) return 'EE'; if(s>=60) return 'ME'; if(s>=40) return 'AE'; return 'BE'; }
async function assertSchoolUser(user, schoolCode){ return user && (!schoolCode || user.schoolCode === schoolCode); }
async function teacherById(id, schoolCode){ return Teacher.findByPk(id, { include:[{ model:User, attributes:['id','name','email','phone','schoolCode','isActive','role'] }] }).then(t => t && t.User?.schoolCode === schoolCode ? t : null); }
async function studentById(id, schoolCode){ return Student.findByPk(id, { include:[{ model:User, attributes:['id','name','email','phone','schoolCode','isActive','role'] }] }).then(s => s && s.User?.schoolCode === schoolCode ? s : null); }

// Canonical payment, parent, and subscription routes are mounted before this
// compatibility router. Do not redeclare them here: duplicate signatures become
// unreachable and make route behavior depend on mount order.

// ============ ADMIN COMPLETION ROUTES ============
router.post('/admin/teachers/:teacherId/activate', authorize('admin','super_admin'), async (req,res)=>{ try{ const t=await teacherById(req.params.teacherId, req.user.schoolCode); if(!t) return fail(res,404,'Teacher not found'); await t.User.update({ isActive:true }); await t.update({ approvalStatus:'approved', approvedBy:req.user.id, approvedAt:new Date() }); return ok(res,t,'Teacher activated successfully'); }catch(e){ return fail(res,500,e.message); } });
router.post('/admin/teachers/:teacherId/reactivate', authorize('admin','super_admin'), async (req,res)=>{ try{ const t=await teacherById(req.params.teacherId, req.user.schoolCode); if(!t) return fail(res,404,'Teacher not found'); await t.User.update({ isActive:true }); await t.update({ approvalStatus:'approved' }); return ok(res,t,'Teacher reactivated successfully'); }catch(e){ return fail(res,500,e.message); } });
router.post('/admin/teachers/:teacherId/deactivate', authorize('admin','super_admin'), async (req,res)=>{ try{ const t=await teacherById(req.params.teacherId, req.user.schoolCode); if(!t) return fail(res,404,'Teacher not found'); await t.User.update({ isActive:false }); await t.update({ approvalStatus:'suspended', duties:{ ...(t.duties||{}), lastDeactivationReason:req.body?.reason||'Deactivated by admin', deactivatedAt:new Date() } }); return ok(res,t,'Teacher deactivated successfully'); }catch(e){ return fail(res,500,e.message); } });
router.post('/admin/teachers/:teacherId/suspend', authorize('admin','super_admin'), async (req,res)=>{ try{ const t=await teacherById(req.params.teacherId, req.user.schoolCode); if(!t) return fail(res,404,'Teacher not found'); await t.User.update({ isActive:false }); await t.update({ approvalStatus:'suspended', duties:{ ...(t.duties||{}), suspensionReason:req.body?.reason||'Suspended by admin', suspendedAt:new Date() } }); return ok(res,t,'Teacher suspended successfully'); }catch(e){ return fail(res,500,e.message); } });

router.post('/admin/students/:studentId/expel', authorize('admin','super_admin'), async (req,res)=>{ try{ const s=await studentById(req.params.studentId, req.user.schoolCode); if(!s) return fail(res,404,'Student not found'); await s.update({ status:'transferred', academicStatus:'critical', preferences:{ ...(s.preferences||{}), exitType:'expelled', exitReason:req.body?.reason||'Expelled by admin', exitedAt:new Date() } }); await s.User.update({ isActive:false }); return ok(res,s,'Student removed from active roll'); }catch(e){ return fail(res,500,e.message); } });

// ============ PARENT/STUDENT ACADEMIC COMPLETION ROUTES ============
async function parentCanAccess(parentUserId, studentId){ const parent=await Parent.findOne({ where:{ userId:parentUserId }, include:[{ model:Student, as:'students', where:{ id:studentId }, required:false }] }); return !!(parent && parent.students && parent.students.length); }
async function academicSummary(studentId, schoolCode){ const records=await AcademicRecord.findAll({ where:{ studentId, schoolCode, isPublished:true }, order:[['year','DESC'],['term','DESC'],['subject','ASC']] }); const bySubject={}; for(const r of records){ bySubject[r.subject]=bySubject[r.subject]||[]; bySubject[r.subject].push(r); } const subjects=Object.entries(bySubject).map(([subject, rows])=>{ const avg=Math.round(rows.reduce((a,b)=>a+Number(b.score||0),0)/(rows.length||1)); return { subject, average:avg, grade:grade(avg), records:rows }; }); const overall=subjects.length?Math.round(subjects.reduce((a,b)=>a+b.average,0)/subjects.length):null; return { records, subjects, overallAverage:overall, overallGrade:grade(overall) }; }
router.get('/parent/child/:studentId/marks', authorize('parent'), async (req,res)=>{ try{ if(!await parentCanAccess(req.user.id, req.params.studentId)) return fail(res,403,'You are not linked to this child'); return ok(res, await academicSummary(req.params.studentId, req.user.schoolCode)); }catch(e){ return fail(res,500,e.message); } });
router.get('/parent/child/:studentId/class-performance', authorize('parent'), async (req,res)=>{ try{ if(!await parentCanAccess(req.user.id, req.params.studentId)) return fail(res,403,'You are not linked to this child'); const target=await studentById(req.params.studentId, req.user.schoolCode); const peers=await Student.findAll({ where:{ grade:target.grade }, include:[{ model:User, where:{ schoolCode:req.user.schoolCode, role:'student' }}] }); const ids=peers.map(p=>p.id); const rows=await AcademicRecord.findAll({ where:{ studentId:{[Op.in]:ids}, schoolCode:req.user.schoolCode, isPublished:true }}); const averages=ids.map(id=>{ const rr=rows.filter(r=>r.studentId===id); return { studentId:id, average: rr.length?Math.round(rr.reduce((a,b)=>a+Number(b.score||0),0)/rr.length):0 }; }).sort((a,b)=>b.average-a.average); const rank=averages.findIndex(x=>Number(x.studentId)===Number(req.params.studentId))+1; return ok(res,{ classSize:ids.length, rank:rank||null, averages }); }catch(e){ return fail(res,500,e.message); } });
router.get('/parent/child/:studentId/subject-performance', authorize('parent'), async (req,res)=>{ try{ if(!await parentCanAccess(req.user.id, req.params.studentId)) return fail(res,403,'You are not linked to this child'); const summary=await academicSummary(req.params.studentId, req.user.schoolCode); return ok(res, summary.subjects); }catch(e){ return fail(res,500,e.message); } });

router.get('/student/marks/all', authorize('student'), async (req,res)=>{ try{ const student=await Student.findOne({ where:{ userId:req.user.id } }); if(!student) return fail(res,404,'Student profile not found'); return ok(res, await academicSummary(student.id, req.user.schoolCode)); }catch(e){ return fail(res,500,e.message); } });
router.get('/student/class-performance', authorize('student'), async (req,res)=>{ try{ const student=await Student.findOne({ where:{ userId:req.user.id } }); if(!student) return fail(res,404,'Student profile not found'); req.params.studentId=student.id; const peers=await Student.findAll({ where:{ grade:student.grade }, include:[{ model:User, where:{ schoolCode:req.user.schoolCode, role:'student' }}] }); const ids=peers.map(p=>p.id); const rows=await AcademicRecord.findAll({ where:{ studentId:{[Op.in]:ids}, schoolCode:req.user.schoolCode, isPublished:true }}); const averages=ids.map(id=>{ const rr=rows.filter(r=>r.studentId===id); return { studentId:id, average: rr.length?Math.round(rr.reduce((a,b)=>a+Number(b.score||0),0)/rr.length):0 }; }).sort((a,b)=>b.average-a.average); return ok(res,{ classSize:ids.length, rank:averages.findIndex(x=>Number(x.studentId)===Number(student.id))+1, averages }); }catch(e){ return fail(res,500,e.message); } });
router.get('/student/subject-performance', authorize('student'), async (req,res)=>{ try{ const student=await Student.findOne({ where:{ userId:req.user.id } }); if(!student) return fail(res,404,'Student profile not found'); const summary=await academicSummary(student.id, req.user.schoolCode); return ok(res, summary.subjects); }catch(e){ return fail(res,500,e.message); } });
router.get('/student/gpa', authorize('student'), async (req,res)=>{ try{ const student=await Student.findOne({ where:{ userId:req.user.id } }); if(!student) return fail(res,404,'Student profile not found'); const s=await academicSummary(student.id, req.user.schoolCode); const gpa=s.overallAverage==null?null:Number((s.overallAverage/20).toFixed(2)); return ok(res,{ gpa, overallAverage:s.overallAverage, grade:s.overallGrade }); }catch(e){ return fail(res,500,e.message); } });

// ============ SUPER ADMIN COMPLETION ROUTES ============
router.get('/super-admin/users', authorize('super_admin'), async (req,res)=>{ try{ const users=await User.findAll({ attributes:['id','name','email','phone','role','schoolCode','isActive','createdAt'], order:[['createdAt','DESC']], limit:1000 }); return ok(res,users); }catch(e){ return fail(res,500,e.message); } });
router.get('/super-admin/metrics', authorize('super_admin'), async (req,res)=>{ try{ const [schools,users,teachers,students,parents]=await Promise.all([School.count(),User.count(),Teacher.count(),Student.count(),Parent.count()]); return ok(res,{ schools, users, teachers, students, parents, uptime:process.uptime(), node:process.version, timestamp:new Date().toISOString() }); }catch(e){ return fail(res,500,e.message); } });
router.get('/super-admin/logs', authorize('super_admin'), async (req,res)=>{ try{ const alerts=await Alert.findAll({ order:[['createdAt','DESC']], limit:100 }); return ok(res, alerts.map(a=>({ id:a.id, type:a.type, title:a.title, role:a.role, createdAt:a.createdAt }))); }catch(e){ return fail(res,500,e.message); } });
router.get('/super-admin/schools/:schoolId/stats', authorize('super_admin'), async (req,res)=>{ try{ const schoolCode=req.params.schoolId; const [teachers,students,parents,classes,alerts]=await Promise.all([User.count({where:{schoolCode,role:'teacher'}}),User.count({where:{schoolCode,role:'student'}}),User.count({where:{schoolCode,role:'parent'}}),Class.count({where:{schoolCode}}),Alert.count({where:{schoolCode}}).catch(()=>0)]); return ok(res,{ schoolCode, teachers, students, parents, classes, alerts }); }catch(e){ return fail(res,500,e.message); } });
router.get('/super-admin/requests/history', authorize('super_admin'), async (req,res)=>{ try{
  const limit=Math.min(Math.max(Number(req.query.limit)||100,1),500);
  const [nameRequests,approvals,auditEvents]=await Promise.all([
    SchoolNameRequest.findAll({order:[['createdAt','DESC']],limit}),
    ApprovalRequest.findAll({order:[['createdAt','DESC']],limit}),
    AuditLog.findAll({where:{action:{[Op.in]:['school_approved','school_rejected','school_suspended','school_reactivated','name_change_approved','name_change_rejected']}},order:[['createdAt','DESC']],limit}).catch(()=>[])
  ]);
  const rows=[
    ...nameRequests.map(row=>({id:`name-${row.id}`,requestType:'school_name_change',status:row.status||'pending',schoolCode:row.schoolCode||null,requestedBy:row.requestedBy||null,reason:row.reason||null,data:row.toJSON(),createdAt:row.createdAt,updatedAt:row.updatedAt})),
    ...approvals.map(row=>({id:`approval-${row.id}`,requestType:row.role?`${row.role}_approval`:'approval',status:row.status||'pending',schoolCode:row.schoolId||null,requestedBy:row.userId||null,reason:row.rejectionReason||row.notes||null,data:row.toJSON(),createdAt:row.createdAt,updatedAt:row.updatedAt})),
    ...auditEvents.map(row=>({id:`audit-${row.id}`,requestType:row.action||'audit',status:row.metadata?.status||'completed',schoolCode:row.schoolCode||null,requestedBy:row.actorUserId||null,reason:row.metadata?.reason||null,data:row.toJSON(),createdAt:row.createdAt,updatedAt:row.updatedAt}))
  ].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,limit);
  return ok(res,rows,'Request history loaded');
}catch(e){ return fail(res,500,e.message); } });


// ============ V17 CURRICULUM + SCHOOL META ============
router.get('/school/curriculum', authorize('admin','teacher','parent','student','super_admin'), async (req,res)=>{ try{
  const school = await School.findOne({ where:{ schoolId:req.user.schoolCode } });
  const system = school?.system || 'cbc';
  const curriculumHelper = require('../utils/curriculumHelper');
  const schoolLevel = school?.settings?.schoolLevel || 'secondary';
  return ok(res, { schoolCode:req.user.schoolCode, curriculum:system, system, schoolLevel, gradingScale: curriculumHelper.CURRICULUMS[system]?.[schoolLevel === 'both' ? 'secondary' : schoolLevel] || curriculumHelper.CURRICULUMS[system]?.secondary || [], subjects: curriculumHelper.getSubjectsForCurriculum(system, schoolLevel), schoolName: school?.name || null }, 'School curriculum loaded');
} catch(e){ return fail(res,500,e.message); } });

// Real teacher student actions used by student detail modal
router.post('/teacher/students/:studentId/report-absence', authorize('teacher'), async (req,res)=>{ try{
  const teacher = await Teacher.findOne({ where:{ userId:req.user.id } }); if(!teacher) return fail(res,404,'Teacher profile not found');
  const student = await studentById(req.params.studentId, req.user.schoolCode); if(!student) return fail(res,404,'Student not found');
  const today = new Date().toISOString().slice(0,10);
  const [row, created] = await Attendance.findOrCreate({ where:{ studentId:student.id, date:today }, defaults:{ studentId:student.id, schoolCode:req.user.schoolCode, date:today, status:'absent', markedBy:req.user.id, remarks:req.body?.reason || 'Marked absent by teacher' } });
  if(!created) await row.update({ status:'absent', markedBy:req.user.id, remarks:req.body?.reason || row.remarks || 'Marked absent by teacher' });
  return ok(res,row,'Absence recorded for today');
} catch(e){ return fail(res,500,e.message); } });

router.get('/teacher/students/:studentId/parent-contact', authorize('teacher'), async (req,res)=>{ try{
  const student = await studentById(req.params.studentId, req.user.schoolCode); if(!student) return fail(res,404,'Student not found');
  let parent = null;
  if (student.parentEmail) parent = await User.findOne({ where:{ email:student.parentEmail, schoolCode:req.user.schoolCode, role:'parent' } });
  if (!parent && student.parentPhone) parent = await User.findOne({ where:{ phone:student.parentPhone, schoolCode:req.user.schoolCode, role:'parent' } });
  if (!parent) {
    const linked = await Parent.findOne({ include:[{ model:Student, as:'students', where:{ id:student.id }, required:true }, { model:User, attributes:['id','name','email','phone','role','schoolCode'] }] }).catch(()=>null);
    parent = linked?.User || null;
  }
  if(!parent) return fail(res,404,'No linked parent account/contact found for this student');
  return ok(res,{ parentId:parent.id, name:parent.name, email:parent.email, phone:parent.phone, studentId:student.id }, 'Parent contact loaded');
} catch(e){ return fail(res,500,e.message); } });

module.exports = router;
