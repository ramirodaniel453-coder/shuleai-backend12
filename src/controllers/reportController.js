const { Op } = require('sequelize');
const {
  AcademicRecord, ReportSnapshot, Student, User, AuditLog,
  School, Class, Parent, StudentParent, Teacher, Attendance, TeacherSubjectAssignment
} = require('../models');
const curriculumEngine = require('../services/curriculumStructureEngine');
const selectionsService = require('../services/studentSubjectSelectionService');
const snapshotService = require('../services/reportSnapshotService');
const schoolLinkageService = require('../services/schoolLinkageService');
const { getGradeFromScore } = require('../services/gradingEngine');
const reportComments = require('./reportCommentsController');

function schoolCode(req) { return req.user?.schoolCode; }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function gradingLevel(cls, school) { return cls?.levelCode || cls?.grade || cls?.name || school?.settings?.schoolLevel || school?.schoolStructure || 'primary'; }
function gradeFor(score, school, cls) {
  if (score === null || score === undefined) return null;
  return getGradeFromScore(Number(score), school?.system || 'cbc', gradingLevel(cls, school), school?.settings?.gradingScale || null);
}

function defaultReportLogo() { return '/assets/logo.png'; }
function logoForSchool(school) { return school?.settings?.branding?.logoDataUrl || school?.settings?.branding?.logoUrl || school?.settings?.branding?.logo || school?.settings?.logo || school?.reportCardSettings?.logo || defaultReportLogo(); }
function reportAssessmentSettings(school) { const raw = school?.settings?.curriculumEngine?.assessmentSettings || school?.settings?.reportCardSettings?.assessmentSettings || school?.reportCardSettings?.assessmentSettings || []; const base = Array.isArray(raw) && raw.length ? raw : [{key:'opener',label:'Opener Exam',assessmentType:'Opener',type:'Opener',showOnReport:true,countInFinal:false,weight:0,displayOrder:1},{key:'cat1',label:'CAT 1',assessmentType:'CAT 1',type:'CAT',showOnReport:true,countInFinal:true,weight:10,displayOrder:2},{key:'cat2',label:'CAT 2',assessmentType:'CAT 2',type:'CAT',showOnReport:true,countInFinal:true,weight:10,displayOrder:3},{key:'midterm',label:'Midterm',assessmentType:'Midterm',type:'Midterm',showOnReport:true,countInFinal:true,weight:20,displayOrder:4},{key:'endterm',label:'End Term',assessmentType:'End Term',type:'EndTerm',showOnReport:true,countInFinal:true,weight:50,displayOrder:5},{key:'sba',label:'SBA / Project',assessmentType:'SBA',type:'SBA',showOnReport:true,countInFinal:true,weight:10,displayOrder:6}]; return base.filter(x=>x && x.isActive !== false).map((x,i)=>{ const key=String(x.key||x.assessmentKey||x.name||x.label||x.assessmentType||`assessment_${i+1}`).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); return { ...x, key, assessmentKey:key, label:x.label||x.displayName||x.name||x.assessmentType||`Assessment ${i+1}`, assessmentType:x.assessmentType||x.type||x.label||'Custom', weight:Number(x.weight ?? x.weightPercent ?? 0), displayOrder:Number(x.displayOrder||i+1) }; }); }
function normAssess(x){return String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,'');}
function recordMatchesAssessment(record, setting){ if (record.assessmentKey && setting.assessmentKey && normAssess(record.assessmentKey) === normAssess(setting.assessmentKey)) return true; if (record.assessmentKey && setting.key && normAssess(record.assessmentKey) === normAssess(setting.key)) return true; const keys=[record.assessmentType,record.assessmentName,record.assessmentCategory,record.testType,record.examType,record.type].map(normAssess); return keys.includes(normAssess(setting.assessmentType))||keys.includes(normAssess(setting.label))||keys.includes(normAssess(setting.key)); }

