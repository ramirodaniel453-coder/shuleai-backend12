const { Op } = require('sequelize');
const { Student, User, Parent, StudentParent, Teacher, TeacherSubjectAssignment, Class, School, BirthdayEvent } = require('../models');
const realtime = require('./realtimeService');
const { createAlert } = require('./notificationService');

function ymd(date,timeZone='Africa/Nairobi'){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function dateParts(date,timeZone='Africa/Nairobi'){const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date);return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
function nextBirthday(dob,now=new Date(),timeZone='Africa/Nairobi'){const birth=new Date(dob);if(Number.isNaN(birth.getTime()))return null;const p=dateParts(now,timeZone);let d=new Date(Date.UTC(p.year,birth.getUTCMonth(),birth.getUTCDate(),12));if(ymd(d,timeZone)<ymd(now,timeZone))d=new Date(Date.UTC(p.year+1,birth.getUTCMonth(),birth.getUTCDate(),12));return d;}
function ageOn(dob,onDate){const b=new Date(dob),d=new Date(onDate);let years=d.getUTCFullYear()-b.getUTCFullYear();if(d.getUTCMonth()<b.getUTCMonth()||(d.getUTCMonth()===b.getUTCMonth()&&d.getUTCDate()<b.getUTCDate()))years--;return Math.max(0,years);}
function ordinal(value){const n=Number(value);const mod100=n%100;if(mod100>=11&&mod100<=13)return `${n}th`;return `${n}${n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'}`;}
async function recipients(student,schoolCode,settings={}){
  const configured=settings.audience||{};
  const privacy={ enabled:true, notifyParent:true, notifyTeacher:true, notifyStudent:true, announceToClass:false, ...(student.birthdayPrivacy||{}) };
  const allow={student:configured.student!==false&&privacy.notifyStudent!==false,parent:configured.parent!==false&&privacy.notifyParent!==false,classTeacher:(configured.classTeacher??configured.teacher)!==false&&privacy.notifyTeacher!==false,subjectTeacher:configured.subjectTeacher===true&&privacy.notifyTeacher!==false,admin:configured.admin!==false};
  const ids=new Set();
  if(allow.student)ids.add(student.userId);
  if(allow.parent){const links=await StudentParent.findAll({where:{studentId:student.id}});if(links.length){const parents=await Parent.findAll({where:{id:{[Op.in]:links.map(x=>x.parentId)}}});parents.forEach(p=>ids.add(p.userId));}}
  const cls=student.classId?await Class.findOne({where:{id:student.classId,schoolCode}}):null;
  if((allow.classTeacher||allow.subjectTeacher)&&cls){if(cls.teacherId){const teacher=await Teacher.findByPk(cls.teacherId);if(teacher?.userId)ids.add(teacher.userId);}const assignments=await TeacherSubjectAssignment.findAll({where:{classId:cls.id},attributes:['teacherId']}).catch(()=>[]);if(assignments.length){const teachers=await Teacher.findAll({where:{id:{[Op.in]:assignments.map(a=>a.teacherId)}},attributes:['userId']});teachers.forEach(t=>ids.add(t.userId));}}
  if(allow.admin){const admins=await User.findAll({where:{schoolCode,role:'admin',isActive:true},attributes:['id']});admins.forEach(a=>ids.add(a.id));}
  if(allow.student&&settings.announceToClass===true&&privacy.announceToClass===true&&cls){const classmates=await Student.findAll({where:{classId:cls.id,status:'active'},attributes:['userId']});classmates.forEach(s=>ids.add(s.userId));}
  return {userIds:[...ids].filter(Boolean),classId:cls?.id||null,className:cls?.name||student.grade||null};
}
async function processSchool(schoolCode,{now=new Date(),createdBy=null}={}){
  const school=await School.findOne({where:{schoolId:schoolCode}});const settings=school?.settings?.birthdayNotifications||{};if(settings.enabled===false)return {schoolCode,created:0,suppressed:true};
  const timezone=settings.timezone||'Africa/Nairobi';const advanceDays=Array.isArray(settings.advanceDays)?settings.advanceDays:[7,1];const today=ymd(now,timezone);
  const suppressedIds=Array.isArray(settings.suppressedStudentIds)?settings.suppressedStudentIds.map(Number):[];
  const students=await (Student.unscoped?Student.unscoped():Student).findAll({where:{status:'active',dateOfBirth:{[Op.ne]:null},...(settings.requireVerifiedDateOfBirth===true?{dateOfBirthVerified:true}:{}),...(suppressedIds.length?{id:{[Op.notIn]:suppressedIds}}:{})},include:[{model:User,where:{schoolCode,role:'student',isActive:true},attributes:['id','name','schoolCode']} ]});
  let created=0;
  for(const student of students){const privacy={enabled:true,...(student.birthdayPrivacy||{})};if(privacy.enabled===false)continue;const birthday=nextBirthday(student.dateOfBirth,now,timezone);if(!birthday)continue;const birthdayDate=ymd(birthday,timezone);const days=Math.round((new Date(`${birthdayDate}T12:00:00Z`)-new Date(`${today}T12:00:00Z`))/86400000);if(days===0&&settings.sameDayEnabled===false)continue;if(days!==0&&!advanceDays.includes(days))continue;const eventType=days===0?'same_day':`advance_${days}`;const [event,isNew]=await BirthdayEvent.findOrCreate({where:{schoolCode,studentId:student.id,eventDate:birthdayDate,eventType},defaults:{schoolCode,studentId:student.id,eventDate:birthdayDate,eventType,status:'created',audience:{},createdBy,metadata:{daysBefore:days}}});if(!isNew)continue;
    const target=await recipients(student,schoolCode,settings);const age=ageOn(student.dateOfBirth,birthday);const title=days===0?`🎉 ${student.User.name}'s birthday today`:`Birthday reminder: ${student.User.name}`;const message=days===0?`${student.User.name} is celebrating their ${ordinal(age)} birthday today.`:`${student.User.name} will celebrate their ${ordinal(age)} birthday in ${days} day${days===1?'':'s'} (${birthdayDate}).`;
    for(const userId of target.userIds){const u=await User.findByPk(userId,{attributes:['id','role']});if(!u)continue;await createAlert({userId:u.id,role:u.role,type:'system',severity:'info',title,message,categoryLabel:'Birthday',sourceType:'birthday',sourceLabel:'Shule AI birthday reminder',studentId:student.id,classId:target.classId,dedupeKey:`birthday:${student.id}:${birthdayDate}:${eventType}:${u.id}`,data:{schoolCode,studentId:student.id,birthdayDate,daysBefore:days,age,className:target.className}});}
    await event.update({status:'sent',audience:{userIds:target.userIds,classId:target.classId},metadata:{...(event.metadata||{}),studentName:student.User.name,age,className:target.className}});
    await realtime.emit({type:days===0?'birthday:today':'birthday:upcoming',schoolCode,audience:{school:false,userIds:target.userIds,classIds:target.classId?[target.classId]:[],studentIds:[student.id]},entityType:'BirthdayEvent',entityId:event.id,version:1,data:{eventId:event.id,studentId:student.id,studentName:student.User.name,birthdayDate,daysBefore:days,age,className:target.className,title,message}});created++;
  }
  return {schoolCode,created,checked:students.length,date:today};
}
async function processAllSchools(options={}){const schools=await School.findAll({where:{status:'active'},attributes:['schoolId']});const results=[];for(const school of schools)results.push(await processSchool(school.schoolId,options));return results;}
module.exports={processSchool,processAllSchools,nextBirthday,ageOn};
