const { Op } = require('sequelize');
const {
  sequelize, AttendanceSession, AttendanceCorrection, Attendance, Class, Student,
  User, Teacher, Parent, StudentParent, ClassRelease, AuditLog
} = require('../models');
const realtime = require('../services/realtimeService');
const { createAlert } = require('../services/notificationService');

const VALID_STATUSES = new Set(['present','absent','late','holiday','sick']);
const RELEASE_TYPES = new Set(['normal','early','delayed','transport_delayed','custom']);

function schoolCode(req) { return req.user?.schoolCode; }
function todayInTimezone(timeZone = 'Africa/Nairobi') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}

async function getClass(req, classId, transaction = null) {
  return Class.findOne({ where:{ id:Number(classId), schoolCode:schoolCode(req), isActive:true }, transaction });
}

async function classStudents(req, cls, transaction = null) {
  const scoped = Student.unscoped ? Student.unscoped() : Student;
  return scoped.findAll({
    where:{
      status:'active',
      [Op.or]:[
        { classId:cls.id },
        { [Op.and]:[{ classId:null }, { grade:cls.name }] }
      ]
    },
    include:[{ model:User, where:{ schoolCode:schoolCode(req), role:'student', isActive:true }, attributes:['id','name','profileImage'] }],
    order:[[User,'name','ASC']],
    transaction
  });
}

async function teacherCanManageClass(req, cls) {
  if (['admin','super_admin'].includes(req.user.role)) return true;
  if (req.user.role !== 'teacher') return false;
  const teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
  if (!teacher) return false;
  return Number(teacher.classId) === Number(cls.id) || Number(cls.teacherId) === Number(teacher.id) || String(teacher.classTeacher || '').trim().toLowerCase() === String(cls.name || '').trim().toLowerCase();
}

async function requireManageClass(req, res, classId, transaction = null) {
  const cls = await getClass(req, classId, transaction);
  if (!cls) { res.status(404).json({ success:false, message:'Class not found' }); return null; }
  if (!(await teacherCanManageClass(req, cls))) { res.status(403).json({ success:false, message:'Only the assigned class teacher or school admin can manage this attendance session' }); return null; }
  return cls;
}

async function presentSession(session, req) {
  const cls = await getClass(req, session.classId);
  const students = cls ? await classStudents(req, cls) : [];
  const rows=await Attendance.findAll({where:{sessionId:session.id,schoolCode:schoolCode(req)},order:[['studentId','ASC']]});const latestRelease=await ClassRelease.findOne({where:{schoolCode:schoolCode(req),classId:session.classId,date:session.date},order:[['updateNumber','DESC'],['createdAt','DESC']]});
  const rowMap = new Map(rows.map(row => [Number(row.studentId), row.toJSON()]));
  return {
    ...session.toJSON(),
    class:cls?{id:cls.id,name:cls.name,grade:cls.grade,stream:cls.stream}:null,latestRelease:latestRelease?latestRelease.toJSON():null,
    students: students.map(st => ({
      id:st.id,
      userId:st.userId,
      name:st.User?.name || 'Student',
      elimuid:st.elimuid,
      admissionNumber:st.admissionNumber,
      attendance:rowMap.get(Number(st.id)) || null
    })),
    counts: rows.reduce((acc,row) => { acc[row.status] = (acc[row.status] || 0) + 1; acc.total += 1; return acc; }, { total:0, present:0, absent:0, late:0, sick:0, holiday:0 })
  };
}