function scoreFromAssessmentRecord(record) {
  if (!record) return null;
  const raw = record.score ?? record.marks ?? record.mark ?? record.value ?? record.percentage;
  return numberOrNull(raw);
}
function normalizedAssessmentScore(score, maxScore = 100) {
  const value = numberOrNull(score);
  if (value === null) return null;
  const max = Number(maxScore || 100);
  if (Number.isFinite(max) && max > 0 && max !== 100) return Math.round((value / max) * 1000) / 10;
  return value;
}
function assessmentComponent(records, setting) {
  const record = (records || []).find(row => recordMatchesAssessment(row, setting));
  const score = scoreFromAssessmentRecord(record);
  return {
    key: setting.key || setting.assessmentKey,
    assessmentKey: setting.assessmentKey || setting.key,
    label: setting.label || setting.assessmentType || 'Assessment',
    assessmentType: setting.assessmentType || setting.type || setting.label || 'Custom',
    score,
    rawScore: score,
    maxScore: Number(setting.maxScore || 100),
    weight: Number(setting.weight || setting.weightPercent || 0),
    countInFinal: setting.countInFinal !== false,
    showOnReport: setting.showOnReport !== false,
    status: score === null ? 'Not assessed' : 'Completed',
    recordId: record?.id || null,
    date: record?.date || record?.createdAt || null
  };
}
function weightedSubjectAverage(components = []) {
  const counted = components.filter(item => item.countInFinal !== false && item.score !== null && item.score !== undefined);
  if (!counted.length) return null;
  const weighted = counted.filter(item => Number(item.weight) > 0);
  if (weighted.length) {
    const weightTotal = weighted.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    if (weightTotal > 0) return Math.round(weighted.reduce((sum, item) => sum + normalizedAssessmentScore(item.score, item.maxScore) * Number(item.weight || 0), 0) / weightTotal);
  }
  return Math.round(counted.reduce((sum, item) => sum + normalizedAssessmentScore(item.score, item.maxScore), 0) / counted.length);
}
function normalizeReportSubjectRows(rows = [], assessmentSettings = [], school, cls) {
  return rows.map(row => {
    const statusText = String(row.status || '').toLowerCase();
    const excluded = ['not taken', 'exempted', 'not offered'].includes(statusText);
    const sourceRecords = Array.isArray(row.assessments) ? row.assessments : [];
    const components = assessmentSettings.map(setting => assessmentComponent(sourceRecords, setting));
    const average = excluded ? null : weightedSubjectAverage(components);
    const status = excluded ? row.status : (average === null ? 'Pending' : 'Completed');
    const counted = !excluded && average !== null && row.counted !== false;
    return {
      ...row,
      score: average,
      average,
      grade: average === null ? null : gradeFor(average, school, cls),
      status,
      counted,
      components,
      assessments: components,
      calculationRule: counted ? 'Counted assessments only' : (excluded ? status : 'Not assessed')
    };
  });
}

const REPORT_RECORD_ASSESSMENT_ENUMS = new Set(['test','exam','assignment','project','quiz']);
function enumReportAssessmentType(value){const raw=String(value||'').trim().toLowerCase().replace(/[\s-]+/g,'_');return REPORT_RECORD_ASSESSMENT_ENUMS.has(raw)?raw:null;}
function recordMatchesRequestedAssessment(record, requested){
  const wanted=normAssess(requested);
  if(!wanted) return true;
  const keys=[record.assessmentType,record.assessmentName,record.testType,record.examType,record.type].map(normAssess);
  if(keys.includes(wanted)) return true;
  const aliases={cat:['cat','cat1','cat2','continuousassessment','continuousassessmenttest'],midterm:['midterm','midtermexam'],endterm:['endterm','endtermexam','finalexam','exam'],sba:['sba','schoolbasedassessment'],project:['project','sbaproject'],practical:['practical','practicalassessment']};
  const accepted=aliases[wanted]||[];
  return keys.some(k=>accepted.includes(k) || k.includes(wanted));
}


async function studentForUser(userId) {
  return (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ userId } });
}

async function teacherOwnsClass(req, classId) {
  const teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
  if (!teacher || !classId) return false;
  if (Number(teacher.classId) === Number(classId)) return true;
  const classes = await schoolLinkageService.resolveTeacherAssignedClasses(req.user.id, schoolCode(req), { classTeacherOnly:true }).catch(()=>[]);
  return classes.some(cls => Number(cls.id) === Number(classId));
}

async function canRead(req, report) {
  if (!report || String(report.schoolCode) !== String(schoolCode(req))) return false;
  if (['admin','super_admin'].includes(req.user.role)) return true;
  if (req.user.role === 'student') return Number((await studentForUser(req.user.id))?.id) === Number(report.studentId);
  if (req.user.role === 'parent') {
    const parent = await Parent.findOne({ where:{ userId:req.user.id } });
    return Boolean(parent && await StudentParent.findOne({ where:{ parentId:parent.id, studentId:report.studentId } }));
  }
  if (req.user.role === 'teacher') return teacherOwnsClass(req, report.classId);
  return false;
}

