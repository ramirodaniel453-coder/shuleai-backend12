const { Student, User, AcademicRecord, Attendance, Fee, Payment, Alert, Parent, Teacher, School, Message, Class, Settings, SubscriptionPlan, Admin, AbsenceReport, sequelize } = require('../models');
const { createAlert } = require('../services/notificationService');
const { Op } = require('sequelize');
const ownership = require('../services/parentOwnershipService');
const gradingEngine = require('../services/gradingEngine');


function legacyPaymentEndpointDisabled(req, res) {
  return res.status(410).json({
    success: false,
    code: 'LEGACY_PAYMENT_ENDPOINT_DISABLED',
    message: 'This old payment endpoint is disabled. Use the verified M-Pesa or manual-payment workflow under /api/payments.'
  });
}


async function countLinkedParents(studentId) {
  const rows = await sequelize.query(
    'SELECT COUNT(DISTINCT "parentId")::int AS count FROM "StudentParents" WHERE "studentId" = :studentId',
    { replacements: { studentId }, type: sequelize.QueryTypes.SELECT }
  );
  return Number(rows?.[0]?.count || 0);
}


async function linkParentToStudentSafely(parentId, studentId) {
  const now = new Date();
  await sequelize.query(`
    INSERT INTO "StudentParents" ("studentId", "parentId", "createdAt", "updatedAt")
    VALUES (:studentId, :parentId, :createdAt, :updatedAt)
    ON CONFLICT ("studentId", "parentId") DO UPDATE
      SET "updatedAt" = EXCLUDED."updatedAt"
  `, {
    replacements: { studentId, parentId, createdAt: now, updatedAt: now },
    type: sequelize.QueryTypes.INSERT
  });
}

async function parentHasStudent(parentId, studentId) {
  const rows = await sequelize.query(
    'SELECT 1 FROM "StudentParents" WHERE "parentId" = :parentId AND "studentId" = :studentId LIMIT 1',
    { replacements: { parentId, studentId }, type: sequelize.QueryTypes.SELECT }
  );
  return rows.length > 0;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^0/, '254');
}


async function parentOwnsStudentStrict(parent, student, user) {
  if (!parent || !student || !user) return false;
  return ownership.ownsStudentId({
    parentUserId: user.id || parent.userId,
    parentId: parent.id,
    studentId: student.id
  });
}


async function parentOwnsStudent(parent, student, user) {
  return parentOwnsStudentStrict(parent, student, user);
}


function smallParentMedia(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
  return raw;
}

async function enrichLinkedChildren(children) {
  const classIds = [...new Set(children.map(c => c.classId).filter(Boolean))];
  const classes = classIds.length ? await Class.findAll({ where: { id: { [Op.in]: classIds } }, attributes: ['id','name','grade','stream','schoolCode'] }) : [];
  const classMap = new Map(classes.map(c => [String(c.id), c]));

  const schoolCodes = [...new Set(children.map(c => c.User?.schoolCode).filter(Boolean))];
  const schools = schoolCodes.length ? await School.findAll({ where: { schoolId: { [Op.in]: schoolCodes } }, attributes: ['schoolId','name','system','settings'] }) : [];
  const schoolMap = new Map(schools.map(s => [String(s.schoolId), s]));

  return children.map(child => {
    const raw = child.toJSON ? child.toJSON() : child;
    const user = raw.User || {};
    const classItem = raw.classId ? classMap.get(String(raw.classId)) : null;
    const schoolCode = user.schoolCode || raw.schoolCode || null;
    const school = schoolCode ? schoolMap.get(String(schoolCode)) : null;
    const branding = school?.settings?.branding || {};
    const schoolLogo = smallParentMedia(branding.logoUrl || branding.logo || school?.settings?.logo || '');
    const name = user.name || raw.name || 'Student';
    return {
      id: raw.id,
      studentId: raw.id,
      userId: raw.userId,
      name,
      elimuid: raw.elimuid,
      admissionNumber: raw.admissionNumber || null,
      grade: raw.grade || classItem?.grade || '',
      classId: raw.classId || null,
      className: classItem?.name || raw.grade || 'Not Assigned',
      status: raw.status || 'active',
      curriculum: raw.curriculum || school?.system || 'cbc',
      schoolCode,
      schoolName: school?.name || schoolCode || 'School',
      schoolLogo,
      User: {
        id: user.id || raw.userId,
        name,
        email: user.email || '',
        profileImage: smallParentMedia(user.profileImage || user.profilePicture || '')
      }
    };
  });
}