exports.getOrCreateSession = async (req, res) => {
  try {
    const classId = Number(req.params.classId || req.body.classId);
    const date = String(req.params.date || req.body.date || todayInTimezone()).slice(0,10);
    const cls = await requireManageClass(req, res, classId);
    if (!cls) return;
    const [session] = await AttendanceSession.findOrCreate({
      where:{ schoolCode:schoolCode(req), classId, date },
      defaults:{ schoolCode:schoolCode(req), classId, date, status:'not_started', startedBy:req.user.id, timezone:req.body.timezone || 'Africa/Nairobi', metadata:{} }
    });
    res.json({ success:true, data:await presentSession(session, req) });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.saveDraft = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const session = await AttendanceSession.findOne({ where:{ id:Number(req.params.sessionId), schoolCode:schoolCode(req) }, transaction, lock:transaction.LOCK.UPDATE });
    if (!session) { await transaction.rollback(); return res.status(404).json({ success:false, message:'Attendance session not found' }); }
    const cls = await requireManageClass(req, res, session.classId, transaction);
    if (!cls) { await transaction.rollback(); return; }
    if (session.status === 'locked' || session.lockedAt) { await transaction.rollback(); return res.status(409).json({ success:false, message:'Attendance is locked for this date. An authorised admin correction is required.' }); }

    const students = await classStudents(req, cls, transaction);
    const allowed = new Set(students.map(st => Number(st.id)));
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    if (!records.length) { await transaction.rollback(); return res.status(400).json({ success:false, message:'At least one attendance record is required' }); }

    const saved = [];
    for (const input of records) {
      const studentId = Number(input.studentId);
      const status = String(input.status || '').toLowerCase();
      if (!allowed.has(studentId)) throw new Error(`Student ${studentId} is not active in ${cls.name}`);
      if (!VALID_STATUSES.has(status)) throw new Error(`Invalid attendance status for student ${studentId}`);
      let row = await Attendance.findOne({ where:{ schoolCode:schoolCode(req), studentId, date:session.date }, transaction, lock:transaction.LOCK.UPDATE });
      if (row?.lockedAt) throw new Error(`Attendance for student ${studentId} is locked`);
      const values = { schoolCode:schoolCode(req), studentId, classId:cls.id, sessionId:session.id, date:session.date, status, reason:input.reason || null, timeIn:input.timeIn || null, timeOut:input.timeOut || null, markedBy:req.user.id, reportedBy:req.user.id, version:Number(row?.version || 0) + 1 };
      if (row) await row.update(values, { transaction, hooks:false });
      else row = await Attendance.create(values, { transaction, hooks:false });
      saved.push(row.toJSON());
    }

    session.status = 'draft';
    session.startedBy = session.startedBy || req.user.id;
    session.version = Number(session.version || 1) + 1;
    session.metadata = { ...(session.metadata || {}), lastSavedBy:req.user.id, lastSavedAt:new Date().toISOString(), recordCount:saved.length };
    await session.save({ transaction, hooks:false });
    await realtime.emitToClass(schoolCode(req), cls.id, 'attendance:draft_updated', { sessionId:session.id, classId:cls.id, date:session.date, changedStudentIds:saved.map(x=>x.studentId) }, { transaction, entityType:'AttendanceSession', entityId:session.id, version:session.version });
    await transaction.commit();
    res.json({ success:true, message:'Attendance draft saved. It remains editable until Submit and Lock Attendance.', data:await presentSession(session, req) });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    res.status(400).json({ success:false, message:error.message });
  }
};

exports.lockSession = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const session = await AttendanceSession.findOne({ where:{ id:Number(req.params.sessionId), schoolCode:schoolCode(req) }, transaction, lock:transaction.LOCK.UPDATE });
    if (!session) { await transaction.rollback(); return res.status(404).json({ success:false, message:'Attendance session not found' }); }
    const cls = await requireManageClass(req, res, session.classId, transaction);
    if (!cls) { await transaction.rollback(); return; }
    if (session.status === 'locked') { await transaction.rollback(); return res.status(409).json({ success:false, message:'Attendance is already locked for this class and date' }); }

    const students = await classStudents(req, cls, transaction);
    const rows = await Attendance.findAll({ where:{ sessionId:session.id, schoolCode:schoolCode(req) }, transaction });
    const recorded = new Set(rows.map(row => Number(row.studentId)));
    const missing = students.filter(st => !recorded.has(Number(st.id)));
    if (missing.length) {
      await transaction.rollback();
      return res.status(409).json({ success:false, message:`Attendance cannot be locked. ${missing.length} active learner(s) are still unmarked.`, data:{ missingStudents:missing.map(st=>({ id:st.id, name:st.User?.name || 'Student' })) } });
    }

    const now = new Date();
    await Attendance.update({ lockedAt:now }, { where:{ sessionId:session.id }, transaction, hooks:false });
    await session.update({ status:'locked', submittedBy:req.user.id, submittedAt:now, lockedAt:now, version:Number(session.version || 1) + 1 }, { transaction, hooks:false });
    await AuditLog?.create({ schoolCode:schoolCode(req), actorUserId:req.user.id, actorRole:req.user.role, module:'attendance', action:'attendance_locked', entityType:'AttendanceSession', entityId:String(session.id), after:{ classId:cls.id, date:session.date, records:rows.length } }, { transaction });
    await realtime.emit({ type:'attendance:locked', schoolCode:schoolCode(req), audience:{ school:false, classIds:[cls.id], studentIds:students.map(st=>st.id), roles:['admin'] }, entityType:'AttendanceSession', entityId:session.id, version:session.version, data:{ sessionId:session.id, classId:cls.id, className:cls.name, date:session.date, lockedAt:now, recordCount:rows.length }, transaction });
    await realtime.emitToSchool(schoolCode(req), 'analytics:invalidated', { scope:'attendance', classId:cls.id, date:session.date }, { transaction, entityType:'AttendanceSession', entityId:session.id, version:session.version });
    await transaction.commit();
    res.json({ success:true, message:'Final attendance submitted and locked. Further changes require an audited admin correction.', data:await presentSession(session, req) });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    res.status(500).json({ success:false, message:error.message });
  }
};

