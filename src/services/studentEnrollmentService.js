const { Op } = require('sequelize');
const {
  Student, User, Class, Teacher, TeacherSubjectAssignment, Parent, StudentParent, StudentEnrollment,
  ClassTransferRequest, Fee, FeeStructure, Attendance, AcademicRecord,
  ReportSnapshot, AuditLog
} = require('../models');
const realtime = require('./realtimeService');
const { createAlert } = require('./notificationService');

const TERMS = new Set(['Term 1','Term 2','Term 3']);
const FEE_ACTIONS = new Set(['keep_current_period','apply_next_period','create_adjustment']);
const OPEN_TRANSFER_STATUSES = ['pending','approved','scheduled'];

function isoToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function validDate(value){ const raw=String(value||''); if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return false; const date=new Date(`${raw}T00:00:00Z`); return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===raw; }
function dayBefore(value){ const d=new Date(`${value}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10); }
function normalizeTerm(value){ const t=String(value||'').trim().replace(/^term\s*/i,'Term '); return TERMS.has(t)?t:null; }
function nextPeriod(term,year){ if(term==='Term 1')return {term:'Term 2',year};if(term==='Term 2')return {term:'Term 3',year};return {term:'Term 1',year:Number(year)+1}; }
function money(value){ const n=Math.round(Number(value||0));return Number.isFinite(n)?n:0; }
function publicClass(cls){ return cls?{id:cls.id,name:cls.name,grade:cls.grade,stream:cls.stream,curriculum:cls.curriculum,levelCode:cls.levelCode}:null; }
function normalizeClassText(value){ return String(value||'').trim().toLowerCase().replace(/\s+/g,' '); }
function gradeVariants(value){
  const raw=normalizeClassText(value); if(!raw)return [];
  const out=new Set([raw, raw.replace(/\s+/g,'')]);
  const spaced=raw.replace(/^(pp|grade|form)(\d+)/i,'$1 $2').replace(/(\d+)([a-z])$/i,'$1 $2');
  out.add(spaced); out.add(spaced.replace(/\s+/g,''));
  const m=raw.match(/^(?:grade\s*)?(\d{1,2})([a-z])$/i); if(m){out.add(`grade ${m[1]} ${m[2]}`); out.add(`grade ${m[1]}${m[2]}`);}
  return [...out];
}
async function resolveSafeClassByGrade(schoolCode, grade, transaction){
  const variants=gradeVariants(grade); if(!variants.length)return null;
  const classes=await Class.findAll({where:{schoolCode,isActive:true},order:[['id','ASC']],transaction}).catch(()=>[]);
  let matches=classes.filter(c=>variants.includes(normalizeClassText(c.name))||variants.includes(String(c.name||'').toLowerCase().replace(/\s+/g,'')));
  if(matches.length===1)return matches[0];
  matches=classes.filter(c=>c.stream&&variants.includes(normalizeClassText(`${c.grade||''} ${c.stream||''}`)));
  if(matches.length===1)return matches[0];
  matches=classes.filter(c=>variants.includes(normalizeClassText(c.grade))||variants.includes(String(c.grade||'').toLowerCase().replace(/\s+/g,'')));
  if(matches.length===1)return matches[0];
  return null;
}
async function classTeacherIdsForClass({cls,schoolCode,transaction}){
  if(!cls)return [];
  const ids=[];
  const add=value=>{const id=Number(value);if(Number.isInteger(id)&&!ids.includes(id))ids.push(id);};
  add(cls.teacherId);
  for(const assignment of (Array.isArray(cls.subjectTeachers)?cls.subjectTeachers:[])){
    if(assignment?.isClassTeacher===true||String(assignment?.role||'').toLowerCase()==='class_teacher')add(assignment.teacherId);
  }
  // Classes.teacherId (or an explicitly marked JSON assignment) is the primary
  // canonical owner. Query legacy storage only when that owner is absent.
  if(ids.length)return ids;
  const [profileRows,assignmentRows]=await Promise.all([
    Teacher.findAll({where:{classId:cls.id},include:[{model:User,where:{schoolCode,role:'teacher'},attributes:[],required:true}],attributes:['id'],transaction}).catch(()=>[]),
    TeacherSubjectAssignment.findAll({where:{classId:cls.id,isClassTeacher:true},attributes:['teacherId'],transaction}).catch(()=>[])
  ]);
  profileRows.forEach(row=>add(row.id));
  assignmentRows.forEach(row=>add(row.teacherId));
  if(!ids.length&&cls.name){
    const legacy=await Teacher.findAll({where:{classTeacher:cls.name},include:[{model:User,where:{schoolCode,role:'teacher'},attributes:[],required:true}],attributes:['id'],transaction}).catch(()=>[]);
    legacy.forEach(row=>add(row.id));
  }
  return ids;
}
async function primaryClassTeacherId({cls,schoolCode,transaction}){
  return (await classTeacherIdsForClass({cls,schoolCode,transaction}))[0]||null;
}
function structureMatchesClass(structure,classId){
  const id=Number(classId);
  if(Number(structure.classId)===id)return true;
  if(Array.isArray(structure.classIds)&&structure.classIds.some(v=>Number(v)===id))return true;
  if(Array.isArray(structure.assignedClasses)&&structure.assignedClasses.some(v=>Number(v?.id||v?.classId)===id))return true;
  return false;
}

async function findStudentInSchool({schoolCode,studentId,transaction,lock=false}){
  return (Student.unscoped?Student.unscoped():Student).findOne({
    where:{id:Number(studentId)},
    include:[{model:User,where:{schoolCode,role:'student'},attributes:['id','name','email','phone','schoolCode']}],
    transaction,
    lock:lock&&transaction?transaction.LOCK.UPDATE:undefined
  });
}

async function ensureCurrentEnrollment({student,schoolCode,academicYear,term,actorId,transaction}){
  let rows=await StudentEnrollment.findAll({where:{schoolCode,studentId:student.id,status:'active'},order:[['effectiveFrom','DESC'],['id','DESC']],transaction,lock:transaction?.LOCK?.UPDATE});
  if(rows.length>1){
    const keeper=rows[0];
    for(const duplicate of rows.slice(1)){const closeDate=dayBefore(keeper.effectiveFrom)<String(duplicate.effectiveFrom)?String(duplicate.effectiveFrom):dayBefore(keeper.effectiveFrom);await duplicate.update({status:'closed',effectiveTo:closeDate,endTerm:duplicate.endTerm||term||null,endedReason:'duplicate_active_enrollment_cleanup',closedBy:actorId,movementType:'data_cleanup',movementReason:'Resolved multiple active enrolments',version:Number(duplicate.version||1)+1,metadata:{...(duplicate.metadata||{}),v1484Cleanup:true}},{transaction,hooks:false});}
    rows=[keeper];
  }
  let row=rows[0]||null;
  if(!row){
    let currentClass=student.classId?await Class.findOne({where:{id:student.classId,schoolCode},transaction}):null;
    if(!currentClass && student.grade) currentClass=await resolveSafeClassByGrade(schoolCode, student.grade, transaction);
    const currentClassTeacherId=await primaryClassTeacherId({cls:currentClass,schoolCode,transaction});
    row=await StudentEnrollment.create({schoolCode,studentId:student.id,classId:currentClass?.id||student.classId||null,stream:currentClass?.stream||null,academicYear:Number(academicYear),status:'active',effectiveFrom:student.enrollmentDate?new Date(student.enrollmentDate).toISOString().slice(0,10):`${academicYear}-01-01`,startTerm:term||null,classTeacherIdAtStart:currentClassTeacherId,createdBy:actorId,movementType:'admission_migration',movementReason:'Created from current student class pointer or safe grade match',metadata:{migratedFromStudent:true,resolvedFromGrade:!student.classId&&!!currentClass}},{transaction});
  }
  if(Number(student.activeEnrollmentId)!==Number(row.id) || (!student.classId && row.classId))await student.update({activeEnrollmentId:row.id,classId:row.classId||student.classId,grade:row.classId?(await Class.findByPk(row.classId,{transaction}))?.name||student.grade:student.grade},{transaction,hooks:false});
  return row;
}

async function getFeeStructure({schoolCode,classId,term,year,transaction}){
  const rows=await FeeStructure.findAll({where:{schoolCode,term,year:Number(year),status:{[Op.in]:['active','locked']}},order:[['status','DESC'],['updatedAt','DESC']],transaction});
  return rows.find(row=>structureMatchesClass(row,classId))||null;
}

async function buildFeePreview({schoolCode,studentId,fromClassId,toClassId,term,academicYear,transaction}){
  const [oldStructure,newStructure,currentFee]=await Promise.all([
    getFeeStructure({schoolCode,classId:fromClassId,term,year:academicYear,transaction}),
    getFeeStructure({schoolCode,classId:toClassId,term,year:academicYear,transaction}),
    Fee.findOne({where:{schoolCode,studentId:Number(studentId),term,year:Number(academicYear)},transaction})
  ]);
  const oldAmount=money(oldStructure?.totalAmount||currentFee?.totalAmount);
  const newAmount=money(newStructure?.totalAmount);
  return {
    term,year:Number(academicYear),
    currentFeeAccount:currentFee?{id:currentFee.id,totalAmount:money(currentFee.totalAmount),paidAmount:money(currentFee.parentPaidAmount??currentFee.paidAmount),creditAmount:money(currentFee.creditAmount),status:currentFee.status,classId:currentFee.classId}:null,
    fromStructure:oldStructure?{id:oldStructure.id,name:oldStructure.name,totalAmount:oldAmount,classId:oldStructure.classId}:null,
    toStructure:newStructure?{id:newStructure.id,name:newStructure.name,totalAmount:newAmount,classId:newStructure.classId}:null,
    difference:newAmount-oldAmount,
    requiresChoice:!!currentFee&&!!newStructure&&newAmount!==money(currentFee.totalAmount),
    message:!newStructure?'No active target-class fee structure exists for this period. Existing fees will remain unchanged.':newAmount===oldAmount?'The target class has the same fee amount for this period.':`Target-class fee difference: KES ${(newAmount-oldAmount).toLocaleString()}.`
  };
}

async function buildImpactPreview({schoolCode,student,currentEnrollment,effectiveDate,academicYear,term,transaction}){
  const today=isoToday();
  const isBackdated=effectiveDate<today;
  const isEffectiveToday=effectiveDate===today;
  const affectsExistingPeriod=effectiveDate<=today;
  let attendanceCount=0,academicRecordCount=0,publishedReportCount=0;
  if(affectsExistingPeriod){
    [attendanceCount,academicRecordCount,publishedReportCount]=await Promise.all([
      Attendance.count({where:{schoolCode,studentId:student.id,classId:currentEnrollment.classId,date:{[Op.gte]:effectiveDate}},transaction}),
      (AcademicRecord.unscoped?AcademicRecord.unscoped():AcademicRecord).count({where:{schoolCode,studentId:student.id,classId:currentEnrollment.classId,year:Number(academicYear),term,date:{[Op.gte]:new Date(`${effectiveDate}T00:00:00Z`)}},transaction}),
      ReportSnapshot.count({where:{schoolCode,studentId:student.id,classId:currentEnrollment.classId,year:Number(academicYear),term,status:'published'},transaction})
    ]);
  }
  return {isBackdated,isEffectiveToday,affectsExistingPeriod,attendanceCount,academicRecordCount,publishedReportCount,requiresAcknowledgement:affectsExistingPeriod&&(attendanceCount>0||academicRecordCount>0||publishedReportCount>0)};
}

async function assertTeacherOwnsCurrentClass({userId,student,schoolCode,transaction}){
  const teacher=await Teacher.findOne({where:{userId},transaction});
  if(!teacher)throw Object.assign(new Error('Teacher profile not found'),{status:403});
  const cls=await Class.findOne({where:{id:student.classId,schoolCode,isActive:true},transaction});
  if(!cls)throw Object.assign(new Error('The learner is not assigned to an active class'),{status:409});
  const classTeacherIds=await classTeacherIdsForClass({cls,schoolCode,transaction});
  if(!classTeacherIds.includes(Number(teacher.id)))throw Object.assign(new Error('Class teachers can request a transfer only for a learner in their assigned class'),{status:403});
  return {teacher,cls};
}

async function validateMovement({schoolCode,studentId,toClassId,effectiveDate,academicYear,term,reason,feeAction='keep_current_period',actor,transaction,allowExistingRequestId=null}){
  if(!schoolCode)throw Object.assign(new Error('School scope is required'),{status:400});
  const normalizedTerm=normalizeTerm(term);
  if(!normalizedTerm)throw Object.assign(new Error('Term must be Term 1, Term 2, or Term 3'),{status:400});
  if(!validDate(effectiveDate))throw Object.assign(new Error('A valid effective date is required'),{status:400});
  const year=Number(academicYear);
  if(!Number.isInteger(year)||year<2000||year>2200)throw Object.assign(new Error('A valid academic year is required'),{status:400});
  if(Number(String(effectiveDate).slice(0,4))!==year)throw Object.assign(new Error('Effective date must fall inside the selected academic year'),{status:400});
  const cleanReason=String(reason||'').trim();
  if(!cleanReason)throw Object.assign(new Error('Transfer reason is required'),{status:400});
  if(cleanReason.length>120)throw Object.assign(new Error('Transfer reason must be 120 characters or fewer'),{status:400});
  if(!FEE_ACTIONS.has(String(feeAction)))throw Object.assign(new Error('Invalid fee handling choice'),{status:400});

  const student=await findStudentInSchool({schoolCode,studentId,transaction,lock:true});
  if(!student)throw Object.assign(new Error('Student not found in this school'),{status:404});
  if(student.status!=='active')throw Object.assign(new Error('Only an active student can be transferred between classes'),{status:409});
  const current=await ensureCurrentEnrollment({student,schoolCode,academicYear:year,term:normalizedTerm,actorId:actor.id,transaction});
  if(!current.classId)throw Object.assign(new Error('Student has no current class enrollment'),{status:409});
  if(String(effectiveDate)<=String(current.effectiveFrom))throw Object.assign(new Error(`Effective date must be after the current enrollment start date (${current.effectiveFrom})`),{status:409});
  const [fromClass,toClass]=await Promise.all([
    Class.findOne({where:{id:current.classId,schoolCode},transaction}),
    Class.findOne({where:{id:Number(toClassId),schoolCode,isActive:true},transaction})
  ]);
  if(!fromClass)throw Object.assign(new Error('Current class was not found'),{status:409});
  if(!toClass)throw Object.assign(new Error('Target class is not active in this school'),{status:404});
  if(Number(fromClass.id)===Number(toClass.id))throw Object.assign(new Error('Student is already active in the selected target class'),{status:409});

  if(actor.role==='teacher')await assertTeacherOwnsCurrentClass({userId:actor.id,student,schoolCode,transaction});

  const openWhere={schoolCode,studentId:student.id,status:{[Op.in]:OPEN_TRANSFER_STATUSES}};
  if(allowExistingRequestId)openWhere.id={[Op.ne]:Number(allowExistingRequestId)};
  const existingRequest=await ClassTransferRequest.findOne({where:openWhere,transaction,lock:transaction?.LOCK?.UPDATE});
  if(existingRequest)throw Object.assign(new Error(`This student already has an open class movement request (#${existingRequest.id})`),{status:409,data:{requestId:existingRequest.id}});

  const [feePreview,impactPreview]=await Promise.all([
    buildFeePreview({schoolCode,studentId:student.id,fromClassId:fromClass.id,toClassId:toClass.id,term:normalizedTerm,academicYear:year,transaction}),
    buildImpactPreview({schoolCode,student,currentEnrollment:current,effectiveDate,academicYear:year,term:normalizedTerm,transaction})
  ]);
  return {student,currentEnrollment:current,fromClass,toClass,term:normalizedTerm,academicYear:year,effectiveDate:String(effectiveDate),reason:cleanReason,feeAction:String(feeAction),feePreview,impactPreview};
}

async function ensureFeeAccount({schoolCode,studentId,classId,term,year,actorId,transaction,reconcileExisting=false,source='class_movement'}){
  const structure=await getFeeStructure({schoolCode,classId,term,year,transaction});
  if(!structure)return {created:false,changed:false,reason:'target_structure_missing'};
  let fee=await Fee.findOne({where:{schoolCode,studentId,term,year:Number(year)},transaction,lock:transaction.LOCK.UPDATE});
  if(fee){
    if(!reconcileExisting)return {created:false,changed:false,fee,structure};
    const before={totalAmount:money(fee.totalAmount),classId:fee.classId||null,feeStructureId:fee.feeStructureId||null,dueDate:fee.dueDate||null,currency:fee.currency||'KES',status:fee.status};
    const covered=money(fee.parentPaidAmount??fee.paidAmount)+money(fee.creditAmount);
    const target=Math.max(covered,money(structure.totalAmount));
    const changed=Number(fee.classId)!==Number(classId)||Number(fee.feeStructureId||0)!==Number(structure.id)||money(fee.totalAmount)!==target;
    if(changed){
      const auditTrail=[...(Array.isArray(fee.auditTrail)?fee.auditTrail:[]),{action:`${source}_fee_period_reconciled`,actorId,at:new Date().toISOString(),before,target,classId,structureId:structure.id}];
      await fee.update({classId,totalAmount:target,feeStructureId:Number(structure.id),dueDate:structure.dueDate,currency:structure.currency||fee.currency,status:covered>=target&&target>0?'paid':covered>0?'partial':'unpaid',auditTrail},{transaction});
    }
    return {created:false,changed,fee,structure,before,target};
  }
  fee=await Fee.create({studentId,schoolCode,term,year:Number(year),totalAmount:money(structure.totalAmount),paidAmount:0,parentPaidAmount:0,creditAmount:0,status:'unpaid',dueDate:structure.dueDate,feeStructureId:Number(structure.id),classId,currency:structure.currency||'KES',locked:structure.status==='locked',auditTrail:[{action:`created_after_${source}`,actorId,at:new Date().toISOString(),structureId:structure.id}]},{transaction});
  return {created:true,changed:true,fee,structure,before:null,target:money(structure.totalAmount)};
}

async function applyFeeAction({request,student,transaction}){
  const action=String(request.feeAction||'keep_current_period');
  const result={action,changed:false};
  const actorId=request.appliedBy||request.approvedBy||request.requestedBy;
  if(action==='keep_current_period')return result;
  if(action==='apply_next_period'){
    const next=nextPeriod(request.term,request.academicYear);
    const ensured=await ensureFeeAccount({schoolCode:request.schoolCode,studentId:student.id,classId:request.toClassId,term:next.term,year:next.year,actorId,transaction,reconcileExisting:true,source:'class_transfer_next_period'});
    return {...result,changed:!!ensured.changed,created:!!ensured.created,nextPeriod:next,feeId:ensured.fee?.id||null,reason:ensured.reason||null,before:ensured.before||null,target:ensured.target??null};
  }
  if(action==='create_adjustment'){
    const structure=await getFeeStructure({schoolCode:request.schoolCode,classId:request.toClassId,term:request.term,year:request.academicYear,transaction});
    if(!structure)return {...result,reason:'target_structure_missing'};
    let fee=await Fee.findOne({where:{schoolCode:request.schoolCode,studentId:student.id,term:request.term,year:request.academicYear},transaction,lock:transaction.LOCK.UPDATE});
    if(!fee){
      const ensured=await ensureFeeAccount({schoolCode:request.schoolCode,studentId:student.id,classId:request.toClassId,term:request.term,year:request.academicYear,actorId,transaction,reconcileExisting:true,source:'class_transfer_adjustment'});
      return {...result,changed:!!ensured.changed,feeId:ensured.fee?.id||null,created:!!ensured.created,before:ensured.before||null,target:ensured.target??null,reason:ensured.reason||null};
    }
    const before={totalAmount:money(fee.totalAmount),classId:fee.classId||null,feeStructureId:fee.feeStructureId||null,dueDate:fee.dueDate||null,currency:fee.currency||'KES',status:fee.status};
    const covered=money(fee.parentPaidAmount??fee.paidAmount)+money(fee.creditAmount),target=Math.max(covered,money(structure.totalAmount));
    const adjustments=Array.isArray(fee.adjustments)?fee.adjustments:[];
    adjustments.push({type:'class_transfer_fee_adjustment',requestId:request.id,before:before.totalAmount,target,difference:target-before.totalAmount,actorId,at:new Date().toISOString()});
    const status=covered>=target&&target>0?'paid':covered>0?'partial':'unpaid';
    await fee.update({totalAmount:target,classId:request.toClassId,feeStructureId:Number(structure.id),dueDate:structure.dueDate,currency:structure.currency||fee.currency,adjustments,status,auditTrail:[...(Array.isArray(fee.auditTrail)?fee.auditTrail:[]),{action:'class_transfer_fee_adjustment',requestId:request.id,before,target,actorId,at:new Date().toISOString()}]},{transaction});
    return {...result,changed:target!==before.totalAmount||Number(before.classId)!==Number(request.toClassId),feeId:fee.id,created:false,before,target,difference:target-before.totalAmount};
  }
  return result;
}

async function movementRecipients({schoolCode,student,fromClass,toClass,transaction}){
  const parentLinks=await StudentParent.findAll({where:{studentId:student.id},attributes:['parentId'],transaction});
  const parentRows=parentLinks.length?await Parent.findAll({where:{id:{[Op.in]:parentLinks.map(x=>x.parentId)}},attributes:['userId'],transaction}):[];
  const teacherIds=[
    ...(await classTeacherIdsForClass({cls:fromClass,schoolCode,transaction})),
    ...(await classTeacherIdsForClass({cls:toClass,schoolCode,transaction}))
  ];
  const uniqueTeacherIds=[...new Set(teacherIds.map(Number).filter(Number.isInteger))];
  const teachers=uniqueTeacherIds.length?await Teacher.findAll({where:{id:{[Op.in]:uniqueTeacherIds}},include:[{model:User,where:{schoolCode,role:'teacher'},attributes:['id','role'],required:true}],transaction}):[];
  const admins=await User.findAll({where:{schoolCode,role:'admin',isActive:true},attributes:['id','role'],transaction});
  return {
    studentUserId:student.userId,
    parentUserIds:[...new Set(parentRows.map(x=>Number(x.userId)).filter(Boolean))],
    teacherUserIds:[...new Set(teachers.map(x=>Number(x.User?.id)).filter(Boolean))],
    adminUserIds:[...new Set(admins.map(x=>Number(x.id)).filter(Boolean))]
  };
}

async function notifyMovement({request,student,fromClass,toClass,transaction}){
  const recipients=await movementRecipients({schoolCode:request.schoolCode,student,fromClass,toClass,transaction});
  const payload={schoolCode:request.schoolCode,requestId:request.id,studentId:student.id,fromClassId:fromClass.id,toClassId:toClass.id,fromClassName:fromClass.name,toClassName:toClass.name,effectiveDate:request.effectiveDate,academicYear:request.academicYear,term:request.term,status:request.status};
  const userIds=[recipients.studentUserId,...recipients.parentUserIds,...recipients.teacherUserIds,...recipients.adminUserIds].filter(Boolean);
  for(const userId of [...new Set(userIds)]){
    const role=userId===recipients.studentUserId?'student':recipients.parentUserIds.includes(userId)?'parent':recipients.teacherUserIds.includes(userId)?'teacher':'admin';
    await createAlert({userId,role,type:'academic',severity:'info',title:'Student class movement completed',message:`${student.User?.name||'Student'} moved from ${fromClass.name} to ${toClass.name}, effective ${request.effectiveDate}. Historical records remain in ${fromClass.name}.`,categoryLabel:'Student School Cycle',sourceType:'class_transfer',sourceLabel:'School Administration',studentId:student.id,classId:toClass.id,dedupeKey:`class-transfer-applied:${request.id}:${userId}`,actionUrl:'#student-lifecycle',data:payload,transaction});
  }
  await realtime.emitToClass(request.schoolCode,fromClass.id,'student:class_membership_changed',{...payload,action:'removed_from_current_class'},{transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  await realtime.emitToClass(request.schoolCode,toClass.id,'student:class_membership_changed',{...payload,action:'added_to_current_class'},{transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  await realtime.emitToStudentContext(request.schoolCode,student.id,'student:class_changed',payload,{transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  if(userIds.length)await realtime.emitToUsers([...new Set(userIds)],'student:class_changed',payload,{schoolCode:request.schoolCode,transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  await realtime.emitToSchool(request.schoolCode,'analytics:invalidated',{scope:'student_class_membership',studentId:student.id,fromClassId:fromClass.id,toClassId:toClass.id,requestId:request.id},{transaction});
}

async function applyRequest({requestId,actorId,actorRole='system',transaction}){
  const request=await ClassTransferRequest.findByPk(Number(requestId),{transaction,lock:transaction.LOCK.UPDATE});
  if(!request)throw Object.assign(new Error('Class transfer request not found'),{status:404});
  if(request.status==='applied')return request;
  if(!['approved','scheduled'].includes(request.status))throw Object.assign(new Error('Only an approved or scheduled request can be applied'),{status:409});
  if(request.effectiveDate>isoToday()){
    await request.update({status:'scheduled',version:Number(request.version||1)+1},{transaction});
    return request;
  }
  const student=await findStudentInSchool({schoolCode:request.schoolCode,studentId:request.studentId,transaction,lock:true});
  if(!student)throw Object.assign(new Error('Student no longer exists in this school'),{status:404});
  const active=await StudentEnrollment.findOne({where:{schoolCode:request.schoolCode,studentId:student.id,status:'active'},transaction,lock:transaction.LOCK.UPDATE});
  if(!active)throw Object.assign(new Error('Student has no active enrollment to close'),{status:409});
  if(Number(active.id)!==Number(request.fromEnrollmentId)||Number(active.classId)!==Number(request.fromClassId))throw Object.assign(new Error('Student class changed after this request was created. Create a fresh transfer preview.'),{status:409,code:'STALE_TRANSFER_REQUEST'});
  const [fromClass,toClass]=await Promise.all([
    Class.findOne({where:{id:request.fromClassId,schoolCode:request.schoolCode},transaction}),
    Class.findOne({where:{id:request.toClassId,schoolCode:request.schoolCode,isActive:true},transaction})
  ]);
  if(!fromClass||!toClass)throw Object.assign(new Error('Current or target class is unavailable'),{status:409});

  const [fromTeacherId,toTeacherId]=await Promise.all([
    primaryClassTeacherId({cls:fromClass,schoolCode:request.schoolCode,transaction}),
    primaryClassTeacherId({cls:toClass,schoolCode:request.schoolCode,transaction})
  ]);
  await active.update({status:'closed',effectiveTo:dayBefore(request.effectiveDate),endTerm:request.term,endedReason:'class_transfer',movementType:'class_transfer',movementReason:request.reason,movementRequestId:request.id,classTeacherIdAtEnd:fromTeacherId||active.classTeacherIdAtStart||null,closedBy:actorId,version:Number(active.version||1)+1,metadata:{...(active.metadata||{}),transferRequestId:request.id,toClassId:toClass.id,note:request.note||null}},{transaction,hooks:false});
  const created=await StudentEnrollment.create({schoolCode:request.schoolCode,studentId:student.id,classId:toClass.id,stream:toClass.stream||null,academicYear:request.academicYear,status:'active',effectiveFrom:request.effectiveDate,startTerm:request.term,createdBy:actorId,movementType:'class_transfer',movementReason:request.reason,movementRequestId:request.id,previousEnrollmentId:active.id,classTeacherIdAtStart:toTeacherId,metadata:{transferRequestId:request.id,fromClassId:fromClass.id,note:request.note||null}},{transaction});
  await student.update({classId:toClass.id,grade:toClass.name,activeEnrollmentId:created.id,status:'active'},{transaction,hooks:false});
  await request.update({status:'applied',appliedBy:actorId,appliedAt:new Date(),appliedEnrollmentId:created.id,version:Number(request.version||1)+1},{transaction});
  const feeResult=await applyFeeAction({request,student,transaction});
  await request.update({metadata:{...(request.metadata||{}),feeResult}},{transaction});
  await AuditLog.create({schoolCode:request.schoolCode,actorUserId:actorId,actorRole,module:'student_lifecycle',action:'class_transfer_applied',entityType:'ClassTransferRequest',entityId:String(request.id),before:{classId:fromClass.id,enrollmentId:active.id},after:{classId:toClass.id,enrollmentId:created.id},reason:request.reason,metadata:{effectiveDate:request.effectiveDate,term:request.term,academicYear:request.academicYear,feeAction:request.feeAction,feeResult}},{transaction});
  await notifyMovement({request,student,fromClass,toClass,transaction});
  return request;
}


async function applyDirectMovement({schoolCode,studentId,toClassId,effectiveDate,academicYear,term,movementType='promotion',reason,note=null,actorId,actorRole='admin',sourceId,transaction,createTargetFeeAccount=false}){
  const normalizedTerm=normalizeTerm(term)||'Term 1';
  const student=await findStudentInSchool({schoolCode,studentId,transaction,lock:true});
  if(!student)throw Object.assign(new Error('Student not found in this school'),{status:404});
  const active=await ensureCurrentEnrollment({student,schoolCode,academicYear:Number(academicYear),term:normalizedTerm,actorId,transaction});
  const openTransfer=await ClassTransferRequest.findOne({where:{schoolCode,studentId:student.id,status:{[Op.in]:OPEN_TRANSFER_STATUSES}},transaction,lock:transaction.LOCK.UPDATE});
  if(openTransfer)throw Object.assign(new Error(`Open class transfer request #${openTransfer.id} must be resolved before this movement`),{status:409,code:'OPEN_CLASS_TRANSFER'});
  const [fromClass,toClass]=await Promise.all([
    Class.findOne({where:{id:active.classId,schoolCode},transaction}),
    Class.findOne({where:{id:Number(toClassId),schoolCode,isActive:true},transaction})
  ]);
  if(!fromClass||!toClass)throw Object.assign(new Error('Current or target class is unavailable'),{status:409});
  if(active.effectiveFrom>=effectiveDate)throw Object.assign(new Error('Movement date must be after the active enrollment start date'),{status:409});
  const [fromTeacherId,toTeacherId]=await Promise.all([
    primaryClassTeacherId({cls:fromClass,schoolCode,transaction}),
    primaryClassTeacherId({cls:toClass,schoolCode,transaction})
  ]);
  await active.update({status:'closed',effectiveTo:dayBefore(effectiveDate),endTerm:normalizedTerm,endedReason:movementType,movementType,movementReason:reason,classTeacherIdAtEnd:fromTeacherId||active.classTeacherIdAtStart||null,closedBy:actorId,version:Number(active.version||1)+1,metadata:{...(active.metadata||{}),movementSourceId:sourceId,toClassId:toClass.id,note}},{transaction,hooks:false});
  const created=await StudentEnrollment.create({schoolCode,studentId:student.id,classId:toClass.id,stream:toClass.stream||null,academicYear:Number(academicYear),status:'active',effectiveFrom:effectiveDate,startTerm:normalizedTerm,createdBy:actorId,movementType,movementReason:reason,previousEnrollmentId:active.id,classTeacherIdAtStart:toTeacherId,metadata:{movementSourceId:sourceId,fromClassId:fromClass.id,note}},{transaction});
  await student.update({classId:toClass.id,grade:toClass.name,activeEnrollmentId:created.id,status:'active'},{transaction,hooks:false});
  let feeResult=null;
  if(createTargetFeeAccount)feeResult=await ensureFeeAccount({schoolCode,studentId:student.id,classId:toClass.id,term:normalizedTerm,year:Number(academicYear),actorId,transaction,reconcileExisting:true,source:'promotion'});
  const synthetic={id:String(sourceId||created.id),schoolCode,studentId:student.id,fromClassId:fromClass.id,toClassId:toClass.id,academicYear:Number(academicYear),term:normalizedTerm,effectiveDate,status:'applied',version:1,reason,note,feeAction:createTargetFeeAccount?'create_target_period':'keep_current_period'};
  await AuditLog.create({schoolCode,actorUserId:actorId,actorRole,module:'student_lifecycle',action:`${movementType}_applied`,entityType:'StudentEnrollment',entityId:String(created.id),before:{classId:fromClass.id,enrollmentId:active.id},after:{classId:toClass.id,enrollmentId:created.id},reason,metadata:{sourceId,effectiveDate,term:normalizedTerm,academicYear:Number(academicYear),feeAccountId:feeResult?.fee?.id||null}},{transaction});
  await notifyMovement({request:synthetic,student,fromClass,toClass,transaction});
  return {student,previousEnrollment:active,enrollment:created,fromClass,toClass,feeResult};
}

async function rollbackRequest({requestId,actor,reason,transaction}){
  const request=await ClassTransferRequest.findByPk(Number(requestId),{transaction,lock:transaction.LOCK.UPDATE});
  if(!request||request.status!=='applied')throw Object.assign(new Error('Only an applied class transfer can be rolled back'),{status:409});
  if(!String(reason||'').trim())throw Object.assign(new Error('Rollback reason is required'),{status:400});
  const student=await findStudentInSchool({schoolCode:request.schoolCode,studentId:request.studentId,transaction,lock:true});
  const applied=await StudentEnrollment.findByPk(request.appliedEnrollmentId,{transaction,lock:transaction.LOCK.UPDATE});
  const previous=await StudentEnrollment.findByPk(request.fromEnrollmentId,{transaction,lock:transaction.LOCK.UPDATE});
  if(!student||!applied||!previous)throw Object.assign(new Error('Transfer enrollment history is incomplete and cannot be rolled back automatically'),{status:409});
  const active=await StudentEnrollment.findOne({where:{schoolCode:request.schoolCode,studentId:student.id,status:'active'},transaction,lock:transaction.LOCK.UPDATE});
  if(Number(active?.id)!==Number(applied.id))throw Object.assign(new Error('Student has moved again since this transfer. Roll back the latest movement first.'),{status:409});
  await applied.update({status:'reversed',effectiveTo:isoToday(),endTerm:request.term,endedReason:'class_transfer_rollback',closedBy:actor.id,movementReason:String(reason).trim(),version:Number(applied.version||1)+1},{transaction,hooks:false});
  await previous.update({status:'active',effectiveTo:null,endTerm:null,endedReason:null,closedBy:null,classTeacherIdAtEnd:null,movementType:'class_transfer_rollback',movementReason:String(reason).trim(),version:Number(previous.version||1)+1,metadata:{...(previous.metadata||{}),rolledBackTransferRequestId:request.id}},{transaction,hooks:false});
  const fromClass=await Class.findOne({where:{id:request.fromClassId,schoolCode:request.schoolCode},transaction});
  const toClass=await Class.findOne({where:{id:request.toClassId,schoolCode:request.schoolCode},transaction});
  await student.update({classId:previous.classId,grade:fromClass?.name||student.grade,activeEnrollmentId:previous.id,status:'active'},{transaction,hooks:false});
  const feeResult=request.metadata?.feeResult||null;
  if(feeResult?.feeId){
    const fee=await Fee.findByPk(feeResult.feeId,{transaction,lock:transaction.LOCK.UPDATE});
    if(fee){
      const covered=money(fee.parentPaidAmount??fee.paidAmount)+money(fee.creditAmount);
      const auditTrail=[...(Array.isArray(fee.auditTrail)?fee.auditTrail:[])];
      if(feeResult.before&&typeof feeResult.before==='object'){
        const before=feeResult.before;
        const restoredTotal=Math.max(covered,money(before.totalAmount));
        auditTrail.push({action:'class_transfer_fee_state_rollback',requestId:request.id,before:money(fee.totalAmount),restored:before,actorId:actor.id,at:new Date().toISOString()});
        await fee.update({totalAmount:restoredTotal,classId:before.classId??request.fromClassId,feeStructureId:before.feeStructureId||fee.feeStructureId,dueDate:before.dueDate||fee.dueDate,currency:before.currency||fee.currency,status:covered>=restoredTotal&&restoredTotal>0?'paid':covered>0?'partial':'unpaid',auditTrail},{transaction});
      }else if(feeResult.created){
        const period=request.feeAction==='apply_next_period'?nextPeriod(request.term,request.academicYear):{term:request.term,year:request.academicYear};
        const oldStructure=await getFeeStructure({schoolCode:request.schoolCode,classId:request.fromClassId,term:period.term,year:period.year,transaction});
        const restoredTotal=oldStructure?Math.max(covered,money(oldStructure.totalAmount)):money(fee.totalAmount);
        auditTrail.push({action:'class_transfer_created_fee_rollback',requestId:request.id,restoredClassId:request.fromClassId,structureId:oldStructure?.id||null,actorId:actor.id,at:new Date().toISOString(),note:oldStructure?'Reassigned to previous class fee structure':'Previous class fee structure missing; amount preserved for finance review'});
        await fee.update({classId:request.fromClassId,totalAmount:restoredTotal,feeStructureId:oldStructure?Number(oldStructure.id):fee.feeStructureId,dueDate:oldStructure?.dueDate||fee.dueDate,status:covered>=restoredTotal&&restoredTotal>0?'paid':covered>0?'partial':'unpaid',auditTrail},{transaction});
      }
    }
  }
  await request.update({status:'rolled_back',rollbackBy:actor.id,rollbackAt:new Date(),version:Number(request.version||1)+1,metadata:{...(request.metadata||{}),rollbackReason:String(reason).trim()}},{transaction});
  await AuditLog.create({schoolCode:request.schoolCode,actorUserId:actor.id,actorRole:actor.role,module:'student_lifecycle',action:'class_transfer_rolled_back',entityType:'ClassTransferRequest',entityId:String(request.id),before:{classId:toClass?.id,enrollmentId:applied.id},after:{classId:fromClass?.id,enrollmentId:previous.id},reason:String(reason).trim()},{transaction});
  const payload={schoolCode:request.schoolCode,requestId:request.id,studentId:student.id,fromClassId:toClass?.id,toClassId:fromClass?.id,effectiveDate:isoToday(),reason:String(reason).trim(),status:'rolled_back'};
  const recipients=await movementRecipients({schoolCode:request.schoolCode,student,fromClass:toClass,toClass:fromClass,transaction});
  const userIds=[recipients.studentUserId,...recipients.parentUserIds,...recipients.teacherUserIds,...recipients.adminUserIds].filter(Boolean);
  for(const userId of [...new Set(userIds)]){
    const role=userId===recipients.studentUserId?'student':recipients.parentUserIds.includes(userId)?'parent':recipients.teacherUserIds.includes(userId)?'teacher':'admin';
    await createAlert({userId,role,type:'academic',severity:'warning',title:'Class transfer reversed',message:`${student.User?.name||'Student'} was restored to ${fromClass?.name||'the previous class'}. Historical records remain preserved.`,categoryLabel:'Student School Cycle',sourceType:'class_transfer_rollback',sourceLabel:'School Administration',studentId:student.id,classId:fromClass?.id,dedupeKey:`class-transfer-rollback:${request.id}:${userId}`,actionUrl:'#student-lifecycle',data:payload,transaction});
  }
  if(toClass)await realtime.emitToClass(request.schoolCode,toClass.id,'student:class_membership_changed',{...payload,action:'removed_after_rollback'},{transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  if(fromClass)await realtime.emitToClass(request.schoolCode,fromClass.id,'student:class_membership_changed',{...payload,action:'restored_after_rollback'},{transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  await realtime.emitToStudentContext(request.schoolCode,student.id,'student:class_transfer_rolled_back',payload,{transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  if(userIds.length)await realtime.emitToUsers([...new Set(userIds)],'student:class_transfer_rolled_back',payload,{schoolCode:request.schoolCode,transaction,entityType:'ClassTransferRequest',entityId:request.id,version:request.version||1});
  await realtime.emitToSchool(request.schoolCode,'analytics:invalidated',{scope:'student_class_membership',studentId:student.id,requestId:request.id},{transaction});
  return request;
}

module.exports={TERMS,FEE_ACTIONS,OPEN_TRANSFER_STATUSES,classTeacherIdsForClass,primaryClassTeacherId,isoToday,dayBefore,normalizeTerm,nextPeriod,findStudentInSchool,ensureCurrentEnrollment,buildFeePreview,buildImpactPreview,validateMovement,applyRequest,applyDirectMovement,rollbackRequest,ensureFeeAccount,getFeeStructure,publicClass};