async function buildSnapshot({ studentId, schoolCode:code, term, year, assessmentType, assessmentName }) {
  const student = await (Student.unscoped ? Student.unscoped() : Student).findOne({
    where:{ id:Number(studentId) },
    include:[{ model:User, required:true, where:{ schoolCode:code, role:'student' }, attributes:['id','name','email','schoolCode','profileImage'] }]
  });
  if (!student) { const error = new Error('Student not found'); error.status = 404; throw error; }
  const school = await School.findOne({ where:{ schoolId:code } });
  const cls = await schoolLinkageService.resolveStudentClass(student, code) || (student.classId
    ? await Class.findOne({ where:{ id:student.classId, schoolCode:code } })
    : await Class.findOne({ where:{ schoolCode:code, [Op.or]:[{ name:student.grade }, { grade:student.grade }] } }));
  const where = { studentId:student.id, schoolCode:code, term, year:Number(year) };
  if (assessmentType) { const safeType = enumReportAssessmentType(assessmentType); if (safeType) where.assessmentType = safeType; }
  if (assessmentName) where.assessmentName = assessmentName;
  let records = await AcademicRecord.unscoped().findAll({ where, order:[['subject','ASC'],['assessmentName','ASC'],['date','ASC']] });
  const assessmentSettings = reportAssessmentSettings(school).filter(x => x.showOnReport !== false).sort((a,b)=>Number(a.displayOrder||0)-Number(b.displayOrder||0));
  const countedSettings = assessmentSettings.filter(x => x.countInFinal !== false);
  if (assessmentType) records = records.filter(record => recordMatchesRequestedAssessment(record, assessmentType));
  if (!assessmentType && !assessmentName && assessmentSettings.length) {
    records = records.filter(record => assessmentSettings.some(setting => recordMatchesAssessment(record, setting)));
  }
  const selections = cls ? await selectionsService.listStudentSubjectSelections({ schoolCode:code, studentId:student.id, classId:cls.id }).catch(() => []) : [];
  const reportRows = school && cls ? curriculumEngine.buildSubjectRowsForReport({ school, classItem:cls, student, records, studentSubjectSelections:selections }) : [];
  const grouped = new Map();
  records.forEach(record => { const raw=record.toJSON ? record.toJSON() : record; if(!grouped.has(raw.subject))grouped.set(raw.subject,[]);grouped.get(raw.subject).push(raw); });
  const fallbackSubjects = [...grouped].map(([subject,rows]) => ({ subject, status:'Pending', counted:true, assessments:rows }));
  const subjects = normalizeReportSubjectRows(reportRows.length ? reportRows : fallbackSubjects, assessmentSettings, school, cls);
  const summary = curriculumEngine.summarizeReportRows(subjects);
  const overallAverage = summary.average;
  const attendanceRows = await Attendance.findAll({ where:{ schoolCode:code, studentId:student.id }, attributes:['status'] }).catch(()=>[]);
  const attendance = { present:0, absent:0, late:0, total:attendanceRows.length, rate:0 };
  attendanceRows.forEach(row => { if(Object.prototype.hasOwnProperty.call(attendance,row.status))attendance[row.status]++; });
  attendance.rate = attendance.total ? Math.round((attendance.present / attendance.total) * 1000) / 10 : 0;
  let snapshot = {
    student:{ id:student.id, userId:student.userId, name:student.User?.name, photo:student.User?.profileImage || student.profileImage || null, dateOfBirth:student.dateOfBirth, elimuid:student.elimuid, grade:student.grade, className:cls?.name || student.grade },
    school:{ name:school?.name || 'School', logo:logoForSchool(school), watermarkLogo:logoForSchool(school), branding:school?.settings?.branding || {}, reportCardSettings: school?.settings?.reportCardSettings || school?.reportCardSettings || {}, usesFallbackLogo:!logoForSchool(school) || logoForSchool(school) === defaultReportLogo() },
    class:cls ? { id:cls.id, name:cls.name, grade:cls.grade, stream:cls.stream, levelCode:cls.levelCode } : null,
    term, year:Number(year), curriculum:school?.system || student.curriculum || null,
    assessmentType:assessmentType || null, assessmentName:assessmentName || null, assessmentSettings, countedAssessments:countedSettings,
    subjects, totalMarks:summary?.totalMarks ?? subjects.filter(row=>row.counted&&row.average!==null).reduce((sum,row)=>sum+Number(row.average),0),
    countedSubjects:summary?.countedSubjects ?? subjects.filter(row=>row.counted&&row.average!==null).length,
    pendingSubjects:summary?.pendingSubjects ?? subjects.filter(row=>row.average===null&&row.status!=='Not Taken').length,
    notTakenSubjects:summary?.notTakenSubjects ?? subjects.filter(row=>row.counted===false).length,
    overallAverage, overallGrade:gradeFor(overallAverage,school,cls), attendance,
    generatedAt:new Date().toISOString(),
    calculationRule:'Only valid completed subjects the learner is taking are counted. Pending, exempted and Not Taken subjects remain visible but are excluded from the mean.'
  };
  snapshot = await reportComments.mergeDraftCommentsIntoSnapshot({ schoolCode: code, studentId: student.id, term, year:Number(year), snapshot }).catch(() => snapshot);
  return { student, school, cls, records, snapshot };
}