exports.correctAttendance = async (req, res) => {
  if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success:false, message:'Only an authorised school admin can correct locked attendance' });
  const transaction = await sequelize.transaction();
  try {
    const session = await AttendanceSession.findOne({ where:{ id:Number(req.params.sessionId), schoolCode:schoolCode(req), status:'locked' }, transaction, lock:transaction.LOCK.UPDATE });
    if (!session) { await transaction.rollback(); return res.status(404).json({ success:false, message:'Locked attendance session not found' }); }
    const attendance = await Attendance.findOne({ where:{ id:Number(req.body.attendanceId), sessionId:session.id, schoolCode:schoolCode(req) }, transaction, lock:transaction.LOCK.UPDATE });
    if (!attendance) { await transaction.rollback(); return res.status(404).json({ success:false, message:'Attendance record not found' }); }
    const newStatus = String(req.body.newStatus || '').toLowerCase();
    const reason = String(req.body.reason || '').trim();
    if (!VALID_STATUSES.has(newStatus)) { await transaction.rollback(); return res.status(400).json({ success:false, message:'A valid new attendance status is required' }); }
    if (!reason) { await transaction.rollback(); return res.status(400).json({ success:false, message:'Reason for correction is required' }); }
    if (newStatus === attendance.status) { await transaction.rollback(); return res.status(400).json({ success:false, message:'The new value must differ from the original value' }); }

    const previousStatus = attendance.status;
    const correction = await AttendanceCorrection.create({ schoolCode:schoolCode(req), sessionId:session.id, attendanceId:attendance.id, studentId:attendance.studentId, previousStatus, newStatus, reason, note:req.body.note || null, correctedBy:req.user.id, correctedAt:new Date(), metadata:{ originalVersion:attendance.version || 1 } }, { transaction });
    const auditTrail = Array.isArray(attendance.auditTrail) ? attendance.auditTrail : [];
    await attendance.update({ status:newStatus, editedBy:req.user.id, editReason:reason, version:Number(attendance.version || 1) + 1, auditTrail:[...auditTrail, { correctionId:correction.id, previousStatus, newStatus, reason, note:req.body.note || null, correctedBy:req.user.id, correctedAt:new Date().toISOString() }].slice(-100) }, { transaction, hooks:false });
    await AuditLog?.create({ schoolCode:schoolCode(req), actorUserId:req.user.id, actorRole:req.user.role, module:'attendance', action:'attendance_corrected', entityType:'Attendance', entityId:String(attendance.id), before:{ status:previousStatus }, after:{ status:newStatus, correctionId:correction.id }, metadata:{ reason } }, { transaction });
    await realtime.emit({ type:'attendance:corrected', schoolCode:schoolCode(req), audience:{ school:false, roles:['admin'], classIds:[session.classId], studentIds:[attendance.studentId] }, entityType:'Attendance', entityId:attendance.id, version:attendance.version, data:{ sessionId:session.id, attendanceId:attendance.id, studentId:attendance.studentId, previousStatus, newStatus, reason, correctedAt:correction.correctedAt }, transaction });
    await realtime.emitToSchool(schoolCode(req), 'analytics:invalidated', { scope:'attendance', classId:session.classId, studentId:attendance.studentId }, { transaction });
    await transaction.commit();
    res.json({ success:true, message:'Locked attendance corrected with a permanent audit record.', data:{ attendance, correction } });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    res.status(500).json({ success:false, message:error.message });
  }
};

