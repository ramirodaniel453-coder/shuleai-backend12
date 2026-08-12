const fs = require('fs');
const csv = require('csv-parser');
const { Op } = require('sequelize');
const { generateTemporaryPassword } = require('../../utils/passwords');
const { sequelize, Student, User, Parent, StudentParent, Class, Teacher, StudentEnrollment, AcademicRecord, Attendance } = require('../../models');

function value(row, ...keys) {
  for (const key of keys) {
    const found = row[key] ?? row[String(key).toLowerCase()] ?? row[String(key).replace(/\s+/g, '')];
    if (found !== undefined && found !== null && String(found).trim() !== '') return String(found).trim();
  }
  return '';
}
function normal(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function normalPhone(value) {
  const raw = String(value || '').replace(/[^0-9+]/g, '');
  if (/^0\d{9}$/.test(raw)) return `+254${raw.slice(1)}`;
  if (/^254\d{9}$/.test(raw)) return `+${raw}`;
  return raw || null;
}
function normalGender(value) {
  const v = normal(value);
  if (['m','male','boy'].includes(v)) return 'male';
  if (['f','female','girl'].includes(v)) return 'female';
  if (v === 'other') return 'other';
  return null;
}
function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function createActiveEnrollmentForStudent({ student, targetClass, schoolCode, actorId, transaction }) {
  if (!student || !targetClass) return null;
  const year = Number(targetClass.academicYear) || new Date().getFullYear();
  const effectiveFrom = student.enrollmentDate ? new Date(student.enrollmentDate).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  const enrollment = await StudentEnrollment.create({
    schoolCode,
    studentId: student.id,
    classId: targetClass.id,
    stream: targetClass.stream || null,
    academicYear: year,
    status: 'active',
    effectiveFrom,
    startTerm: 'Term 1',
    createdBy: actorId || null,
    classTeacherIdAtStart: targetClass.teacherId || null,
    movementType: 'admission',
    movementReason: 'Created during CSV admission/upload',
    metadata: { source: 'csv_upload_v1509' }
  }, { transaction });
  await student.update({ classId: targetClass.id, grade: targetClass.name, activeEnrollmentId: enrollment.id }, { transaction, hooks:false });
  return enrollment;
}


class CSVProcessor {
  constructor(schoolCode, userId, role = 'teacher') {
    this.schoolCode = schoolCode;
    this.userId = userId;
    this.role = String(role || 'teacher').toLowerCase();
  }

  async resolveUploadScope() {
    const classes = await Class.findAll({ where:{ schoolCode:this.schoolCode, isActive:true }, order:[['name','ASC']] });
    if (this.role === 'admin' || this.role === 'super_admin') return { classes, teacher:null, fixedClass:null };
    const teacher = await Teacher.findOne({ where:{ userId:this.userId } });
    if (!teacher) throw new Error('Teacher record not found.');
    const fixedClass = await Class.findOne({ where:{ schoolCode:this.schoolCode, isActive:true, [Op.or]:[{ teacherId:teacher.id }, ...(teacher.classId ? [{ id:teacher.classId }] : [])] } });
    if (!fixedClass) throw new Error('Only an assigned class teacher can upload students.');
    return { classes, teacher, fixedClass };
  }

  resolveRowClass(row, scope) {
    if (scope.fixedClass) return scope.fixedClass;
    const classId = Number(value(row,'classId','class_id')) || null;
    const className = normal(value(row,'class','className','class_name','grade'));
    const stream = normal(value(row,'stream'));
    let matches = scope.classes.filter(cls => {
      if (classId && Number(cls.id) === classId) return true;
      const names = [cls.name, cls.grade, cls.levelLabel, [cls.grade,cls.stream].filter(Boolean).join(' '), [cls.name,cls.stream].filter(Boolean).join(' ')].map(normal).filter(Boolean);
      if (!className) return false;
      const nameMatch = names.includes(className) || names.some(name => name === normal(`${className} ${stream}`));
      const streamMatch = !stream || normal(cls.stream) === stream || names.some(name => name.includes(stream));
      return nameMatch && streamMatch;
    });
    if (classId && !matches.length) throw new Error(`Class ID ${classId} does not exist in this school.`);
    if (!classId && !className) throw new Error('Admin uploads must include classId or class/grade for every learner.');
    if (!matches.length) throw new Error(`No active school class matches “${value(row,'class','className','grade')}${stream ? ` ${stream}` : ''}”.`);
    if (matches.length > 1) {
      const exactStream = matches.filter(cls => !stream || normal(cls.stream) === stream);
      if (exactStream.length === 1) return exactStream[0];
      throw new Error(`Class is ambiguous. Add classId or a valid stream for “${value(row,'class','className','grade')}”.`);
    }
    return matches[0];
  }

  async findDuplicate(row, name, dob, parentEmail, parentPhone, transaction) {
    const assessmentNumber = value(row,'assessmentNumber','assessment_number');
    const nemisNumber = value(row,'nemisNumber','nemis_number');
    const admissionNumber = value(row,'admissionNumber','admission_number','admissionNo');
    const where = { [Op.or]:[] };
    if (assessmentNumber) where[Op.or].push({ assessmentNumber });
    if (nemisNumber) where[Op.or].push({ nemisNumber });
    if (admissionNumber) where[Op.or].push({ admissionNumber });
    if (where[Op.or].length) {
      const exact = await Student.unscoped().findOne({ where, include:[{ model:User, where:{schoolCode:this.schoolCode,role:'student'}, attributes:['id','name'] }], transaction });
      if (exact) return exact;
    }
    const candidates = await Student.unscoped().findAll({
      where:{ ...(dob ? { dateOfBirth:{ [Op.between]:[new Date(dob.getTime()-43200000),new Date(dob.getTime()+43200000)] } } : {}) },
      include:[{ model:User, where:{ schoolCode:this.schoolCode, role:'student', name:{[Op.iLike]:name} }, attributes:['id','name'] }],
      transaction,
      limit:20
    });
    return candidates.find(student => {
      const emailMatch = parentEmail && normal(student.parentEmail) === normal(parentEmail);
      const phoneMatch = parentPhone && normalPhone(student.parentPhone) === parentPhone;
      return (!parentEmail && !parentPhone) || emailMatch || phoneMatch;
    }) || null;
  }

  async linkParent(student, name, parentName, parentEmail, parentPhone, relationship, transaction) {
    if (!parentEmail && !parentPhone) return null;
    let parentUser = null;
    if (parentEmail) parentUser = await User.findOne({ where:{ email:parentEmail }, transaction });
    if (!parentUser && parentPhone) parentUser = await User.findOne({ where:{ role:'parent', schoolCode:this.schoolCode, phone:parentPhone }, transaction });
    if (parentUser && (parentUser.role !== 'parent' || parentUser.schoolCode !== this.schoolCode)) throw new Error('The parent email is already registered to another account or school.');
    let parent = parentUser ? await Parent.findOne({ where:{ userId:parentUser.id }, transaction }) : null;
    if (!parentUser) {
      parentUser = await User.create({
        name: parentName || `Parent of ${name}`,
        email: parentEmail || null,
        phone: parentPhone,
        password: generateTemporaryPassword(),
        role:'parent', schoolCode:this.schoolCode, isActive:true, firstLogin:true, mustChangePassword:true, passwordIssuedAt:new Date()
      },{transaction});
      parent = await Parent.create({ userId:parentUser.id, relationship:['father','mother','guardian','other'].includes(normal(relationship)) ? normal(relationship) : 'guardian' },{transaction});
    } else {
      if (!parent) parent = await Parent.create({ userId:parentUser.id, relationship:'guardian' },{transaction});
      const updates={}; if(parentPhone&&!parentUser.phone)updates.phone=parentPhone; if(parentEmail&&!parentUser.email)updates.email=parentEmail; if(Object.keys(updates).length)await parentUser.update(updates,{transaction});
    }
    const linkCount = await StudentParent.count({ where:{ studentId:student.id }, transaction });
    const exists = await StudentParent.findOne({ where:{ studentId:student.id,parentId:parent.id }, transaction });
    if (!exists && linkCount >= 2) throw new Error('This learner already has the maximum of two linked parent/guardian accounts.');
    if (!exists) await StudentParent.create({ studentId:student.id,parentId:parent.id },{transaction});
    return parent;
  }

  async processStudentUpload(filePath) {
    const rows=[];
    await new Promise((resolve,reject)=>fs.createReadStream(filePath).pipe(csv()).on('data',row=>rows.push(row)).on('end',resolve).on('error',reject));
    const scope=await this.resolveUploadScope();
    const errors=[],warnings=[],createdRows=[],classSummary={};
    let created=0,updated=0,failed=0;
    for (let index=0; index<rows.length; index++) {
      const row=rows[index];
      const transaction=await sequelize.transaction();
      try {
        const name=value(row,'name','fullName','studentName');
        if(!name)throw new Error('Missing learner name.');
        const targetClass=this.resolveRowClass(row,scope);
        const dobValue=value(row,'dateOfBirth','dob');
        const dob=parseDate(dobValue); if(dobValue&&!dob)throw new Error('Invalid date of birth. Use YYYY-MM-DD.');
        const parentEmail=normal(value(row,'parentEmail','parent_email'))||null;
        const parentPhone=normalPhone(value(row,'parentPhone','parent_phone'));
        const duplicate=await this.findDuplicate(row,name,dob,parentEmail,parentPhone,transaction);
        if(duplicate)throw new Error(`Duplicate learner detected (${duplicate.elimuid || duplicate.id}).`);
        const user=await User.create({ name, email:null, phone:null, password:generateTemporaryPassword(), role:'student', schoolCode:this.schoolCode, isActive:true, firstLogin:true },{transaction});
        const student=await Student.create({
          userId:user.id,
          schoolCode:this.schoolCode,
          classId:targetClass.id,
          grade:targetClass.name,
          curriculum:targetClass.curriculum || undefined,
          admissionNumber:value(row,'admissionNumber','admission_number','admissionNo')||null,
          dateOfBirth:dob,
          gender:normalGender(value(row,'gender')),
          assessmentNumber:value(row,'assessmentNumber','assessment_number')||null,
          nemisNumber:value(row,'nemisNumber','nemis_number')||null,
          location:value(row,'location')||null,
          parentName:value(row,'parentName','parent_name')||null,
          parentEmail,
          parentPhone,
          parentRelationship:value(row,'parentRelationship','relationship')||'guardian',
          isPrefect:['true','yes','1'].includes(normal(value(row,'isPrefect','is_prefect'))),
          status:'active'
        },{transaction});
        await createActiveEnrollmentForStudent({ student, targetClass, schoolCode:this.schoolCode, actorId:this.userId, transaction });
        await this.linkParent(student,name,value(row,'parentName','parent_name'),parentEmail,parentPhone,value(row,'parentRelationship','relationship'),transaction);
        await transaction.commit();
        created++; classSummary[targetClass.name]=(classSummary[targetClass.name]||0)+1;
        createdRows.push({row:index+2,name,studentId:student.id,elimuid:student.elimuid,classId:targetClass.id,className:targetClass.name});
      } catch(error) {
        if(!transaction.finished)await transaction.rollback(); failed++; errors.push({row:index+2,name:value(row,'name','fullName','studentName')||'',class:value(row,'class','className','grade')||'',error:error.message});
      }
    }
    if (this.role === 'admin' && Object.keys(classSummary).length > 1) warnings.push(`Mixed-class file split safely across ${Object.keys(classSummary).length} classes.`);
    return { stats:{processed:rows.length,created,updated,failed}, classSummary, createdRows, errors, warnings };
  }

  async processMarksUpload(filePath) {
    const results = [], errors = []; let created = 0, failed = 0;
    const teacher = await Teacher.findOne({ where:{ userId:this.userId } }); if(!teacher)throw new Error('Teacher not found');
    await new Promise((resolve,reject)=>fs.createReadStream(filePath).pipe(csv()).on('data',data=>results.push(data)).on('end',resolve).on('error',reject));
    for(const row of results){try{const elimuid=value(row,'elimuid');const subject=value(row,'subject');const score=Number(value(row,'score'));if(!elimuid||!subject||!Number.isFinite(score)||score<0||score>100)throw new Error('Valid elimuid, subject and score (0–100) are required');const student=await Student.unscoped().findOne({where:{elimuid},include:[{model:User,where:{schoolCode:this.schoolCode}}]});if(!student)throw new Error('Student not found');await AcademicRecord.create({studentId:student.id,schoolCode:this.schoolCode,term:value(row,'term')||'Term 1',year:Number(value(row,'year'))||new Date().getFullYear(),subject,assessmentType:value(row,'assessmentType')||'test',assessmentName:value(row,'assessmentName')||`${subject} assessment`,score,teacherId:teacher.id,date:parseDate(value(row,'date'))||new Date(),isPublished:false,status:'draft'});created++;}catch(error){failed++;errors.push({row,error:error.message});}}
    return {stats:{processed:results.length,created,failed},errors};
  }

  async processAttendanceUpload(filePath) {
    const results=[],errors=[];let created=0,failed=0;
    await new Promise((resolve,reject)=>fs.createReadStream(filePath).pipe(csv()).on('data',data=>results.push(data)).on('end',resolve).on('error',reject));
    for(const row of results){try{const elimuid=value(row,'elimuid');const status=normal(value(row,'status'));if(!elimuid||!['present','absent','late','excused'].includes(status))throw new Error('Valid elimuid and attendance status are required');const student=await Student.unscoped().findOne({where:{elimuid},include:[{model:User,where:{schoolCode:this.schoolCode}}]});if(!student)throw new Error('Student not found');const date=parseDate(value(row,'date'))||new Date();const [attendance,wasCreated]=await Attendance.findOrCreate({where:{studentId:student.id,date},defaults:{studentId:student.id,schoolCode:this.schoolCode,date,status,reason:value(row,'reason')||null,reportedBy:this.userId}});if(!wasCreated)throw new Error('Attendance already exists for this learner and date. Use the controlled correction workflow after final submission.');created++;}catch(error){failed++;errors.push({row,error:error.message});}}
    return {stats:{processed:results.length,created,failed},errors};
  }
}
module.exports = CSVProcessor;
