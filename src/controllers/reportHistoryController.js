const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { Op } = require('sequelize');
const { ReportSnapshot, ReportShare, Student, Parent, StudentParent, Teacher, Class, User, TeacherSubjectAssignment } = require('../models');
const schoolLinkageService = require('../services/schoolLinkageService');
const snapshotService = require('../services/reportSnapshotService');

function code(req) { return req.user?.schoolCode; }
async function studentForUser(userId) { return (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ userId } }); }
async function canRead(req, report) {
  if (!report || String(report.schoolCode) !== String(code(req))) return false;
  if (['admin','super_admin'].includes(req.user.role)) return true;
  if (req.user.role === 'student') return Number((await studentForUser(req.user.id))?.id) === Number(report.studentId);
  if (req.user.role === 'parent') {
    const parent = await Parent.findOne({ where:{ userId:req.user.id } });
    return Boolean(parent && await StudentParent.findOne({ where:{ parentId:parent.id, studentId:report.studentId } }));
  }
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
    const cls = report.classId ? await Class.findOne({ where:{ id:report.classId, schoolCode:code(req) } }) : null;
    if (teacher && cls && (Number(teacher.classId) === Number(cls.id) || Number(cls.teacherId) === Number(teacher.id))) return true;
    if (teacher && cls) {
      const assignment = await TeacherSubjectAssignment.findOne({ where:{ teacherId:teacher.id, classId:cls.id, isClassTeacher:true } }).catch(() => null);
      if (assignment) return true;
    }
    return false;
  }
  return false;
}


function cleanFilePart(value, fallback='Report') {
  return String(value || fallback).trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || fallback;
}

function imageSource(value) {
  if (!value || /\/undefined|\/null/i.test(String(value))) return null;
  const text = String(value);
  const match = text.match(/^data:image\/(?:png|jpe?g);base64,(.+)$/i);
  if (match) { try { return Buffer.from(match[1], 'base64'); } catch (_) { return null; } }
  const rel = text.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
  const candidates = [path.join(process.cwd(), rel), path.join(process.cwd(), 'uploads', path.basename(rel)), path.join(__dirname, '..', '..', rel)];
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch (_) { return false; } }) || null;
}

function drawImageSafe(doc, source, x, y, options) {
  const resolved = imageSource(source);
  if (!resolved) return false;
  try { doc.image(resolved, x, y, options); return true; } catch (_) { return false; }
}