exports.releaseClass = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const session = await AttendanceSession.findOne({ where:{ id:Number(req.params.sessionId), schoolCode:schoolCode(req), status:'locked' }, transaction, lock:transaction.LOCK.UPDATE });
    if (!session) { await transaction.rollback(); return res.status(409).json({ success:false, message:'Attendance must be submitted and locked before releasing the class' }); }
    const cls = await requireManageClass(req, res, session.classId, transaction);
    if (!cls) { await transaction.rollback(); return; }
    const releaseType = String(req.body.releaseType || 'normal').toLowerCase();
    if (!RELEASE_TYPES.has(releaseType)) { await transaction.rollback(); return res.status(400).json({ success:false, message:'Invalid class release type' }); }
    const channel = ['platform','sms','both'].includes(String(req.body.channel || 'platform')) ? String(req.body.channel || 'platform') : 'platform';
    const existingCount = await ClassRelease.count({ where:{ schoolCode:schoolCode(req), classId:cls.id, date:session.date }, transaction });
    const updateNumber = existingCount + 1;
    const now = new Date();
    const timeText = new Intl.DateTimeFormat('en-KE', { timeZone:session.timezone || 'Africa/Nairobi', hour:'numeric', minute:'2-digit' }).format(now);
    const templates = {
      normal:`${cls.name} learners were released from school at ${timeText} today.`,
      early:`${cls.name} learners were released early at ${timeText} today.`,
      delayed:`Release of ${cls.name} learners is delayed. Updated at ${timeText}.`,
      transport_delayed:`School transport for ${cls.name} is delayed. Updated at ${timeText}.`,
      custom:String(req.body.message || '').trim()
    };
    const message = templates[releaseType] || templates.normal;
    if (!message) { await transaction.rollback(); return res.status(400).json({ success:false, message:'Custom release message is required' }); }

    const students = await classStudents(req, cls, transaction);
    const links = await StudentParent.findAll({ where:{ studentId:{ [Op.in]:students.map(st=>st.id) } }, transaction });
    const parents = links.length ? await Parent.findAll({ where:{ id:{ [Op.in]:links.map(link=>link.parentId) } }, include:[{ model:User, where:{ schoolCode:schoolCode(req), role:'parent', isActive:true }, attributes:['id','name','phone','email'] }], transaction }) : [];
    const parentUserIds = [...new Set(parents.map(parent=>parent.userId).filter(Boolean).map(Number))];

    const release = await ClassRelease.create({ schoolCode:schoolCode(req), classId:cls.id, date:session.date, updateNumber, releaseType, message, channel, releasedBy:req.user.id, releasedAt:now, parentTargetCount:parentUserIds.length, successCount:parentUserIds.length, failedCount:0, metadata:{ sessionId:session.id, isUpdate:updateNumber > 1, smsStatus:channel === 'platform' ? 'not_requested' : 'queued' } }, { transaction });
    for (const userId of parentUserIds) {
      await createAlert({ userId, role:'parent', type:'attendance', severity:releaseType.includes('delayed') ? 'warning' : 'info', title:updateNumber > 1 ? `${cls.name} release update` : `${cls.name} released`, message, categoryLabel:'Class release', sourceType:'class_release', sourceLabel:'School release notice', classId:cls.id, dedupeKey:`class-release:${cls.id}:${session.date}:${updateNumber}:${userId}`, data:{ schoolCode:schoolCode(req), releaseId:release.id, classId:cls.id, date:session.date, updateNumber, channel }, transaction });
    }
    await realtime.emit({ type:'class:released', schoolCode:schoolCode(req), audience:{ school:false, userIds:parentUserIds, classIds:[cls.id], roles:['admin'] }, entityType:'ClassRelease', entityId:release.id, version:updateNumber, data:{ releaseId:release.id, sessionId:session.id, classId:cls.id, className:cls.name, date:session.date, releaseType, message, channel, updateNumber, releasedAt:now }, transaction });
    await transaction.commit();
    res.status(201).json({ success:true, message:updateNumber > 1 ? 'Class release update sent.' : 'Class release notice sent.', data:release });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    res.status(500).json({ success:false, message:error.message });
  }
};

