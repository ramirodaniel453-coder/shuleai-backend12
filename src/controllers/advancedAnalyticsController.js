const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Op } = require('sequelize');
const { AcademicRecord, Attendance, Student, User, Class, School, Teacher, TeacherSubjectAssignment } = require('../models');
const { getGradeFromScore } = require('../services/gradingEngine');

function schoolCode(req){return req.user?.schoolCode;}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function round(v,d=2){if(v==null||Number.isNaN(Number(v)))return null;return Math.round(Number(v)*10**d)/10**d;}
function avg(arr){const valid=(arr||[]).map(n).filter(v=>v!==null);return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;}
function safeCsv(value){
  let s=String(value??'');
  if(/^[=+\-@\t\r]/.test(s)) s=`'${s}`;
  return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function assessmentLabel(record){return record.assessmentName||record.assessmentType||'Assessment';}
function uniq(list){return [...new Set((list||[]).filter(v=>v!==undefined&&v!==null&&String(v).trim()!==''))];}
function lower(v){return String(v||'').trim().toLowerCase();}

const ACADEMIC_RECORD_ASSESSMENT_ENUMS = new Set(['test','exam','assignment','project','quiz']);
function normalizeAssessmentText(value){return String(value||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');}
function enumAssessmentType(value){
  const raw=normalizeAssessmentText(value).replace(/\s+/g,'_');
  return ACADEMIC_RECORD_ASSESSMENT_ENUMS.has(raw) ? raw : null;
}
function recordMatchesAssessmentFilter(record, requested){
  const wanted=normalizeAssessmentText(requested);
  if(!wanted) return true;
  const wantedCompact=wanted.replace(/\s+/g,'');
  const values=[record.assessmentType,record.assessmentName,record.testType,record.examType,record.type,record.assessment,assessmentLabel(record)]
    .map(normalizeAssessmentText)
    .filter(Boolean);
  if(values.some(v=>v===wanted || v.replace(/\s+/g,'')===wantedCompact)) return true;
  // Friendly labels selected in the UI should map to common stored assessment names.
  const aliases={
    cat:['cat','cat 1','cat1','cat 2','cat2','continuous assessment test','continuous assessment'],
    midterm:['midterm','mid term','mid term exam','midterm exam'],
    endterm:['end term','endterm','end term exam','final exam','exam'],
    sba:['sba','school based assessment','school based assessment tests'],
    practical:['practical','practical assessment'],
    project:['project','sba project','project work']
  };
  const aliasKey=wantedCompact;
  const accepted=aliases[aliasKey] || [];
  return values.some(v=>accepted.includes(v) || accepted.includes(v.replace(/\s+/g,'')) || v.includes(wanted));
}

async function allowedScope(req){
  if(['admin','super_admin'].includes(req.user.role))return {all:true,classIds:null,subjects:null,classTeacherIds:[]};
  if(req.user.role!=='teacher')return {all:false,classIds:[],subjects:[],classTeacherIds:[]};
  const teacher=await Teacher.findOne({where:{userId:req.user.id}});if(!teacher)return {all:false,classIds:[],subjects:[],classTeacherIds:[]};
  const assignments=await TeacherSubjectAssignment.findAll({where:{teacherId:teacher.id},include:[{model:Class,required:false,where:{schoolCode:schoolCode(req)},attributes:['id','schoolCode']}]}).catch(()=>[]);
  const ownedClasses=await Class.findAll({where:{schoolCode:schoolCode(req),[Op.or]:[{teacherId:teacher.id},{id:teacher.classId||-1}]},attributes:['id']}).catch(()=>[]);
  const classTeacherIds=uniq([...ownedClasses.map(c=>c.id),...assignments.filter(a=>a.isClassTeacher).map(a=>a.classId)]).map(Number);
  const classIds=uniq([...classTeacherIds,...assignments.map(a=>a.classId)]).map(Number);
  const subjects=uniq(assignments.filter(a=>!a.isClassTeacher).map(a=>String(a.subject||a.subjectName||'').trim()));
  return {all:false,classIds,subjects,classTeacherIds,isClassTeacher:classTeacherIds.length>0};
}

async function build(req){
  const q=req.query||{};const sc=schoolCode(req);const scope=await allowedScope(req);
  if(!scope.all&&!scope.classIds.length){const err=new Error('No assigned classes are available for analytics');err.status=403;throw err;}
  const classWhere={schoolCode:sc,[Op.or]:[{isActive:true},{isActive:null}]};
  const allClasses=await Class.findAll({where:classWhere,attributes:['id','name','grade','stream','levelCode'],order:[['grade','ASC'],['name','ASC']]}).catch(()=>[]);
  const classMap=new Map(allClasses.map(c=>[Number(c.id),c]));
  let eligibleClassIds=scope.all?allClasses.map(c=>Number(c.id)):scope.classIds.map(Number);
  if(q.classId)eligibleClassIds=eligibleClassIds.filter(id=>id===Number(q.classId));
  if(q.stream){const wanted=lower(q.stream);eligibleClassIds=eligibleClassIds.filter(id=>lower(classMap.get(id)?.stream)===wanted);}
  eligibleClassIds=uniq(eligibleClassIds).map(Number);

  const school=await School.findOne({where:{schoolId:sc}});const curriculum=school?.system||'cbc';const scale=school?.settings?.gradingScale||null;const level=school?.settings?.schoolLevel||school?.schoolStructure||'secondary';
  const grade=v=>v==null?null:getGradeFromScore(round(v),curriculum,level,scale);
  const passMark=Number(school?.settings?.passMark ?? school?.settings?.gradingScalePassMark ?? 50);

  const studentWhere={status:'active'}; if(eligibleClassIds.length)studentWhere.classId={[Op.in]:eligibleClassIds}; if(q.studentId)studentWhere.id=Number(q.studentId);
  const scopedStudents=await (Student.unscoped?Student.unscoped():Student).findAll({where:studentWhere,include:[{model:User,required:true,where:{schoolCode:sc,role:'student'},attributes:['id','name','profileImage']},{model:Class,required:false,attributes:['id','name','grade','stream']}],attributes:['id','elimuid','gender','grade','classId'],order:[[User,'name','ASC']]}).catch(()=>[]);

  const where={schoolCode:sc};
  if(q.year)where.year=Number(q.year);if(q.term)where.term=q.term;if(q.assessmentType){const safeType=enumAssessmentType(q.assessmentType);if(safeType)where.assessmentType=safeType;}if(q.assessmentName)where.assessmentName=q.assessmentName;if(q.subject)where.subject=q.subject;if(q.studentId)where.studentId=Number(q.studentId);
  if(String(q.publishedOnly||'').toLowerCase()==='true')where[Op.or]=[{isPublished:true},{status:'published'},{status:'locked'}];
  const records=await AcademicRecord.unscoped().findAll({where,include:[{model:Student,required:true,include:[{model:User,required:true,where:{schoolCode:sc,role:'student'},attributes:['id','name','profileImage']},{model:Class,required:false,attributes:['id','name','grade','stream']}]}],order:[['year','DESC'],['term','DESC'],['date','DESC'],['updatedAt','DESC']]});
  let filtered=records.filter(r=>{
    if(q.assessmentType && !recordMatchesAssessmentFilter(r,q.assessmentType))return false;
    const cid=Number(r.classId||r.Student?.classId||0)||null;
    if(eligibleClassIds.length && !eligibleClassIds.includes(cid))return false;
    if(!scope.all&&scope.subjects.length&&!scope.classTeacherIds?.includes(cid)&&!scope.subjects.map(lower).includes(lower(r.subject)))return false;
    if(q.gender&&lower(r.Student?.gender)!==lower(q.gender))return false;
    if(q.stream&&lower(classMap.get(cid)?.stream)!==lower(q.stream))return false;
    return true;
  });

  const byStudent=new Map();
  for(const st of scopedStudents){const cid=Number(st.classId||st.Class?.id||0)||null; if(q.gender&&lower(st.gender)!==lower(q.gender))continue; byStudent.set(Number(st.id),{studentId:Number(st.id),elimuid:st.elimuid||'',name:st.User?.name||`Student ${st.id}`,gender:st.gender||null,classId:cid,className:st.Class?.name||classMap.get(cid)?.name||null,gradeLevel:st.Class?.grade||classMap.get(cid)?.grade||st.grade||null,stream:st.Class?.stream||classMap.get(cid)?.stream||null,subjects:new Map(),records:[]});}
  for(const r of filtered){const st=r.Student;if(!st)continue;const key=Number(st.id);const cid=Number(r.classId||st.classId||st.Class?.id||0)||null;if(!byStudent.has(key))byStudent.set(key,{studentId:key,elimuid:st.elimuid||'',name:st.User?.name||`Student ${key}`,gender:st.gender||null,classId:cid,className:st.Class?.name||classMap.get(cid)?.name||null,gradeLevel:st.Class?.grade||classMap.get(cid)?.grade||st.grade||null,stream:st.Class?.stream||classMap.get(cid)?.stream||null,subjects:new Map(),records:[]});const row=byStudent.get(key);row.records.push(r);const subject=String(r.subject||'Unknown');if(!row.subjects.has(subject))row.subjects.set(subject,[]);if(n(r.score)!==null)row.subjects.get(subject).push(Number(r.score));}

  const students=[...byStudent.values()].map(st=>{
    const subjectResults=[...st.subjects].map(([subject,scores])=>({subject,meanScore:round(avg(scores)),meanGrade:grade(avg(scores)),assessmentCount:scores.length}));
    const mean=avg(subjectResults.map(x=>x.meanScore));
    const assessmentGroups=new Map();
    for(const record of st.records){const key=[record.year,record.term,assessmentLabel(record),record.date?new Date(record.date).toISOString().slice(0,10):''].join('|');if(!assessmentGroups.has(key))assessmentGroups.set(key,{key,label:assessmentLabel(record),date:record.date||record.updatedAt||record.createdAt,scores:[]});if(n(record.score)!==null)assessmentGroups.get(key).scores.push(Number(record.score));}
    const assessmentMeans=[...assessmentGroups.values()].map(group=>({...group,meanScore:avg(group.scores)})).filter(group=>group.meanScore!==null).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
    const currentAssessment=assessmentMeans[0]||null,previousAssessment=assessmentMeans[1]||null;const improvement=currentAssessment&&previousAssessment?round(currentAssessment.meanScore-previousAssessment.meanScore):null;
    return {studentId:st.studentId,elimuid:st.elimuid,name:st.name,gender:st.gender,classId:st.classId,className:st.className,gradeLevel:st.gradeLevel,stream:st.stream,meanScore:mean==null?null:round(mean),meanGrade:grade(mean),countedSubjects:subjectResults.length,subjects:subjectResults,assessment:currentAssessment?.label||(filtered[0]?assessmentLabel(filtered[0]):null),term:q.term||filtered[0]?.term||null,year:Number(q.year||filtered[0]?.year)||null,previousAssessment:previousAssessment?.label||null,currentAssessmentMean:currentAssessment?.meanScore==null?null:round(currentAssessment.meanScore),previousMeanScore:previousAssessment?.meanScore==null?null:round(previousAssessment.meanScore),improvement,hasRecords:st.records.length>0};
  }).sort((a,b)=>(b.meanScore??-1)-(a.meanScore??-1)||String(a.name).localeCompare(String(b.name))).map((x,i)=>({...x,position:i+1}));

  const studentIds=students.map(x=>x.studentId);const attendanceRows=studentIds.length?await Attendance.findAll({where:{schoolCode:sc,studentId:{[Op.in]:studentIds}},attributes:['studentId','status']}):[];
  const attendanceMap=new Map();for(const row of attendanceRows){if(!attendanceMap.has(Number(row.studentId)))attendanceMap.set(Number(row.studentId),[]);attendanceMap.get(Number(row.studentId)).push(row.status);}students.forEach(st=>{const statuses=attendanceMap.get(Number(st.studentId))||[];const present=statuses.filter(x=>String(x).toLowerCase()==='present').length;st.attendanceRate=statuses.length?round(present/statuses.length*100):null;st.attendanceRecords=statuses.length;});

  const group=(keyFn)=>{const m=new Map();for(const st of students){const key=keyFn(st)||'Unassigned';if(!m.has(key))m.set(key,[]);m.get(key).push(st);}return [...m].map(([name,rows])=>({name,learnerCount:rows.length,learnersWithRecords:rows.filter(x=>x.hasRecords).length,meanScore:round(avg(rows.map(x=>x.meanScore))),meanGrade:grade(avg(rows.map(x=>x.meanScore)))})).sort((a,b)=>(b.meanScore??-1)-(a.meanScore??-1));};
  const subjectMap=new Map();for(const st of students)for(const sub of st.subjects){if(!subjectMap.has(sub.subject))subjectMap.set(sub.subject,[]);subjectMap.get(sub.subject).push(sub.meanScore);}const subjectMeans=[...subjectMap].map(([name,scores])=>({name,learnerCount:scores.length,meanScore:round(avg(scores)),meanGrade:grade(avg(scores))})).sort((a,b)=>(b.meanScore??-1)-(a.meanScore??-1));
  const genderRows={};for(const st of students){const key=lower(st.gender||'unspecified');if(!genderRows[key])genderRows[key]=[];genderRows[key].push(st);}const genderAnalysis=Object.entries(genderRows).map(([gender,rows])=>({gender,learnerCount:rows.length,meanScore:round(avg(rows.map(x=>x.meanScore))),meanGrade:grade(avg(rows.map(x=>x.meanScore))),leadingLearner:rows.slice().sort((a,b)=>(b.meanScore??-1)-(a.meanScore??-1))[0]||null,competencyPercentage:round(rows.filter(x=>(x.meanScore??0)>=passMark).length/Math.max(rows.filter(x=>x.hasRecords).length,1)*100),meanImprovement:round(avg(rows.map(x=>x.improvement))),attendanceRate:round(avg(rows.map(x=>x.attendanceRate)))}));
  const distributions={};for(const st of students){const g=st.meanGrade||'No marks';distributions[g]=(distributions[g]||0)+1;}const schoolMean=avg(students.map(x=>x.meanScore));
  const classMeans=group(x=>x.className||x.gradeLevel),streamMeans=group(x=>x.stream?`${x.className||x.gradeLevel||'Class'} — ${x.stream}`:(x.className||'Unassigned'));const attendanceComparison=group(x=>x.className).map(row=>{const members=students.filter(st=>(st.className||'Unassigned')===row.name);return {...row,attendanceRate:round(avg(members.map(st=>st.attendanceRate))),academicMeanScore:row.meanScore};});
  const improvementTrends=students.filter(x=>x.improvement!==null).slice().sort((a,b)=>b.improvement-a.improvement).map((x,index)=>({position:index+1,studentId:x.studentId,name:x.name,className:x.className,stream:x.stream,currentAssessment:x.assessment,previousAssessment:x.previousAssessment,currentMeanScore:x.currentAssessmentMean,previousMeanScore:x.previousMeanScore,improvement:x.improvement}));
  const missingLearners=students.filter(x=>!x.hasRecords).map(x=>({studentId:x.studentId,name:x.name,className:x.className,stream:x.stream,attendanceRate:x.attendanceRate}));
  const filterOptions={years:uniq([...filtered.map(r=>r.year),new Date().getFullYear()]).sort((a,b)=>b-a),terms:uniq([...filtered.map(r=>r.term),'Term 1','Term 2','Term 3']),assessmentNames:uniq(filtered.map(r=>r.assessmentName||r.assessmentType)),assessmentTypes:uniq([...filtered.map(r=>r.assessmentType),'CAT','Midterm','End Term','SBA','Project','Practical']),classes:allClasses.filter(c=>!eligibleClassIds.length||eligibleClassIds.includes(Number(c.id))).map(c=>({id:c.id,name:c.name,grade:c.grade,stream:c.stream})),streams:uniq(allClasses.map(c=>c.stream)),subjects:uniq(filtered.map(r=>r.subject)),students:students.map(s=>({id:s.studentId,name:s.name,className:s.className,elimuid:s.elimuid})),genders:uniq(students.map(s=>s.gender))};
  const coverage={totalLearners:students.length,learnersWithRecords:students.filter(x=>x.hasRecords).length,learnersWithoutRecords:missingLearners.length,recordCoveragePercent:students.length?round(students.filter(x=>x.hasRecords).length/students.length*100):0};
  return {filters:{year:q.year||null,term:q.term||null,assessmentType:q.assessmentType||null,assessmentName:q.assessmentName||null,classId:q.classId||null,stream:q.stream||null,subject:q.subject||null,studentId:q.studentId||null,gender:q.gender||null,publishedOnly:String(q.publishedOnly||'false')==='true'},filterOptions,school:{name:school?.name||'School',schoolCode:sc,curriculum},overview:{learnerCount:students.length,recordCount:filtered.length,schoolMeanScore:schoolMean==null?null:round(schoolMean),schoolMeanGrade:grade(schoolMean),topLearner:students.find(x=>x.hasRecords)||students[0]||null,coverage},studentRankings:students,classMeans,streamMeans,subjectMeans,genderAnalysis,gradeDistribution:Object.entries(distributions).map(([grade,count])=>({grade,count})),topBoys:students.filter(x=>lower(x.gender)==='male').slice(0,10),topGirls:students.filter(x=>lower(x.gender)==='female').slice(0,10),improvementTrends,attendanceComparison,passMark,missingLearners,riskIndicators:[...students.filter(x=>x.hasRecords&&(x.meanScore??100)<passMark).map(x=>({studentId:x.studentId,name:x.name,className:x.className,meanScore:x.meanScore,meanGrade:x.meanGrade,attendanceRate:x.attendanceRate,improvement:x.improvement,risk:(x.meanScore??0)<Math.max(30,passMark-20)?'critical':'needs_support'})),...missingLearners.map(x=>({studentId:x.studentId,name:x.name,className:x.className,meanScore:null,meanGrade:null,attendanceRate:x.attendanceRate,risk:'missing_marks'}))],generatedAt:new Date().toISOString()};
}

exports.summary=async(req,res)=>{try{res.json({success:true,data:await build(req)});}catch(error){res.status(error.status||500).json({success:false,message:error.message});}};
exports.csv=async(req,res)=>{try{const d=await build(req);const rows=[['Position','Student','Gender','Class','Stream','Mean Score','Mean Grade','Counted Subjects','Assessment','Term','Year','Improvement','Attendance %'],...d.studentRankings.map(x=>[x.position,x.name,x.gender||'',x.className||'',x.stream||'',x.meanScore??'',x.meanGrade||'',x.countedSubjects,x.assessment||'',x.term||'',x.year||'',x.improvement??'',x.attendanceRate??''])];const csv=rows.map(r=>r.map(safeCsv).join(',')).join('\n');const name=`${d.school.name}_Academic_Analytics_${d.filters.term||'All'}_${d.filters.year||'All'}.csv`.replace(/[^a-zA-Z0-9_.-]+/g,'_');res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}"`});res.send('\ufeff'+csv);}catch(error){res.status(error.status||500).json({success:false,message:error.message});}};

function sheet(workbook,name,columns,rows){const ws=workbook.addWorksheet(name);ws.columns=columns.map(c=>({header:c.header,key:c.key,width:c.width||18}));ws.addRows(rows);ws.getRow(1).font={bold:true};ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:ws.getRow(1).getCell(columns.length).address};return ws;}
exports.xlsx=async(req,res)=>{try{const d=await build(req);const wb=new ExcelJS.Workbook();wb.creator='Shule AI';wb.created=new Date();sheet(wb,'Overview',[{header:'Metric',key:'metric',width:28},{header:'Value',key:'value',width:24}],[{metric:'School',value:d.school.name},{metric:'Curriculum',value:d.school.curriculum},{metric:'Learners',value:d.overview.learnerCount},{metric:'Academic Records',value:d.overview.recordCount},{metric:'School Mean Score',value:d.overview.schoolMeanScore},{metric:'School Mean Grade',value:d.overview.schoolMeanGrade},{metric:'Generated',value:d.generatedAt}]);sheet(wb,'Student Rankings',[{header:'Position',key:'position'},{header:'Student',key:'name',width:28},{header:'Gender',key:'gender'},{header:'Class',key:'className'},{header:'Stream',key:'stream'},{header:'Mean Score',key:'meanScore'},{header:'Mean Grade',key:'meanGrade'},{header:'Counted Subjects',key:'countedSubjects'},{header:'Improvement',key:'improvement'},{header:'Attendance %',key:'attendanceRate'}],d.studentRankings);sheet(wb,'Class Means',[{header:'Class / Grade',key:'name',width:24},{header:'Learners',key:'learnerCount'},{header:'Mean Score',key:'meanScore'},{header:'Mean Grade',key:'meanGrade'}],d.classMeans);sheet(wb,'Stream Means',[{header:'Stream',key:'name'},{header:'Learners',key:'learnerCount'},{header:'Mean Score',key:'meanScore'},{header:'Mean Grade',key:'meanGrade'}],d.streamMeans);sheet(wb,'Subject Means',[{header:'Subject',key:'name',width:28},{header:'Learners',key:'learnerCount'},{header:'Mean Score',key:'meanScore'},{header:'Mean Grade',key:'meanGrade'}],d.subjectMeans);sheet(wb,'Gender Analysis',[{header:'Gender',key:'gender'},{header:'Learners',key:'learnerCount'},{header:'Mean Score',key:'meanScore'},{header:'Mean Grade',key:'meanGrade'},{header:'Competency %',key:'competencyPercentage'},{header:'Mean Improvement',key:'meanImprovement'},{header:'Attendance %',key:'attendanceRate'}],d.genderAnalysis);sheet(wb,'Grade Distribution',[{header:'Grade',key:'grade'},{header:'Count',key:'count'}],d.gradeDistribution);sheet(wb,'Attendance Comparison',[{header:'Class',key:'name',width:24},{header:'Learners',key:'learnerCount'},{header:'Academic Mean',key:'academicMeanScore'},{header:'Attendance %',key:'attendanceRate'}],d.attendanceComparison);sheet(wb,'Improvement Trends',[{header:'Position',key:'position'},{header:'Student',key:'name',width:28},{header:'Class',key:'className'},{header:'Previous Assessment',key:'previousAssessment',width:22},{header:'Current Assessment',key:'currentAssessment',width:22},{header:'Previous Mean',key:'previousMeanScore'},{header:'Current Mean',key:'currentMeanScore'},{header:'Improvement',key:'improvement'}],d.improvementTrends);sheet(wb,'Risk Indicators',[{header:'Student',key:'name',width:28},{header:'Class',key:'className'},{header:'Mean Score',key:'meanScore'},{header:'Mean Grade',key:'meanGrade'},{header:'Risk',key:'risk'}],d.riskIndicators);const name=`${d.school.name}_Academic_Analytics_${d.filters.term||'All'}_${d.filters.year||'All'}.xlsx`.replace(/[^a-zA-Z0-9_.-]+/g,'_');res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${name}"`});await wb.xlsx.write(res);res.end();}catch(error){if(!res.headersSent)res.status(error.status||500).json({success:false,message:error.message});}};

exports.pdf=async(req,res)=>{try{const d=await build(req);const name=`${d.school.name}_Academic_Analytics_${d.filters.term||'All'}_${d.filters.year||'All'}.pdf`.replace(/[^a-zA-Z0-9_.-]+/g,'_');res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${name}"`});const doc=new PDFDocument({size:'A4',margin:42,info:{Title:`${d.school.name} Academic Analytics`,Author:'Shule AI'}});doc.pipe(res);doc.fontSize(18).text(d.school.name,{align:'center'}).fontSize(14).text('Academic Analytics Summary',{align:'center'}).moveDown();doc.fontSize(10).text(`Curriculum: ${d.school.curriculum}   Term: ${d.filters.term||'All'}   Year: ${d.filters.year||'All'}`).moveDown();doc.fontSize(12).text(`School Mean: ${d.overview.schoolMeanScore??'—'} (${d.overview.schoolMeanGrade||'—'})`);doc.text(`Learners analysed: ${d.overview.learnerCount}   Records: ${d.overview.recordCount}`).moveDown();doc.fontSize(13).text('Top Learners');doc.fontSize(9);d.studentRankings.slice(0,20).forEach(x=>doc.text(`${x.position}. ${x.name} — ${x.className||'Unassigned'} — ${x.meanScore??'—'} — ${x.meanGrade||'—'}`));doc.moveDown().fontSize(13).text('Class / Grade Means');doc.fontSize(9);d.classMeans.forEach(x=>doc.text(`${x.name}: ${x.meanScore} (${x.meanGrade}) — ${x.learnerCount} learner(s)`));doc.moveDown().fontSize(13).text('Gender Analysis');doc.fontSize(9);d.genderAnalysis.forEach(x=>doc.text(`${x.gender}: mean ${x.meanScore} (${x.meanGrade}), ${x.learnerCount} learner(s), competency ${x.competencyPercentage}%`));doc.moveDown().fontSize(13).text('Leading Learners by Gender');doc.fontSize(9);[...d.topGirls.slice(0,3),...d.topBoys.slice(0,3)].forEach(x=>doc.text(`${x.name} — ${x.meanScore??'—'}% — ${x.meanGrade||'—'} — ${x.className||'Unassigned'}`));if(d.improvementTrends.length){doc.moveDown().fontSize(13).text('Most Improved Learners');doc.fontSize(9);d.improvementTrends.slice(0,10).forEach(x=>doc.text(`${x.position}. ${x.name} — ${x.improvement>=0?'+':''}${x.improvement} points (${x.previousAssessment||'Previous'} → ${x.currentAssessment||'Current'})`));}if(d.riskIndicators.length){doc.addPage().fontSize(13).text('Learners Requiring Support');doc.fontSize(9);d.riskIndicators.forEach(x=>doc.text(`${x.name} — ${x.className||'Unassigned'} — ${x.meanScore} (${x.meanGrade}) — ${x.risk}`));}doc.end();}catch(error){if(!res.headersSent)res.status(error.status||500).json({success:false,message:error.message});}};

module.exports.buildAdvancedAnalytics=build;
