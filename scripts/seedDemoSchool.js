#!/usr/bin/env node
/* Demo seed helper. Prefer using POST /api/owner/demo-school/seed from a super-admin session. */
require('dotenv').config();
const { sequelize, School, User, Student, Teacher, Parent, Class, Alert } = require('../src/models');
const { generateTemporaryPassword } = require('../src/utils/passwords');

(async function(){
  const schoolId = process.env.DEMO_SCHOOL_CODE || 'DEMO-SHULEAI';
  const [school] = await School.findOrCreate({ where: { schoolId }, defaults: { name: 'Shule AI Demo School', shortCode: 'DEMOAI', status: 'active', isActive: true, settings: { demoMode: true } } });
  async function user(role,name,email){ return (await User.findOrCreate({ where:{ email }, defaults:{ name,email,password:generateTemporaryPassword(),role,schoolCode:school.schoolId,isActive:true,firstLogin:true,mustChangePassword:true,passwordIssuedAt:new Date() } }))[0]; }
  const admin=await user('admin','Demo Admin','demo.admin@shuleai.local');
  const teacherU=await user('teacher','Demo Teacher','demo.teacher@shuleai.local');
  const parentU=await user('parent','Demo Parent','demo.parent@shuleai.local');
  const studentU=await user('student','Brian Demo Student','demo.student@shuleai.local');
  const [klass]=await Class.findOrCreate({ where:{ schoolCode:school.schoolId, name:'Grade 6 Blue' }, defaults:{ schoolCode:school.schoolId, name:'Grade 6 Blue', grade:'Grade 6', isActive:true } });
  await Teacher.findOrCreate({ where:{ userId:teacherU.id }, defaults:{ userId:teacherU.id, classId:klass.id, subjects:['Mathematics','Science'], classTeacher:'yes', approvalStatus:'approved' } });
  const [parent]=await Parent.findOrCreate({ where:{ userId:parentU.id }, defaults:{ userId:parentU.id, relationship:'guardian' } });
  const [student]=await Student.findOrCreate({ where:{ userId:studentU.id }, defaults:{ userId:studentU.id, grade:'Grade 6', classId:klass.id, curriculum:'cbc', status:'active' } });
  await sequelize.query('INSERT INTO "StudentParents" ("studentId","parentId","createdAt","updatedAt") VALUES (:studentId,:parentId,NOW(),NOW()) ON CONFLICT DO NOTHING', { replacements:{ studentId:student.id, parentId:parent.id } }).catch(()=>{});
  await Alert.findOrCreate({ where:{ userId:parentU.id, dedupeKey:`demo-presence-${student.id}` }, defaults:{ userId:parentU.id, role:'parent', type:'system', title:'Brian is present today', message:'Your child is present today. Shule AI keeps you updated.', sourceLabel:'Shule AI Demo', categoryLabel:'Parent Peace of Mind', studentId:student.id, dedupeKey:`demo-presence-${student.id}` } });
  console.log(JSON.stringify({ schoolCode:school.schoolId, accounts:{ admin:admin.email, teacher:teacherU.email, parent:parentU.email, student:studentU.email }, note:'Passwords are random temporary values; reset from admin tools for demos.' }, null, 2));
  await sequelize.close();
})().catch(async e => { console.error(e); try{ await sequelize.close(); }catch(_){} process.exit(1); });