exports.getCorrections = async (req, res) => {
  try {
    const session = await AttendanceSession.findOne({ where:{ id:Number(req.params.sessionId), schoolCode:schoolCode(req) } });
    if (!session) return res.status(404).json({ success:false, message:'Attendance session not found' });
    const cls = await getClass(req, session.classId);
    if (!(await teacherCanManageClass(req, cls))) return res.status(403).json({ success:false, message:'Forbidden' });
    const rows = await AttendanceCorrection.findAll({ where:{ sessionId:session.id, schoolCode:schoolCode(req) }, order:[['correctedAt','DESC']] });
    res.json({ success:true, data:rows });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

// Compatibility helper for the old one-student POST /api/teacher/attendance path.
exports.saveSingleDraft = async (req, res) => {
  try {
    const student = await (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ id:Number(req.body.studentId) }, include:[{ model:User, where:{ schoolCode:schoolCode(req), role:'student' } }] });
    if (!student?.classId) return res.status(409).json({ success:false, message:'The learner must be assigned to a class before attendance can be saved' });
    req.params.classId = student.classId;
    req.params.date = String(req.body.date || todayInTimezone()).slice(0,10);
    const cls = await requireManageClass(req, res, student.classId);
    if (!cls) return;
    const [session] = await AttendanceSession.findOrCreate({ where:{ schoolCode:schoolCode(req), classId:cls.id, date:req.params.date }, defaults:{ schoolCode:schoolCode(req), classId:cls.id, date:req.params.date, status:'draft', startedBy:req.user.id } });
    req.params.sessionId = session.id;
    req.body.records = [{ studentId:student.id, status:req.body.status, reason:req.body.reason, timeIn:req.body.timeIn, timeOut:req.body.timeOut }];
    return exports.saveDraft(req, res);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.listAbsenceReports = async (req, res) => {
  try {
    const { AbsenceReport } = require('../models');
    const where = { schoolCode: schoolCode(req) };
    if (req.query.status) where.status = String(req.query.status).toLowerCase();
    if (req.query.classId) where.classId = Number(req.query.classId);
    const rows = await AbsenceReport.findAll({
      where,
      include: [
        { model: Student, required: true, include: [{ model: User, attributes: ['id','name','profileImage'] }] },
        { model: Parent, required: true, include: [{ model: User, attributes: ['id','name','email','phone'] }] },
        { model: Class, required: false, attributes: ['id','name','grade','stream'] }
      ],
      order: [['createdAt','DESC']],
      limit: Math.min(Math.max(Number(req.query.limit || 100), 1), 250)
    });
    if (req.user.role === 'teacher') {
      const allowed=[];
      for (const row of rows) {
        if (row.Class && await teacherCanManageClass(req, row.Class)) allowed.push(row);
      }
      return res.json({ success:true, data:allowed });
    }
    return res.json({ success:true, data:rows });
  } catch (error) { return res.status(500).json({ success:false, message:error.message }); }
};

exports.reviewAbsenceReport = async (req, res) => {
  if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success:false, message:'Only a school admin can apply or reject parent absence reports.' });
  const { AbsenceReport } = require('../models');
  const transaction = await sequelize.transaction();
  try {
    const report = await AbsenceReport.findOne({ where:{ id:Number(req.params.reportId), ...(req.user.role === 'super_admin' ? {} : { schoolCode:schoolCode(req) }) }, transaction, lock:transaction.LOCK.UPDATE });
    if (!report) { await transaction.rollback(); return res.status(404).json({ success:false, message:'Absence report not found' }); }
    if (report.status !== 'reported') { await transaction.rollback(); return res.status(409).json({ success:false, message:`Absence report is already ${report.status}.` }); }
    const action=String(req.body.action||'apply').toLowerCase(); const note=String(req.body.note||'').trim().slice(0,2000);
    if (!['apply','reject'].includes(action)) { await transaction.rollback(); return res.status(400).json({success:false,message:'Action must be apply or reject.'}); }
    if (action === 'reject') {
      await report.update({status:'rejected',reviewedBy:req.user.id,reviewedAt:new Date(),reviewNote:note||'Rejected by school admin'},{transaction});
      await AuditLog.create({schoolCode:report.schoolCode,actorUserId:req.user.id,actorRole:req.user.role,module:'attendance',action:'absence_report_rejected',entityType:'AbsenceReport',entityId:String(report.id),before:{status:'reported'},after:{status:'rejected'},metadata:{note}}, {transaction});
      await transaction.commit();
      return res.json({success:true,message:'Absence report rejected without changing attendance.',data:report});
    }
    const student=await Student.findOne({where:{id:report.studentId,schoolCode:report.schoolCode},transaction});
    if(!student||!report.classId){await transaction.rollback();return res.status(409).json({success:false,message:'Student must have an active class before this report can be applied.'});}
    const start=new Date(`${report.startDate}T00:00:00Z`), end=new Date(`${report.endDate}T00:00:00Z`); const applied=[];
    for(let cursor=new Date(start);cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
      const date=cursor.toISOString().slice(0,10);
      const [session]=await AttendanceSession.findOrCreate({where:{schoolCode:report.schoolCode,classId:report.classId,date},defaults:{schoolCode:report.schoolCode,classId:report.classId,date,status:'draft',startedBy:req.user.id,metadata:{createdFromAbsenceReportId:report.id}},transaction});
      let attendance=await Attendance.findOne({where:{schoolCode:report.schoolCode,studentId:report.studentId,date},transaction,lock:transaction.LOCK.UPDATE});
      if(!attendance){
        attendance=await Attendance.create({schoolCode:report.schoolCode,studentId:report.studentId,classId:report.classId,sessionId:session.id,date,status:'absent',reason:report.reason,reportedBy:report.reportedByUserId,reportedByParent:true,markedBy:req.user.id,auditTrail:[{type:'parent_absence_report_applied',absenceReportId:report.id,appliedBy:req.user.id,appliedAt:new Date().toISOString()}]}, {transaction});
      } else if(attendance.status !== 'absent' || attendance.reason !== report.reason){
        const previousStatus=attendance.status;
        const correction=await AttendanceCorrection.create({schoolCode:report.schoolCode,sessionId:session.id,attendanceId:attendance.id,studentId:attendance.studentId,previousStatus,newStatus:'absent',reason:`Parent absence report #${report.id}: ${report.reason}`,note,correctedBy:req.user.id,correctedAt:new Date(),metadata:{absenceReportId:report.id,sessionWasLocked:session.status==='locked'||Boolean(session.lockedAt)}},{transaction});
        const trail=Array.isArray(attendance.auditTrail)?attendance.auditTrail:[];
        await attendance.update({status:'absent',reason:report.reason,reportedBy:report.reportedByUserId,reportedByParent:true,editedBy:req.user.id,editReason:`Applied parent absence report #${report.id}`,version:Number(attendance.version||1)+1,auditTrail:[...trail,{correctionId:correction.id,type:'parent_absence_report_applied',absenceReportId:report.id,previousStatus,newStatus:'absent',appliedBy:req.user.id,appliedAt:new Date().toISOString()}].slice(-100)}, {transaction,hooks:false});
      }
      applied.push({date,attendanceId:attendance.id,sessionId:session.id});
    }
    await report.update({status:'applied',reviewedBy:req.user.id,reviewedAt:new Date(),reviewNote:note||null,metadata:{...(report.metadata||{}),applied}}, {transaction});
    await AuditLog.create({schoolCode:report.schoolCode,actorUserId:req.user.id,actorRole:req.user.role,module:'attendance',action:'absence_report_applied',entityType:'AbsenceReport',entityId:String(report.id),before:{status:'reported'},after:{status:'applied',days:applied.length},metadata:{note}}, {transaction});
    const parent=await Parent.findByPk(report.parentId,{transaction}); if(parent?.userId) await createAlert({userId:parent.userId,role:'parent',type:'attendance',severity:'info',title:'Absence Report Reviewed',message:`Your absence report was reviewed and applied to ${applied.length} day(s) of attendance.`,data:{absenceReportId:report.id,studentId:report.studentId},transaction});
    await realtime.emitToSchool(report.schoolCode,'attendance:absence_report_applied',{absenceReportId:report.id,studentId:report.studentId,classId:report.classId,days:applied.length},{transaction});
    await transaction.commit();
    return res.json({success:true,message:'Absence report applied through the audited attendance workflow.',data:{report,applied}});
  } catch(error){if(!transaction.finished)await transaction.rollback();return res.status(500).json({success:false,message:error.message});}
};