exports.generateReport = async (req,res) => {
  try {
    const { studentId, term='Term 1', year=new Date().getFullYear(), publish=false, assessmentType=null, assessmentName=null } = req.body;
    if (!studentId) return res.status(400).json({ success:false, message:'studentId is required' });
    const built = await buildSnapshot({ studentId, schoolCode:schoolCode(req), term, year, assessmentType, assessmentName });
    if (req.user.role === 'teacher' && !(await teacherOwnsClass(req,built.cls?.id))) return res.status(403).json({ success:false, message:'Only the assigned class teacher can generate or publish this report card' });
    if (!publish) return res.json({ success:true, message:'Draft preview generated. It is visible only to authorised school staff until publication.', data:{ status:'draft', snapshot:built.snapshot } });
    const result = await snapshotService.createPublishedVersion({
      schoolCode:schoolCode(req), studentId:Number(studentId), classId:built.cls?.id || null,
      term, year:Number(year), curriculum:built.snapshot.curriculum, reportType:'academic',
      assessmentType, assessmentName, snapshot:built.snapshot, sourceRecordIds:built.records.map(record=>record.id),
      generatedBy:req.user.id, publishedBy:req.user.id, publishedAt:new Date(),
      metadata:{ engine:'v1506_dynamic_assessment_report_card', assessmentSettings:built.snapshot.assessmentSettings, countedAssessments:built.snapshot.countedAssessments }
    });
    await AuditLog.create({ schoolCode:schoolCode(req), actorUserId:req.user.id, actorRole:req.user.role, module:'reports', action:'report_published', entityType:'ReportSnapshot', entityId:String(result.row.id), after:{ version:result.row.version, studentId:Number(studentId), term, year:Number(year) } }).catch(()=>null);
    res.status(result.created?201:200).json({ success:true, message:result.unchanged?'The identical published report already exists.':'Report card published as an immutable historical version.', data:result.row });
  } catch (error) { res.status(error.status||500).json({ success:false, message:error.message }); }
};

exports.listReports = async (req,res) => {
  try {
    const where={ schoolCode:schoolCode(req), status:{ [Op.in]:['published','archived'] } };
    if(req.query.studentId)where.studentId=Number(req.query.studentId);if(req.query.term)where.term=req.query.term;if(req.query.year)where.year=Number(req.query.year);
    if(req.user.role==='student')where.studentId=(await studentForUser(req.user.id))?.id||-1;
    if(req.user.role==='parent'){const parent=await Parent.findOne({where:{userId:req.user.id}});const links=parent?await StudentParent.findAll({where:{parentId:parent.id}}):[];where.studentId={ [Op.in]:links.map(link=>link.studentId) };}
    if(req.user.role==='teacher'){const classes=await schoolLinkageService.resolveTeacherAssignedClasses(req.user.id,schoolCode(req),{classTeacherOnly:true}).catch(()=>[]);where.classId={ [Op.in]:classes.map(cls=>cls.id) };}
    const rows=await ReportSnapshot.findAll({where,order:[['year','DESC'],['term','DESC'],['version','DESC']],limit:500,attributes:{exclude:['sourceRecordIds']}});
    res.json({success:true,data:rows});
  } catch(error){res.status(500).json({success:false,message:error.message});}
};

exports.getReport = async (req,res) => {
  try { const row=await ReportSnapshot.findOne({where:{id:Number(req.params.id),schoolCode:schoolCode(req)}});if(!(await canRead(req,row)))return res.status(403).json({success:false,message:'You are not allowed to view this report card'});res.json({success:true,data:row}); }
  catch(error){res.status(500).json({success:false,message:error.message});}
};

// Worker-only exports keep the same canonical report calculation used by the API.
// They are not HTTP routes and do not bypass role/tenant checks in the worker.
exports.buildSnapshotForWorker = buildSnapshot;
exports.teacherOwnsClassForWorker = teacherOwnsClass;