// @desc    Get parent's children
// @route   GET /api/parent/children
// @access  Private/Parent
exports.getChildren = async (req, res) => {
  try {
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent profile not found' });
    }

    // v124: strict parent-child isolation. Only approved/active StudentParents links are returned.
    const children = await ownership.listOwnedStudents({ parentUserId: req.user.id });
    const enrichedChildren = await enrichLinkedChildren(children);
    res.json({ success: true, data: enrichedChildren });
  } catch (error) {
    console.error('Get children error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Link an extra child to a parent using that child's Elimu ID only
// @route   POST /api/parent/children/link
// @access  Private/Parent
exports.linkChildByElimuId = async (req, res) => {
  try {
    const rawElimuId = String(req.body?.elimuid || req.body?.elimuId || '').trim();
    if (!rawElimuId) {
      return res.status(400).json({ success: false, message: 'Please enter the child Elimu ID' });
    }

    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent profile not found' });

    const student = await Student.findOne({
      where: sequelize.where(sequelize.fn('LOWER', sequelize.col('elimuid')), rawElimuId.toLowerCase()),
      attributes: { include: ['classId'] },
      include: [{ model: User, attributes: ['id', 'name', 'schoolCode'] }]
    });

    // Do not expose other learners through search-like responses.
    if (!student) {
      return res.status(404).json({ success: false, message: 'Unable to link child with this Elimu ID' });
    }

    const alreadyLinked = await parentHasStudent(parent.id, student.id);
    if (alreadyLinked) {
      const children = await enrichLinkedChildren([student]);
      return res.json({ success: true, message: 'This child is already linked to your account', data: children[0] });
    }

    const linkedParentCount = await countLinkedParents(student.id);
    if (linkedParentCount >= 2) {
      return res.status(403).json({ success: false, message: 'This Elimu ID already has the maximum two parent/guardian accounts linked' });
    }

    await linkParentToStudentSafely(parent.id, student.id);
    const children = await enrichLinkedChildren([student]);

    res.status(201).json({ success: true, message: 'Child linked successfully', data: children[0] });
  } catch (error) {
    console.error('Link child by Elimu ID error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get a child's academic summary (published marks only + school curriculum info)
// @route   GET /api/parent/child/:studentId/summary
// @access  Private/Parent
exports.getChildSummary = async (req, res) => {
  try {
    const { studentId } = req.params;
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found' });

    const student = await Student.findByPk(studentId, { 
      attributes: { include: ['classId'] },
      include: [
        { model: User },
        { model: Fee, where: { status: { [Op.ne]: 'paid' } }, required: false }
      ] 
    });
    
    if (!student || !(await parentOwnsStudent(parent, student, req.user))) {
      return res.status(403).json({ success: false, message: 'Not your child' });
    }

    // Get child's class teacher
    const classTeacher = await Teacher.findOne({
      where: { classTeacher: student.grade },
      include: [{ model: User, attributes: ['id','name','email','phone','profileImage','profilePicture'] }]
    });

    // Fetch only PUBLISHED academic records
    const records = await AcademicRecord.findAll({ 
      where: { studentId, isPublished: true }, 
      order: [['date', 'DESC']], 
      limit: 10 
    });
    
    const attendance = await Attendance.findAll({ 
      where: { studentId }, 
      order: [['date', 'DESC']], 
      limit: 20 
    });
    
    const outstandingFees = await Fee.findOne({ 
      where: { studentId, status: { [Op.ne]: 'paid' } } 
    });

    const avg = records.length ? records.reduce((a,b) => a + b.score, 0) / records.length : 0;

    // Get school info – include curriculum and level so frontend can compute correct grades
    const school = await School.findOne({ 
      where: { schoolId: student.User?.schoolCode || req.user.schoolCode },
      attributes: ['name', 'schoolId', 'system', 'settings']
    });

    const schoolBranding = school?.settings?.branding || {};
    const schoolPayload = school ? {
      name: school.name,
      schoolName: school.name,
      schoolId: school.schoolId,
      schoolCode: school.schoolId,
      system: school.system,
      curriculum: school.system,
      schoolLevel: school.settings?.schoolLevel || 'secondary',
      branding: {
        schoolName: schoolBranding.schoolName || schoolBranding.displayName || school.name,
        displayName: schoolBranding.displayName || schoolBranding.schoolName || school.name,
        primaryColor: schoolBranding.primaryColor || '',
        accentColor: schoolBranding.accentColor || '',
        logoUrl: smallParentMedia(schoolBranding.logoUrl || schoolBranding.logo || '')
      }
    } : null;
    const fee = outstandingFees ? (outstandingFees.toJSON ? outstandingFees.toJSON() : outstandingFees) : null;

    res.json({
      success: true,
      data: {
        student: {
          id: student.User?.id,
          userId: student.User?.id,
          name: student.User?.name || 'Student',
          studentId: student.id,
          elimuid: student.elimuid,
          grade: student.grade,
          classId: student.classId,
          curriculum: student.curriculum,
          schoolCode: student.User?.schoolCode,
          profileImage: smallParentMedia(student.User?.profileImage || student.User?.profilePicture || '')
        },
        classTeacher: classTeacher ? {
          id: classTeacher.id,
          name: classTeacher.User.name,
          email: classTeacher.User.email,
          phone: classTeacher.User.phone
        } : null,
        averageScore: avg,
        recentRecords: records,
        recentAttendance: attendance,
        outstandingFees: fee ? {
          id: fee.id,
          totalAmount: fee.totalAmount,
          paidAmount: fee.paidAmount,
          parentPaidAmount: fee.parentPaidAmount,
          balance: fee.balance,
          status: fee.status,
          term: fee.term,
          year: fee.year,
          dueDate: fee.dueDate
        } : null,
        school: schoolPayload,
        // Explicitly pass curriculum info for the frontend
        curriculum: school ? school.system : 'cbc',
        schoolLevel: school?.settings?.schoolLevel || 'secondary'
      }
    });
  } catch (error) {
    console.error('Get child summary error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// @desc    Parent-safe report card details for a linked child
// @route   GET /api/parent/child/:studentId/report-card-details
// @access  Private/Parent
exports.getChildReportCardDetails = async (req, res) => {
  try {
    const { studentId } = req.params;
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) return res.status(404).json({ success:false, message:'Parent profile not found' });
    const owned = await ownership.assertParentOwnsStudent({ parentUserId: req.user.id, parentId: parent.id, studentId });
    const student = owned.student;

    const schoolCode = student.User?.schoolCode || req.user.schoolCode;
    const school = await School.findOne({ where: { schoolId: schoolCode }, attributes: ['name','schoolId','system','settings','reportCardSettings'] }).catch(() => null);
    const curriculum = school?.system || school?.settings?.curriculum || student.curriculum || 'cbc';
    const schoolLevel = school?.settings?.schoolLevel || 'secondary';
    let classTeacher = null;
    let currentClass = student.classId ? await Class.findOne({ where:{ id:student.classId, schoolCode, isActive:true } }).catch(() => null) : null;
    if (!currentClass && !student.classId && student.grade) currentClass = await Class.findOne({ where:{ schoolCode, isActive:true, [Op.or]:[{ name:student.grade }, { grade:student.grade }] }, order:[['id','ASC']] }).catch(() => null);
    if (currentClass?.teacherId) classTeacher = await Teacher.findOne({ where:{ id:currentClass.teacherId }, include:[{ model:User, attributes:['id','name','email','phone','preferences'], where:{ schoolCode }, required:true }] }).catch(() => null);
    if (!classTeacher && currentClass?.id) classTeacher = await Teacher.findOne({ where:{ classId:currentClass.id }, include:[{ model:User, attributes:['id','name','email','phone','preferences'], where:{ schoolCode }, required:true }] }).catch(() => null);
    if (!classTeacher && !student.classId) classTeacher = await Teacher.findOne({ where:{ classTeacher:student.grade }, include:[{ model:User, attributes:['id','name','email','phone','preferences'], where:{ schoolCode }, required:true }] }).catch(() => null);
    const adminSigner = await Admin.findOne({
      where: {},
      include: [{ model: User, attributes: ['id','name','email','phone','preferences'], where: { schoolCode, role: 'admin' }, required: true }],
      order: [['updatedAt','DESC']]
    }).catch(() => null);
    const safeSig = (model, user) => user?.preferences?.signatureDataUrl || model?.signatureUrl || model?.signature || user?.preferences?.signatureUrl || user?.preferences?.signatureAbsoluteUrl || '';

    const records = await AcademicRecord.findAll({
      where: { studentId: student.id, [Op.or]: [{ isPublished: true }, { status: 'published' }] },
      order: [['year','DESC'], ['term','DESC'], ['date','DESC']]
    }).catch(() => []);
    const assessmentSettings = await sequelize.query(`
      SELECT * FROM "SchoolAssessmentSettings" WHERE "schoolCode" = :schoolCode ORDER BY "displayOrder" ASC, "id" ASC
    `, { replacements:{ schoolCode }, type:sequelize.QueryTypes.SELECT }).catch(() => []);
    const defaultTests = [
      { assessmentType:'cat', label:'CAT', showOnReport:true, countInFinal:true, weight:20, displayOrder:1 },
      { assessmentType:'midterm', label:'Midterm', showOnReport:true, countInFinal:true, weight:30, displayOrder:2 },
      { assessmentType:'end_term', label:'End Term', showOnReport:true, countInFinal:true, weight:50, displayOrder:3 },
      { assessmentType:'sba', label:'SBA', showOnReport:false, countInFinal:false, weight:0, displayOrder:4 },
      { assessmentType:'project', label:'Project', showOnReport:false, countInFinal:false, weight:0, displayOrder:5 },
      { assessmentType:'practical', label:'Practical', showOnReport:false, countInFinal:false, weight:0, displayOrder:6 }
    ];
    const testSettings = assessmentSettings.length ? assessmentSettings : defaultTests;
    const settingMap = new Map(testSettings.map(t => [String(t.assessmentType || t.type || '').toLowerCase(), t]));
    const normalizedType = (r) => String(r.assessmentType || r.testType || r.examType || r.assessmentName || r.assessment || 'end_term').toLowerCase().replace(/\s+/g, '_');
    const subjectMap = {};
    records.forEach(r => {
      const subject = r.subject || 'Subject';
      const type = normalizedType(r);
      const setting = settingMap.get(type) || settingMap.get(type.replace(/_?exam$/, '')) || { label:r.assessmentName || r.assessment || type, showOnReport:true, countInFinal:true, weight:0, displayOrder:99 };
      if (setting.showOnReport === false || r.showOnReport === false) return;
      if (!subjectMap[subject]) subjectMap[subject] = { subject, weighted:0, weight:0, rawTotal:0, rawCount:0, components:[], records:[] };
      const score = Number(r.score || 0);
      const weight = Number(r.assessmentWeight ?? setting.weight ?? 0);
      if (setting.countInFinal !== false && r.countInFinal !== false) {
        if (weight > 0) { subjectMap[subject].weighted += score * weight; subjectMap[subject].weight += weight; }
        else { subjectMap[subject].rawTotal += score; subjectMap[subject].rawCount += 1; }
      }
      subjectMap[subject].components.push({ type, label:setting.label || r.assessmentName || r.assessment || type, score, weight, countInFinal:setting.countInFinal !== false && r.countInFinal !== false, displayOrder:Number(setting.displayOrder || 99), date:r.date, term:r.term, year:r.year });
      subjectMap[subject].records.push(r);
    });
    const subjects = Object.values(subjectMap).map((d) => {
      const average = d.weight > 0 ? Math.round(d.weighted / d.weight) : Math.round(d.rawTotal / Math.max(1, d.rawCount));
      return { subject:d.subject, average, grade:gradingEngine.gradeValueForRecords(average,d.records), components:d.components.sort((a,b)=>a.displayOrder-b.displayOrder) };
    });
    const attendance = await Attendance.findAll({ where: { studentId: student.id, schoolCode }, order: [['date','DESC']] }).catch(() => []);
    const present = attendance.filter(a => a.status === 'present').length;
    const absent = attendance.filter(a => a.status === 'absent').length;
    const late = attendance.filter(a => a.status === 'late').length;
    const rate = attendance.length ? Math.round((present / attendance.length) * 100) : 0;
    const fee = await Fee.findOne({ where: { studentId: student.id, status: { [Op.ne]: 'paid' } }, order:[['updatedAt','DESC']] }).catch(() => null);
    const feeBalance = fee ? Math.max(0, Number(fee.totalAmount || 0) - Number(fee.paidAmount || 0)) : null;

    let ranking = { classPosition: null, classSize: null, streamPosition: null, streamSize: null, showClassPosition: false, showStreamPosition: false };
    try {
      const reportSettings = school?.settings?.reportCardSettings || school?.reportCardSettings || {};
      const showClassPosition = reportSettings.showClassPosition === true || reportSettings.showPositions === true || ['844','8-4-4'].includes(String(curriculum).toLowerCase());
      const showStreamPosition = reportSettings.showStreamPosition === true;
      if ((showClassPosition || showStreamPosition) && student.classId) {
        const peers = await sequelize.query(`
          SELECT ar."studentId", AVG(COALESCE(ar."score",0)) AS avg_score
          FROM "AcademicRecords" ar
          JOIN "Students" st ON st."id" = ar."studentId"
          JOIN "Users" u ON u."id" = st."userId"
          WHERE u."schoolCode" = :schoolCode
            AND st."classId" = :classId
            AND (ar."isPublished" = true OR ar."status" = 'published')
          GROUP BY ar."studentId"
          ORDER BY avg_score DESC
        `, { replacements:{ schoolCode, classId: student.classId }, type:sequelize.QueryTypes.SELECT }).catch(() => []);
        const ordered = peers.map((p, idx) => ({ studentId:Number(p.studentId), avg:Number(p.avg_score || 0), rank:idx + 1 }));
        const mine = ordered.find(p => p.studentId === Number(student.id));
        ranking = { classPosition: mine?.rank || null, classSize: ordered.length || null, streamPosition: mine?.rank || null, streamSize: ordered.length || null, showClassPosition, showStreamPosition };
      }
    } catch (rankErr) { console.warn('Report position calculation skipped:', rankErr.message); }

    res.json({ success:true, data:{
      student: { id:student.id, elimuid:student.elimuid, grade:student.grade, status:student.status, classId:student.classId, photo:student.User?.profileImage || student.profileImage || student.photo || student.passportPhoto, curriculum },
      user: { name:student.User?.name, email:student.User?.email, phone:student.User?.phone },
      classTeacher: classTeacher?.User ? { name:classTeacher.User.name, email:classTeacher.User.email, phone:classTeacher.User.phone, signature:safeSig(classTeacher, classTeacher.User), signatureUrl:safeSig(classTeacher, classTeacher.User) } : null,
      headteacher: adminSigner?.User ? { name:adminSigner.User.name, email:adminSigner.User.email, phone:adminSigner.User.phone, signature:safeSig(adminSigner, adminSigner.User), signatureUrl:safeSig(adminSigner, adminSigner.User) } : null,
      principal: adminSigner?.User ? { name:adminSigner.User.name, email:adminSigner.User.email, phone:adminSigner.User.phone, signature:safeSig(adminSigner, adminSigner.User), signatureUrl:safeSig(adminSigner, adminSigner.User) } : null,
      reportSignatures: { classTeacher:safeSig(classTeacher, classTeacher?.User), headteacher:safeSig(adminSigner, adminSigner?.User), principal:safeSig(adminSigner, adminSigner?.User) },
      academicSummary: { overallAverage: records.length ? Math.round(records.reduce((sum, r) => sum + Number(r.score || 0), 0) / records.length) : 0, subjects },
      attendanceSummary: { rate, present, absent, late },
      feeBalance,
      ranking,
      recentAssessments: records.slice(0, 5).map(r => ({ subject:r.subject, assessment:r.assessmentName || r.assessmentType || r.assessment, score:r.score, grade:gradingEngine.storedGrade(r), term:r.term, year:r.year, date:r.date })),
      school: { name:school?.name || null, schoolName:school?.name || null, schoolCode, curriculum, system:curriculum, schoolLevel, logo:school?.settings?.branding?.logoDataUrl || school?.settings?.branding?.logoUrl || school?.settings?.branding?.logo || school?.settings?.logo || null, branding:school?.settings?.branding || {}, reportCardSettings: school?.settings?.reportCardSettings || school?.reportCardSettings || {} }
    }});
  } catch (error) {
    console.error('Get child report card details error:', error);
    res.status(error.status || 500).json({ success:false, message:error.message });
  }
};

// @desc    Report child's absence with notification to class teacher
// @route   POST /api/parent/report-absence
// @access  Private/Parent
exports.reportAbsence = async (req, res) => {
  const transaction=await sequelize.transaction();
  try {
    const studentId=Number(req.body.studentId); const reason=String(req.body.reason||'').trim();
    if(!studentId||!reason||reason.length>2000){await transaction.rollback();return res.status(400).json({success:false,message:'Student and a reason of up to 2000 characters are required.'});}
    const iso=/^\d{4}-\d{2}-\d{2}$/; const startText=String(req.body.startDate||req.body.date||''); const endText=String(req.body.endDate||req.body.date||startText);
    if(!iso.test(startText)||!iso.test(endText)){await transaction.rollback();return res.status(400).json({success:false,message:'Absence dates must use YYYY-MM-DD.'});}
    const start=new Date(`${startText}T00:00:00Z`),end=new Date(`${endText}T00:00:00Z`); const days=Math.floor((end-start)/86400000)+1;
    if(!Number.isFinite(days)||days<1||days>30){await transaction.rollback();return res.status(400).json({success:false,message:'Absence range must be between 1 and 30 days.'});}
    const parent=await Parent.findOne({where:{userId:req.user.id},transaction}); if(!parent){await transaction.rollback();return res.status(404).json({success:false,message:'Parent profile not found'});}
    const student=await Student.findByPk(studentId,{attributes:{include:['classId']},include:[{model:User,attributes:['id','name','schoolCode']}],transaction});
    if(!student||!(await parentOwnsStudent(parent,student,req.user))){await transaction.rollback();return res.status(403).json({success:false,message:'Not your child'});}
    const schoolCode=student.User?.schoolCode||student.schoolCode||req.user.schoolCode; const cls=student.classId?await Class.findOne({where:{id:student.classId,schoolCode},transaction}):null;
    const report=await AbsenceReport.create({schoolCode,studentId:student.id,parentId:parent.id,classId:cls?.id||student.classId||null,startDate:startText,endDate:endText,reason,status:'reported',reportedByUserId:req.user.id,metadata:{studentName:student.User?.name||null,days}},{transaction});
    let classTeacher=null;
    if(cls){classTeacher=await Teacher.findOne({where:{[Op.or]:[{classId:cls.id},...(cls.teacherId?[{id:cls.teacherId}]:[])]},include:[{model:User,where:{schoolCode,role:'teacher',isActive:true},attributes:['id','name','email']}],transaction});}
    const dateRangeText=days>1?`${startText} to ${endText} (${days} days)`:startText;
    if(classTeacher?.User?.id) await createAlert({userId:classTeacher.User.id,role:'teacher',type:'attendance',severity:'info',title:'Student Absence Reported',message:`${student.User?.name||'Student'} is reported absent for ${dateRangeText}. Review this report before changing official attendance.`,data:{absenceReportId:report.id,studentId:student.id,startDate:startText,endDate:endText,reason},transaction});
    const admins=await User.findAll({where:{role:'admin',schoolCode,isActive:true},transaction});
    for(const admin of admins) await createAlert({userId:admin.id,role:'admin',type:'attendance',severity:'info',title:'Parent Reported Absence',message:`${student.User?.name||'Student'} has a parent absence report for ${dateRangeText}.`,data:{absenceReportId:report.id,studentId:student.id,startDate:startText,endDate:endText,reason},transaction});
    await transaction.commit();
    return res.status(201).json({success:true,message:classTeacher?'Absence report submitted for teacher/admin review.':'Absence report submitted for admin review.',data:report});
  } catch(error){if(!transaction.finished)await transaction.rollback();console.error('Report absence error:',error);return res.status(500).json({success:false,message:error.message});}
};

// @desc    Get available subscription plans
// @route   GET /api/parent/plans
// @access  Private/Parent
exports.getSubscriptionPlans = async (req, res) => {
  try {
    const settings = await Settings.findOne({ where: { key: 'platform_payment_settings' } }).catch(() => null);
    const cfgPlans = Array.isArray(settings?.value?.parentPlans) ? settings.value.parentPlans : [];
    if (cfgPlans.length) {
      const plans = cfgPlans.filter(p => p && p.isActive !== false).map((p, idx) => {
        const code = String(p.code || p.id || p.name || `plan_${idx + 1}`).trim();
        const amount = Number(p.amount ?? p.price ?? p.monthlyPriceKes ?? p.price_kes ?? 0) || 0;
        return {
          id: code,
          code: code === 'basic' ? 'child_basic' : code === 'premium' ? 'child_premium' : code === 'ultimate' ? 'child_ultimate' : code === 'essential' ? 'child_basic' : code === 'smart' ? 'child_premium' : code === 'genius' ? 'child_ultimate' : (code.startsWith('child_') ? code : `child_${code}`),
          name: p.displayName || p.name || code,
          displayName: p.displayName || p.name || code,
          price: amount,
          monthlyPriceKes: Number(p.monthlyPriceKes ?? amount) || amount,
          termlyPriceKes: p.termlyPriceKes ?? p.termly ?? (amount ? amount * 3 : null),
          yearlyPriceKes: p.yearlyPriceKes ?? p.yearly ?? (amount ? amount * 12 : null),
          currency: settings.value.currency || 'KES',
          interval: p.interval || 'month',
          ownerType: 'child',
          features: Array.isArray(p.features) ? p.features : [],
          lockedFeatures: Array.isArray(p.lockedFeatures) ? p.lockedFeatures : [],
          limits: p.limits || { days: Number(p.days || 30) || 30 },
          sortOrder: p.sortOrder ?? idx
        };
      });
      return res.json({ success: true, data: plans });
    }
    const dbPlans = await SubscriptionPlan.findAll({ where: { ownerType: 'child', isActive: true }, order: [['sortOrder', 'ASC'], ['price_kes', 'ASC']] }).catch(() => []);
    if (dbPlans.length) {
      return res.json({ success:true, data: dbPlans.map(p => ({
        id: p.code || p.name,
        code: p.code || p.name,
        name: p.displayName || p.name,
        displayName: p.displayName || p.name,
        price: p.price_kes,
        monthlyPriceKes: p.monthlyPriceKes || p.price_kes,
        termlyPriceKes: p.termlyPriceKes,
        yearlyPriceKes: p.yearlyPriceKes,
        currency: 'KES',
        interval: 'month',
        ownerType: 'child',
        features: p.features || [],
        lockedFeatures: p.lockedFeatures || [],
        limits: p.limits || {},
        sortOrder: p.sortOrder || 0
      })) });
    }
    res.json({ success: true, data: [
      { id: 'child_basic', code:'child_basic', name: 'Basic', displayName:'Basic', price: 100, monthlyPriceKes:100, currency: 'KES', interval: 'month', features: ['Report cards', 'Attendance', 'Progress'], limits:{ days:30, aiTutor:false, aiQuestionsPerDay:0, aiQuestionsPerMonth:0 } },
      { id: 'child_premium', code:'child_premium', name: 'Premium', displayName:'Premium', price: 250, monthlyPriceKes:250, currency: 'KES', interval: 'month', features: ['Everything in Basic', 'AI Tutor: 6 messages/day', 'Child timetable if school has timetable'], limits:{ days:30, aiTutor:true, aiQuestionsPerDay:6, aiQuestionsPerMonth:180 } },
      { id: 'child_ultimate', code:'child_ultimate', name: 'Ultimate', displayName:'Ultimate', price: 500, monthlyPriceKes:500, currency: 'KES', interval: 'month', features: ['Everything in Premium', 'Extended AI Tutor', 'Live child analytics', 'Stronger alerts', 'Child recommendations'], limits:{ days:30, aiTutor:true, aiQuestionsPerDay:50, aiQuestionsPerMonth:1500 } }
    ] });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Legacy payment creation endpoint disabled
// @route   POST /api/parent/pay
// @access  Private/Parent
exports.makePayment = legacyPaymentEndpointDisabled;

// @desc    Legacy client-side payment confirmation endpoint disabled
// @route   POST /api/parent/payment-confirm
// @access  Private/Parent
exports.confirmPayment = legacyPaymentEndpointDisabled;

// @desc    Get payment history
// @route   GET /api/parent/payments
// @access  Private/Parent
exports.getPayments = async (req, res) => {
  try {
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent profile not found' });

    const payments = await Payment.findAll({
      where: { parentId: parent.id },
      include: [
        { model: Student, include: [{ model: User, attributes: ['id', 'name', 'schoolCode'] }] },
        { model: Fee }
      ],
      order: [['createdAt', 'DESC']],
      limit: 500
    });

    const schoolCodes = [...new Set(payments.map(payment => payment.schoolCode).filter(Boolean))];
    const schools = await School.findAll({ where: { schoolId: { [Op.in]: schoolCodes } }, attributes: ['schoolId', 'name', 'bankDetails', 'settings'] });
    const school = schools.length === 1 ? schools[0] : null;

    const normalized = payments.map((payment) => {
      const row = payment.toJSON ? payment.toJSON() : payment;
      const fee = row.Fee || null;
      const total = Number(fee?.totalAmount || 0);
      const paid = Number(fee?.paidAmount || 0);
      return {
        ...row,
        feeTerm: fee?.term || row.metadata?.term || null,
        feeYear: fee?.year || row.metadata?.year || null,
        feeTotalAmount: total,
        feePaidAmount: paid,
        feeBalance: Math.max(0, total - paid),
        category: row.paymentType === 'fee' ? 'school_fee' : row.paymentType || 'payment'
      };
    });

    res.json({ success: true, data: { payments: normalized, school, schools } });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Legacy direct plan-upgrade endpoint disabled
// @route   POST /api/parent/upgrade-plan
// @access  Private/Parent
exports.upgradePlan = legacyPaymentEndpointDisabled;

// @desc    Send message to class teacher or admin only
// @route   POST /api/parent/message
// @access  Private/Parent
exports.sendMessage = async (req, res) => {
  try {
    const { studentId, message, recipientType } = req.body;
    const target = String(recipientType || 'admin').toLowerCase();
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) return res.status(404).json({ success:false, message:'Parent not found' });
    const student = await Student.findByPk(studentId, { include: [{ model: User, attributes: ['id', 'name', 'schoolCode'] }] });
    if (!student) return res.status(404).json({ success:false, message:'Student not found' });
    const linked = await sequelize.query('SELECT 1 FROM "StudentParents" WHERE "parentId"=:parentId AND "studentId"=:studentId LIMIT 1', { replacements:{ parentId:parent.id, studentId:student.id }, type:sequelize.QueryTypes.SELECT });
    if (!linked.length || student.User?.schoolCode !== req.user.schoolCode) return res.status(403).json({ success:false, message:'Not your child' });

    let recipientId = null, recipientName = '', actualRecipientType = target;
    if (target === 'admin') {
      const admin = await User.findOne({ where: { role: 'admin', schoolCode: req.user.schoolCode, isActive: true } }) || await User.findOne({ where:{ role:'admin', schoolCode:req.user.schoolCode } });
      if (!admin) return res.status(404).json({ success:false, message:'School admin not found' });
      recipientId = admin.id; recipientName = admin.name; actualRecipientType = 'admin';
    } else if (target === 'teacher') {
      let teacher = null;
      const possibleClassNames = [student.className, student.grade, student.class, student.stream].filter(Boolean).map(String);
      let cls = student.classId ? await Class.findOne({ where:{ id:student.classId, schoolCode:req.user.schoolCode } }).catch(()=>null) : null;
      if (!cls && possibleClassNames.length) cls = await Class.findOne({ where:{ schoolCode:req.user.schoolCode, [Op.or]: [{ name:{ [Op.in]: possibleClassNames } }, { grade:{ [Op.in]: possibleClassNames } }] } }).catch(()=>null);
      if (cls?.teacherId) teacher = await Teacher.findOne({ where:{ id:cls.teacherId }, include:[{ model:User, where:{ schoolCode:req.user.schoolCode }, attributes:['id','name','email'] }] }).catch(()=>null);
      if (!teacher && cls?.id) {
        const { TeacherSubjectAssignment } = require('../models');
        const ass = await TeacherSubjectAssignment.findOne({ where:{ classId:cls.id, isClassTeacher:true }, include:[{ model:Teacher, include:[{ model:User, where:{ schoolCode:req.user.schoolCode }, attributes:['id','name','email'] }] }] }).catch(()=>null);
        teacher = ass?.Teacher || null;
      }
      if (!teacher && cls?.id) teacher = await Teacher.findOne({ where:{ classId:cls.id }, include:[{ model:User, where:{ schoolCode:req.user.schoolCode }, attributes:['id','name','email'] }] }).catch(()=>null);
      if (!teacher && !student.classId) {
        const teacherNames = [...possibleClassNames, cls?.name, cls?.grade].filter(Boolean);
        if (teacherNames.length) teacher = await Teacher.findOne({ where:{ classTeacher:{ [Op.in]: teacherNames } }, include:[{ model:User, where:{ schoolCode:req.user.schoolCode }, attributes:['id','name','email'] }] }).catch(()=>null);
      }
      if (!teacher) {
        // Final consolidation: do not break parent messaging when class-teacher lookup
        // cannot match legacy class storage. Fallback to school admin and return the
        // actual recipient so the frontend toast is truthful.
        const admin = await User.findOne({ where: { role: 'admin', schoolCode: req.user.schoolCode, isActive: true } })
          || await User.findOne({ where:{ role:'admin', schoolCode:req.user.schoolCode } });
        if (!admin) return res.status(404).json({ success:false, message:'Class teacher has not been assigned yet and school admin was not found.' });
        recipientId = admin.id; recipientName = admin.name; actualRecipientType = 'admin';
      } else {
        recipientId = teacher.User.id; recipientName = teacher.User.name; actualRecipientType = 'teacher';
      }
    } else {
      return res.status(400).json({ success:false, message:'Invalid recipient type' });
    }

    const { Message } = require('../models');
    const newMessage = await Message.create({
      senderId: req.user.id,
      receiverId: recipientId,
      content: message,
      metadata: { studentId: student.id, studentName: student.User?.name, parentName: req.user.name, requestedRecipientType: target, actualRecipientType, conversationType: 'parent-to-staff' }
    });

    if (global.io) global.io.to(`user-${recipientId}`).emit('new-message', { from:req.user.id, fromName:req.user.name, content:message, studentName:student.User?.name, timestamp:new Date() });

    res.status(201).json({ success:true, message:'Message sent successfully', data:{ id:newMessage.id, recipient:recipientName, recipientType:actualRecipientType, requestedRecipientType:target, recipientId, sentAt:newMessage.createdAt } });
  } catch (error) {
    console.error('Send parent message error:', error);
    res.status(500).json({ success:false, message:error.message });
  }
};

// @desc    Get messages with teacher or admin
// @route   GET /api/parent/messages/:otherUserId
// @access  Private/Parent
exports.getMessages = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const { Message } = require('../models');

    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderId: req.user.id, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: req.user.id }
        ]
      },
      order: [['createdAt', 'ASC']],
      include: [
        { model: User, as: 'Sender', attributes: ['id','name','role','profileImage','profilePicture'] },
        { model: User, as: 'Receiver', attributes: ['id','name','role','profileImage','profilePicture'] }
      ]
    });

    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get child analytics (published marks only + curriculum info)
// @route   GET /api/parent/child/:studentId/analytics
// @access  Private/Parent
exports.getChildAnalytics = async (req, res) => {
  try {
    const { studentId } = req.params;
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    const student = await Student.findByPk(studentId, { include: [{ model: User, attributes: ['id','schoolCode'] }] });
    if (!parent || !student || !(await parentOwnsStudent(parent, student, req.user))) return res.status(403).json({ success: false, message: 'Child not linked to this parent' });

    // Only published marks
    const records = await AcademicRecord.findAll({ where: { studentId, isPublished: true } });
    const gradeCount = { A:0, B:0, C:0, D:0, E:0 };
    records.forEach(r => {
      const grade = r.grade?.[0] || 'C';
      if (gradeCount[grade] !== undefined) gradeCount[grade]++;
      else gradeCount['C']++;
    });

    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth()-6);
    const attendance = await Attendance.findAll({
      where: { studentId, date: { [Op.gte]: sixMonthsAgo } },
      order: [['date', 'ASC']]
    });
    const attendanceByMonth = {};
    attendance.forEach(a => {
      const month = new Date(a.date).toISOString().slice(0,7);
      if (!attendanceByMonth[month]) attendanceByMonth[month] = { present:0, total:0 };
      attendanceByMonth[month].total++;
      if (a.status === 'present') attendanceByMonth[month].present++;
    });
    const attendanceTrend = Object.entries(attendanceByMonth).map(([month, data]) => ({
      month,
      rate: (data.present/data.total)*100
    }));

    const subjectProgress = {};
    records.forEach(r => {
      if (!subjectProgress[r.subject]) subjectProgress[r.subject] = [];
      subjectProgress[r.subject].push({ date: r.date, score: r.score });
    });

    // Include school info for grade calculations
    const school = await School.findOne({ where: { schoolId: student.User?.schoolCode } });

    res.json({ 
      success: true, 
      data: { 
        gradeDistribution: gradeCount, 
        attendanceTrend, 
        subjectProgress,
        curriculum: school?.system || 'cbc',
        schoolLevel: school?.settings?.schoolLevel || 'secondary'
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get fee details for a child
// @route   GET /api/parent/fees/:studentId
// @access  Private/Parent
exports.getFees = async (req, res) => {
  try {
    const { studentId } = req.params;
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent profile not found' });
    const student = await Student.findByPk(studentId, { include: [{ model: User, attributes: ['id','name','schoolCode'] }] });
    if (!student || !(await parentOwnsStudent(parent, student, req.user))) {
      return res.status(403).json({ success: false, message: 'Not your child' });
    }
    const schoolCode = student.User?.schoolCode;
    const fees = await Fee.findAll({
      where: { studentId, schoolCode },
      include: [{ model: Payment, required: false, where: { schoolCode, paymentType: 'fee' } }],
      order: [['year', 'DESC'], ['term', 'DESC']]
    });
    const normalized = fees.map((fee) => {
      const row = fee.toJSON ? fee.toJSON() : fee;
      const total = Number(row.totalAmount || 0);
      const paid = Number(row.paidAmount || 0);
      return { ...row, balance: Math.max(0, total - paid), payments: row.Payments || row.payments || [] };
    });
    res.json({ success: true, data: normalized });
  } catch (error) {
    console.error('Get fees error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Legacy direct fee-payment endpoint disabled
// @route   POST /api/parent/fees/pay
// @access  Private/Parent
exports.addPayment = legacyPaymentEndpointDisabled;

// @desc    Get child's live attendance for today
// @route   GET /api/parent/child/:studentId/attendance/today
exports.getChildTodayAttendance = async (req, res) => {
  try {
    const { studentId } = req.params;
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    const student = await Student.findByPk(studentId, { include: [{ model: User, attributes: ['id','name','schoolCode'] }] });
    if (!student || !(await parentOwnsStudent(parent, student, req.user))) {
      return res.status(403).json({ success: false, message: 'Not your child' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const attendance = await Attendance.findOne({
      where: { studentId, date: today }
    });
    
    res.json({ 
      success: true, 
      data: attendance || { status: 'not_recorded' } 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// In parentController.js
exports.getConversations = async (req, res) => {
  try {
    const parent = await Parent.findOne({ where: { userId: req.user.id } });
    const messages = await Message.findAll({
      where: {
        [Op.or]: [{ senderId: req.user.id }, { receiverId: req.user.id }]
      },
      include: [
        { model: User, as: 'Sender', attributes: ['id','name','role','profileImage','profilePicture'] },
        { model: User, as: 'Receiver', attributes: ['id','name','role','profileImage','profilePicture'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    const conversations = {};
    messages.forEach(msg => {
      const otherId = msg.senderId === req.user.id ? msg.receiverId : msg.senderId;
      if (!conversations[otherId]) {
        conversations[otherId] = {
          userId: otherId,
          userName: msg.senderId === req.user.id ? msg.Receiver?.name : msg.Sender?.name,
          lastMessage: msg.content,
          lastMessageTime: msg.createdAt,
          unreadCount: msg.receiverId === req.user.id && !msg.isRead ? 1 : 0
        };
      } else if (msg.receiverId === req.user.id && !msg.isRead) {
        conversations[otherId].unreadCount++;
      }
    });
    res.json({ success: true, data: Object.values(conversations) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