function normAssessmentCell(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function assessmentCellForColumn(row, column, index) {
  const list = Array.isArray(row.components) ? row.components : (Array.isArray(row.assessments) ? row.assessments : []);
  const wanted = [column.key, column.assessmentKey, column.assessmentType, column.label].map(normAssessmentCell).filter(Boolean);
  const found = list.find(item => {
    if (!item || typeof item !== 'object') return false;
    const keys = [item.key, item.assessmentKey, item.assessmentType, item.label, item.assessmentName, item.type].map(normAssessmentCell);
    return keys.some(key => wanted.includes(key));
  }) || list[index];
  if (!found) return '';
  if (typeof found !== 'object') return found ?? '';
  const value = found.score ?? found.mark ?? found.rawScore ?? found.value;
  return value === null || value === undefined || value === '' ? '' : value;
}


async function streamReportPdf(res, report) {
  const snap = report.snapshot || {};
  const student = snap.student || {};
  const school = snap.school || {};
  const branding = school.branding || {};
  const settings = { ...(school.reportCardSettings || {}), ...(branding.reportCardSettings || {}) };
  const subjects = Array.isArray(snap.subjects) ? snap.subjects : [];
  const signatures = snap.signatures || {};
  const clean = (value, fallback = '') => String(value ?? fallback ?? '').trim();
  const first = (...items) => items.find(v => v !== undefined && v !== null && String(v).trim() !== '') || '';
  const show = (key, fallback = true) => settings[key] === undefined ? fallback : settings[key] !== false;
  const initials = (value) => clean(value, 'SA').split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 3).toUpperCase() || 'SA';
  const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  const schoolName = first(settings.schoolDisplayName, branding.schoolName, branding.displayName, school.name, 'ShuleAI School');
  const primary = hex(first(branding.primaryColor, settings.primaryColor, '#102A54'), '#102A54');
  const accent = hex(first(branding.accentColor, settings.accentColor, '#B99037'), '#B99037');
  const rawLogo = first(school.logo, school.logoUrl, school.watermarkLogo, branding.logoDataUrl, branding.logoUrl, branding.logo);
  const logoFallback = clean(settings.logoFallback || settings.headerLogoSource || 'school_initials');
  const headerLogo = rawLogo || (logoFallback === 'shuleai_logo' ? 'SHULEAI' : '');
  const watermarkType = clean(settings.watermarkType || (rawLogo ? 'school_logo' : logoFallback === 'shuleai_logo' ? 'shuleai_logo' : 'school_initials'));
  const watermarkLogo = watermarkType === 'school_logo' ? rawLogo : '';
  const watermarkText = watermarkLogo || watermarkType === 'none' ? '' : (watermarkType === 'school_name' ? schoolName : (watermarkType === 'shuleai_logo' ? 'ShuleAI' : initials(schoolName)));
  const studentName = first(student.name, snap.user?.name, 'Student');
  const reportId = first(snap.reportId, snap.reportID, report.id ? `SHULEAI-RPT-${String(report.id).padStart(6,'0')}` : '', `SHULEAI-RPT-${report.year || new Date().getFullYear()}-${String(student.id || '000123').padStart(6,'0')}`);
  const verificationCode = first(snap.verificationCode, snap.verifyCode, `${String(reportId).slice(-4).toUpperCase()}-${String(student.id || '91HD').padStart(4,'0')}`);
  const generatedDate = first(snap.generatedDate, snap.generatedAt ? new Date(snap.generatedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '', new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }));
  const publishedDate = report.publishedAt ? new Date(report.publishedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : first(snap.publishedDate, generatedDate);
  const filename = `${cleanFilePart(studentName,'Student')}_Report_Card_${cleanFilePart(report.term,'Term')}_${report.year}_v${report.version || 1}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  const doc = new PDFDocument({ size:'A4', margin:0, autoFirstPage:true, info:{ Title:filename, Author:schoolName || 'ShuleAI' } });
  doc.pipe(res);
  const pageW = doc.page.width, pageH = doc.page.height;
  const left = 26, right = pageW - 26, width = right - left;

  function textSafe(text, x, y, options = {}) { doc.text(clean(text), x, y, options); }
  function valueFor(obj, keys, fallback='—') {
    for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
    return fallback;
  }
  function drawCrest(x, y, w, h) {
    if (headerLogo && headerLogo !== 'SHULEAI' && drawImageSafe(doc, headerLogo, x, y, { fit:[w,h] })) return;
    doc.save();
    doc.lineWidth(1.3).strokeColor('#9aa7b6').fillColor('#eef3f8');
    doc.moveTo(x+w/2, y).lineTo(x+w, y+8).lineTo(x+w-6, y+h-18).quadraticCurveTo(x+w/2, y+h, x+6, y+h-18).lineTo(x, y+8).closePath().fillAndStroke();
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(headerLogo === 'SHULEAI' ? 7.5 : 12).text(headerLogo === 'SHULEAI' ? 'ShuleAI' : initials(schoolName), x+3, y+h/2-4, { width:w-6, align:'center' });
    doc.restore();
  }
  function drawStudentPhoto(x, y, w, h) {
    const photo = first(student.photo, student.profileImage, student.profilePicture, snap.user?.profileImage, snap.user?.profilePicture);
    if (show('showStudentPhoto') && photo && drawImageSafe(doc, photo, x, y, { fit:[w,h], align:'center', valign:'center' })) return;
    doc.save().strokeColor('#d9e0eb').rect(x,y,w,h).stroke().fillColor('#9aa5b1').font('Helvetica-Bold').fontSize(8).text('PHOTO', x, y+h/2-4, { width:w, align:'center' }).restore();
  }
  function drawSchoolStamp(x, y, r) {
    const stamp = first(snap.reportSignatures?.stamp, signatures.stamp?.image, school.stampUrl, branding.stampUrl, settings.stampUrl);
    if (stamp && show('showStamp') && drawImageSafe(doc, stamp, x-r, y-r, { fit:[r*2,r*2] })) return;
    if (!show('showStamp')) return;
    doc.save().circle(x,y,r).lineWidth(1).strokeColor(primary).stroke().fillColor(primary).font('Helvetica-Bold').fontSize(6).text('OFFICIAL\nSTAMP', x-r+4, y-8, { width:r*2-8, align:'center' }).restore();
  }
  function sectionHeader(title, x, y, w, h=20) {
    doc.rect(x,y,w,h).fill(primary);
    doc.fillColor('#fff').font('Times-Bold').fontSize(9.2).text(title, x+6, y+6, { width:w-12 });
  }
  function lineBox(x, y, w, h) { doc.rect(x,y,w,h).strokeColor('#d8dee8').lineWidth(.7).stroke(); }
  function cellText(text, x, y, w, h, options={}) {
    doc.fillColor(options.color || '#172033').font(options.font || 'Helvetica').fontSize(options.size || 6.6)
      .text(clean(text), x+3, y+3, { width:w-6, height:h-5, align:options.align || 'left', ellipsis:true });
  }
  function scoreForColumn(row, column, index) {
    return assessmentCellForColumn(row, column, index) || '—';
  }

  // Page background and subtle watermark
  doc.rect(0,0,pageW,pageH).fill('#ffffff');
  if (watermarkLogo) {
    doc.save().opacity(0.04);
    drawImageSafe(doc, watermarkLogo, pageW/2 - 120, 315, { fit:[240,240] });
    doc.restore();
  } else if (watermarkText) {
    doc.save().opacity(0.035).fillColor(primary).font('Helvetica-Bold').fontSize(78).rotate(-18, { origin:[pageW/2, 420] }).text(watermarkText, 0, 390, { width:pageW, align:'center' }).restore();
  }

  // Header from uploaded CBC template
  drawCrest(44, 28, 40, 54);
  doc.fillColor('#7b8794').font('Helvetica').fontSize(6.5).text('LOGO', 44, 84, { width:40, align:'center' });
  doc.fillColor(primary).font('Times-Bold').fontSize(20).text(String(schoolName).toUpperCase(), 122, 25, { width:310, align:'center', characterSpacing:.5 });
  if (show('showMotto') && first(settings.motto, school.motto, branding.motto)) {
    doc.fillColor(accent).font('Times-Italic').fontSize(8.5).text(first(settings.motto, school.motto, branding.motto), 122, 51, { width:310, align:'center' });
  }
  let hy = 69;
  const credential = [show('showRegistrationNumber') && first(settings.registrationNumber, school.registrationNumber) ? `Registration No: ${first(settings.registrationNumber, school.registrationNumber)}` : '', show('showPostalAddress') && first(settings.postalAddress, settings.poBox, school.postalAddress, school.address) ? first(settings.postalAddress, settings.poBox, school.postalAddress, school.address) : ''].filter(Boolean).join('  •  ');
  if (credential) doc.fillColor('#5d6878').font('Helvetica').fontSize(6.2).text(credential, 100, hy, { width:355, align:'center' }), hy += 13;
  const contacts = [show('showPhone') && first(settings.phone, school.phone), show('showEmail') && first(settings.email, school.email), show('showWebsite') && first(settings.website, school.website), show('showCurriculum') ? `Curriculum: ${first(settings.curriculumLabel, snap.curriculum, report.curriculum, 'CBC')}` : ''].filter(Boolean).join('  •  ');
  if (contacts) doc.fillColor('#5d6878').font('Helvetica').fontSize(6.2).text(contacts, 88, hy, { width:382, align:'center' });
  doc.fillColor(primary).font('Times-Bold').fontSize(14).text('REPORT CARD', 466, 30, { width:105, align:'center' });
  doc.fillColor('#5d6878').font('Helvetica').fontSize(5.6).text(`Report ID: ${reportId}`, 455, 52, { width:130, align:'center' });
  if (show('showVerificationCode')) doc.text(`Verify at ${first(settings.verifyUrl, 'verify.shuleai.com')}  •  Code: ${verificationCode}`, 455, 62, { width:130, align:'center' });
  doc.rect(left, 118, width, 3).fill(accent);

  // Student information row
  const panelY = 134, panelH = 68;
  const photoW = 82, detailW = 152, midW = 155, lastW = width - photoW - detailW - midW;
  lineBox(left, panelY, width, panelH);
  [left+photoW, left+photoW+detailW, left+photoW+detailW+midW].forEach(x => doc.moveTo(x,panelY).lineTo(x,panelY+panelH).strokeColor('#d8dee8').lineWidth(.7).stroke());
  drawStudentPhoto(left+12, panelY+11, 58, 42);
  doc.fillColor(primary).font('Times-Bold').fontSize(10.5).text(String(studentName).toUpperCase(), left+photoW+8, panelY+8, { width:detailW-14 });
  cellText(`Elimu ID: ${first(student.elimuid, '-')}\nAdmission No: ${first(student.admissionNumber, '-')}\nClass Teacher: ${first(snap.classTeacher?.name, signatures.classTeacher?.name, 'Class Teacher')}`, left+photoW+5, panelY+27, detailW-10, 38, { size:6.4 });
  const promotionStatus = first(snap.promotionStatus, student.promotionStatus, snap.promotion?.status, settings.defaultPromotionStatus, '');
  cellText(`Class: ${first(student.className, student.grade, snap.class?.name, '-')}\nStream: ${first(student.stream, snap.class?.stream, '-')}\nReport Type: ${first(settings.reportTypeLabel, snap.reportTypeLabel, 'End Term Report')}${show('showPromotionStatus', true) && promotionStatus ? `\nPromotion Status: ${promotionStatus}` : ''}`, left+photoW+detailW+5, panelY+8, midW-10, panelH-12, { size:6.4 });
  cellText(`Term: ${report.term || snap.term || '-'}\nAcademic Year: ${report.year || snap.year || '-'}\nGenerated: ${generatedDate}\nPublished: ${publishedDate}`, left+photoW+detailW+midW+5, panelY+8, lastW-10, panelH-12, { size:6.4 });

  // Academic performance table
  let y = 230;
  sectionHeader('ACADEMIC PERFORMANCE', left, y, width, 22);
  y += 22;
  const assessmentColumns = (() => {
    const config = Array.isArray(snap.assessmentSettings) ? snap.assessmentSettings : [];
    const settingsCols = config.filter(x => x && x.showOnReport !== false).sort((a,b)=>Number(a.displayOrder||0)-Number(b.displayOrder||0)).slice(0,3).map((x, idx) => {
      const label = first(x.label, x.displayName, x.name, x.assessmentType, `Assessment ${idx+1}`);
      const weight = Number(x.weightPercent ?? x.weight ?? 0);
      return { ...x, label: weight ? `${label} (${weight}%)` : label };
    });
    if (settingsCols.length) return settingsCols;
    return ['CAT (40%)','Mid Term (20%)','End Term (40%)'].map((label,index)=>({label,index}));
  })();
  const widths = [24, 115, 58, 62, 62, 54, 44, width - 24 - 115 - 58 - 62 - 62 - 54 - 44];
  const xs=[]; widths.reduce((acc,w)=>{xs.push(acc);return acc+w;}, left);
  const heads = ['No.','Learning Area',...assessmentColumns.map(c=>c.label),'Final (100%)','Level','Teacher Remark'];
  doc.rect(left,y,width,22).fill(primary);
  heads.forEach((h,i)=>cellText(h, xs[i], y, widths[i], 22, { color:'#fff', font:'Helvetica-Bold', size:5.6, align:i>1?'center':'left' }));
  y += 22;
  const rows = subjects.length ? subjects : [{ subject:'No academic records yet', average:null, grade:'—', remark:'Marks will appear after assessment entry.' }];
  const rowH = Math.max(12, Math.min(18, Math.floor(144 / Math.max(1, rows.length))));
  rows.forEach((row,i)=>{
    if (i % 2 === 0) doc.rect(left,y,width,rowH).fill('#f5f7fb');
    lineBox(left,y,width,rowH);
    for (let c=1;c<xs.length;c++) doc.moveTo(xs[c],y).lineTo(xs[c],y+rowH).strokeColor('#d8dee8').lineWidth(.45).stroke();
    const final = row.average ?? row.finalScore ?? row.score ?? '—';
    const grade = row.grade || row.meanGrade || (Number.isFinite(Number(final)) ? (Number(final)>=80?'EE':Number(final)>=50?'ME':Number(final)>=30?'AE':'BE') : '—');
    const values = [String(i+1), row.subject || row.name || 'Learning Area', ...assessmentColumns.map((col,idx)=>scoreForColumn(row,col,idx)), final, grade, row.remark || row.teacherRemark || row.status || ''];
    values.forEach((value,idx)=>cellText(value, xs[idx], y, widths[idx], rowH, { size: rowH < 14 ? 5.1 : 6.0, font: idx===1 || idx===5 ? 'Helvetica-Bold':'Helvetica', align:idx>1 && idx<7 ? 'center':'left', color:idx===6 ? '#8a4b00':'#172033' }));
    y += rowH;
  });
  doc.fillColor('#64748b').font('Helvetica').fontSize(5.6).text('Performance Level Key:   EE Exceeding Expectation    ME Meeting Expectation    AE Approaching Expectation    BE Below Expectation', left, y+5, { width });
  y = 452;

  // Performance/attendance/core values
  const boxW = width / 3;
  function infoBox(x, title, lines) {
    lineBox(x, y, boxW, 91);
    doc.fillColor(primary).font('Times-Bold').fontSize(8.2).text(title, x+6, y+7, { width:boxW-12 });
    doc.fillColor('#172033').font('Helvetica-Bold').fontSize(6.4);
    lines.forEach((line,idx)=>doc.text(line, x+8, y+24+idx*12, { width:boxW-16, ellipsis:true }));
  }
  const avg = snap.overallAverage ?? snap.academicSummary?.overallAverage ?? '—';
  const grade = snap.overallGrade || snap.academicSummary?.overallGrade || '—';
  const att = snap.attendance || {};
  const attendanceRate = first(att.rate, att.attendanceRate, '—');
  const attendanceRemark = first(att.remark, Number(attendanceRate) >= 90 ? 'Very good attendance' : Number(attendanceRate) >= 75 ? 'Satisfactory attendance' : 'Attendance needs support');
  const core = snap.coreValues || snap.academic?.coreValues || snap.behaviour || {};
  infoBox(left, 'PERFORMANCE SUMMARY', [`Mean Score: ${avg}${avg === '—' ? '' : '%'}`, `Overall Grade: ${grade}`, `Class Position: ${first(snap.ranking?.classPosition, '—')}`, `Stream Position: ${first(snap.ranking?.streamPosition, '—')}`, `Subjects Taken: ${snap.countedSubjects ?? subjects.length ?? '—'}`]);
  infoBox(left+boxW, 'ATTENDANCE SUMMARY', show('showAttendance') ? [`School Days: ${first(att.total, '—')}`, `Present: ${first(att.present, '—')}`, `Absent: ${first(att.absent, '—')}`, `Attendance %: ${attendanceRate}${attendanceRate === '—' ? '' : '%'}`, `Remark: ${attendanceRemark}`] : ['Hidden by school settings.']);
  infoBox(left+boxW*2, 'CORE VALUES (CBC)', show('showCoreValues', true) ? [`Responsibility: ${valueFor(core,['Responsibility','responsibility'])}`, `Respect: ${valueFor(core,['Respect','respect'])}`, `Integrity: ${valueFor(core,['Integrity','integrity'])}`, `Peace & Unity: ${valueFor(core,['Peace & Unity','peaceAndUnity','peaceUnity'])}`, `Patriotism: ${valueFor(core,['Patriotism','patriotism'])}`] : ['Hidden by school settings.']);

  // Teacher feedback
  y = 590;
  if (show('showTeacherFeedback', true)) {
    sectionHeader('TEACHER FEEDBACK', left, y, width, 20);
    lineBox(left, y+20, width, 58);
    const strengths = first(snap.feedback?.strengths, snap.insights?.strengths, snap.academic?.strengths, '—');
    const support = first(snap.feedback?.support, snap.insights?.support, snap.academic?.support, '—');
    const recommendation = first(snap.feedback?.recommendation, snap.insights?.nextSteps, snap.academic?.recommendation, '—');
    doc.fillColor('#172033').font('Helvetica').fontSize(6.4).text(`Strengths: ${strengths}\nAreas Needing Support: ${support}\nRecommendation: ${recommendation}`, left+8, y+27, { width:width-16, height:46, ellipsis:true });
  }

  // Comments
  y = 680;
  const commentH = 68;
  const half = width/2;
  lineBox(left, y, width, commentH);
  doc.moveTo(left+half, y).lineTo(left+half, y+commentH).strokeColor('#d8dee8').lineWidth(.7).stroke();
  function commentBlock(x, title, text, name) {
    doc.fillColor(primary).font('Times-Bold').fontSize(8.2).text(title, x+8, y+9, { width:half-16 });
    doc.fillColor('#172033').font('Helvetica').fontSize(6.3).text(clean(text || '—'), x+8, y+24, { width:half-16, height:30, ellipsis:true });
    doc.fillColor('#172033').font('Helvetica-Oblique').fontSize(6.3).text(clean(name), x+8, y+54, { width:half-16 });
  }
  commentBlock(left, "CLASS TEACHER'S COMMENT", show('showTeacherComment') ? first(snap.comments?.classTeacher, snap.comments?.general, snap.academic?.teacherComment, '') : 'Hidden by school settings.', first(snap.classTeacher?.name, signatures.classTeacher?.name, 'Class Teacher'));
  commentBlock(left+half, "HEADTEACHER'S COMMENT", show('showHeadteacherComment') ? first(snap.comments?.headteacher, snap.headteacherComment, '') : 'Hidden by school settings.', first(snap.headteacher?.name, snap.principal?.name, signatures.headteacher?.name, 'Headteacher / Principal'));

  // Term information
  y = 774;
  if (show('showTermInformation', true)) {
    sectionHeader('TERM INFORMATION', left, y, width, 18);
    lineBox(left, y+18, width, 22);
    const colW = width/3;
    const termInfo = snap.termInformation || snap.termInfo || {};
    const closingDate = first(termInfo.closingDate, snap.closingDate, settings.closingDate, '—');
    const opensNextTerm = first(termInfo.opensNextTerm, snap.opensNextTerm, settings.opensNextTerm, '—');
    const feeBalance = first(termInfo.feeBalance, snap.feeBalance, snap.finance?.feeBalance, student.feeBalance, settings.feeBalance, '—');
    [ [`Closing Date: ${closingDate}`, left], [`Opens Next Term: ${opensNextTerm}`, left+colW], [`Fee Balance: ${feeBalance}`, left+colW*2] ].forEach(([txt,x],idx)=>{
      if(idx) doc.moveTo(x,y+18).lineTo(x,y+40).strokeColor('#d8dee8').lineWidth(.7).stroke();
      doc.fillColor(idx===2?'#b42318':'#172033').font('Helvetica-Bold').fontSize(6.2).text(txt, x+5, y+26, { width:colW-10, ellipsis:true });
    });
  }

  // Signatures and footer
  const sigY = 814;
  if (show('showSignatures', true)) {
    const sigs = [
      ['Class Teacher', first(snap.classTeacher?.name, signatures.classTeacher?.name, 'Class Teacher')],
      ['Headteacher / Principal', first(snap.headteacher?.name, snap.principal?.name, signatures.headteacher?.name, 'Headteacher / Principal')],
      ['Parent / Guardian', 'Sign & Date']
    ];
    sigs.forEach((item,i)=>{
      const sw = width/3 - 24;
      const x = left + i*(width/3) + 12;
      doc.moveTo(x, sigY).lineTo(x+sw, sigY).strokeColor('#94a3b8').lineWidth(.8).stroke();
      doc.fillColor('#172033').font('Helvetica-Bold').fontSize(5.8).text(item[0], x, sigY+7, { width:sw, align:'left' });
      doc.fillColor('#172033').font('Helvetica').fontSize(5.6).text(item[1], x, sigY+17, { width:sw, align:'left' });
    });
  }
  doc.fillColor('#64748b').font('Helvetica').fontSize(5.6).text(`${schoolName} • ${report.term || snap.term || ''}, ${report.year || snap.year || ''} • Page 1 of 1 • Report ID: ${reportId} • Verification Code: ${verificationCode}`, left, pageH-14, { width, align:'center' });
  doc.end();
}


async function resolveRequestedStudentId(req, raw) {
  const scopedInclude = [{ model: User, required: true, where: { schoolCode: code(req), role: 'student' }, attributes: ['id','name','schoolCode'] }];
  if (req.user.role === 'student') {
    const mine = await (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ userId:req.user.id }, include:scopedInclude }).catch(()=>null);
    return Number(mine?.id) || -1;
  }
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) {
    const direct = await (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ id:n }, include:scopedInclude }).catch(()=>null);
    if (direct) return direct.id;
    const byUser = await (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ userId:n }, include:scopedInclude }).catch(()=>null);
    if (byUser) return byUser.id;
  }
  const text = String(raw || '').trim();
  if (text) {
    const byElimu = await (Student.unscoped ? Student.unscoped() : Student).findOne({ where:{ [Op.or]:[{ elimuid:text }, { admissionNumber:text }] }, include:scopedInclude }).catch(()=>null);
    if (byElimu) return byElimu.id;
  }
  return n || -1;
}

async function findReadableReport(req, where) {
  const report = await ReportSnapshot.findOne({ where:{ ...where, schoolCode:code(req) }, order:[['year','DESC'],['publishedAt','DESC'],['version','DESC']] });
  return (await canRead(req,report)) ? report : null;
}

exports.list = async (req,res) => {
  try {
    const where = { schoolCode:code(req), status:{ [Op.in]:['published','archived'] } };
    if (req.query.studentId) where.studentId = Number(req.query.studentId);
    if (req.query.term) where.term = req.query.term;
    if (req.query.year) where.year = Number(req.query.year);
    if (req.user.role === 'student') where.studentId = (await studentForUser(req.user.id))?.id || -1;
    if (req.user.role === 'parent') {
      const parent = await Parent.findOne({ where:{ userId:req.user.id } });
      const links = parent ? await StudentParent.findAll({ where:{ parentId:parent.id } }) : [];
      const linkedIds = links.map(x=>Number(x.studentId)).filter(Boolean);
      const requested = req.query.studentId ? await resolveRequestedStudentId(req, req.query.studentId) : null;
      where.studentId = requested && linkedIds.includes(Number(requested)) ? requested : { [Op.in]:linkedIds };
    }
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
      let ids = [];
      if (teacher) {
        const classes = teacher ? await schoolLinkageService.resolveTeacherAssignedClasses(req.user.id, code(req), { classTeacherOnly:true }).catch(()=>[]) : [];
        const assigned = await TeacherSubjectAssignment.findAll({ where:{ teacherId:teacher.id, isClassTeacher:true }, attributes:['classId'] }).catch(()=>[]);
        ids = [...new Set([...classes.map(c=>c.id), ...assigned.map(a=>a.classId)].filter(Boolean).map(Number))];
      }
      where.classId = { [Op.in]:ids };
    }
    const rows = await snapshotService.listHistory(where, { limit:500, attributes:{ exclude:['sourceRecordIds'] } });
    res.json({ success:true, data:rows });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.getOne = async (req,res) => {
  try {
    const row = await ReportSnapshot.findOne({ where:{ id:Number(req.params.id), schoolCode:code(req) } });
    if (!(await canRead(req,row))) return res.status(403).json({ success:false, message:'You are not allowed to view this report card' });
    res.json({ success:true, data:row });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.downloadPdf = async (req,res) => {
  try {
    const report = await findReadableReport(req, { id:Number(req.params.id), status:{ [Op.in]:['published','archived'] } });
    if (!report) return res.status(403).json({ success:false, message:'You are not allowed to download this report card' });
    await streamReportPdf(res,report);
  } catch (error) { if (!res.headersSent) res.status(500).json({ success:false, message:error.message }); else res.end(); }
};

exports.downloadLatestPdf = async (req,res) => {
  try {
    const resolvedStudentId = await resolveRequestedStudentId(req, req.params.studentId);
    const report = await findReadableReport(req, { studentId:resolvedStudentId, status:'published', isCurrent:true });
    if (!report) return res.status(404).json({ success:false, message:'This report card has not yet been published by the school.' });
    await streamReportPdf(res,report);
  } catch (error) { if (!res.headersSent) res.status(500).json({ success:false, message:error.message }); else res.end(); }
};

exports.correct = async (req,res) => {
  try {
    if (!['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success:false, message:'Only an authorised school administrator can correct a published report card' });
    const previous = await ReportSnapshot.findOne({ where:{ id:Number(req.params.id), schoolCode:code(req), isCurrent:true } });
    if (!previous) return res.status(404).json({ success:false, message:'Current report card version not found' });
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ success:false, message:'A correction reason is required' });
    const result = await snapshotService.createPublishedVersion({ ...previous.toJSON(), snapshot:req.body.snapshot || previous.snapshot, correctionReason:reason, publishedBy:req.user.id, generatedBy:req.user.id, publishedAt:new Date(), assessmentKey:previous.assessmentKey });
    res.status(201).json({ success:true, message:`Report card version ${result.row.version} created. Version ${previous.version} remains in history.`, data:result.row });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.share = async (req,res) => {
  try {
    const report = await ReportSnapshot.findOne({ where:{ id:Number(req.params.id), schoolCode:code(req), status:'published', isCurrent:true } });
    if (!(await canRead(req,report)) || req.user.role === 'student') return res.status(403).json({ success:false, message:'You are not allowed to share this report card' });
    const channel = String(req.body.channel || 'secure_link');
    if (!['secure_link','email','school_chat'].includes(channel)) return res.status(400).json({ success:false, message:'Unsupported report sharing channel' });
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + Math.min(Math.max(Number(req.body.expiresHours || 72),1),168) * 3600000);
    const share = await ReportShare.create({ schoolCode:code(req), reportSnapshotId:report.id, studentId:report.studentId, recipientUserId:req.body.recipientUserId || null, channel, recipientAddress:req.body.recipientAddress || null, tokenHash:crypto.createHash('sha256').update(rawToken).digest('hex'), expiresAt, status:'sent', sentBy:req.user.id, sentAt:new Date(), metadata:{ deliveryNote: channel === 'secure_link' ? 'Expiring secure link created' : 'Delivery queued for configured provider' } });
    res.status(201).json({ success:true, message:'Report sharing record created and logged.', data:{ shareId:share.id, token:rawToken, expiresAt, channel } });
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};

exports.openShared = async (req,res) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(String(req.params.token || '')).digest('hex');
    const share = await ReportShare.findOne({ where:{ tokenHash, status:'sent', expiresAt:{ [Op.gt]:new Date() } } });
    if (!share) return res.status(404).json({ success:false, message:'This secure report link is invalid or has expired' });
    const report = await ReportSnapshot.findOne({ where:{ id:share.reportSnapshotId, schoolCode:share.schoolCode, status:{ [Op.in]:['published','archived'] } } });
    if (!report) return res.status(404).json({ success:false, message:'Report card not found' });
    await share.update({ status:'delivered', deliveredAt:new Date() });
    await streamReportPdf(res, report);
  } catch (error) { res.status(500).json({ success:false, message:error.message }); }
};
