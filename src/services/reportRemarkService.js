
function scoreBand(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'pending';
  if (n >= 80) return 'EE';
  if (n >= 50) return 'ME';
  if (n >= 30) return 'AE';
  return 'BE';
}
function subjectRemark({ subject, score, level, trend }) {
  const band = level || scoreBand(score);
  const name = subject || 'this learning area';
  if (band === 'EE') return `Excellent performance in ${name}. The learner shows strong understanding, confidence and consistency.`;
  if (band === 'ME') return `Good progress in ${name}. The learner is meeting expectations and should continue practising to build confidence.`;
  if (band === 'AE') return `The learner is approaching expectations in ${name} and needs targeted support, regular practice and teacher follow-up.`;
  if (band === 'BE') return `The learner needs close support in ${name}. Regular guided practice and parent-teacher follow-up are recommended.`;
  return `Assessment for ${name} is still pending. Add marks to generate a more accurate remark.`;
}
function classTeacherComment({ studentName='The learner', average=0, attendanceRate=0, strengths='', needs='' }) {
  const avg = Number(average) || 0;
  const att = Number(attendanceRate) || 0;
  const performance = avg >= 80 ? 'excellent' : avg >= 60 ? 'steady' : avg >= 40 ? 'developing' : 'needing close support';
  const attendance = att >= 90 ? 'Attendance has been very good.' : att >= 75 ? 'Attendance is fair but should be monitored.' : 'Attendance needs urgent improvement.';
  return `${studentName} has shown ${performance} progress this term. ${attendance} ${strengths ? `Strengths include ${strengths}. ` : ''}${needs ? `More support is needed in ${needs}. ` : ''}Continued practice and guidance will help the learner improve further.`.replace(/\s+/g,' ').trim();
}
function headteacherComment({ studentName='The learner', promotionStatus='', classTeacherCommentText='' }) {
  const promotion = promotionStatus ? ` ${promotionStatus}.` : '';
  return `${studentName} has demonstrated a positive attitude towards learning.${promotion} The learner is encouraged to maintain discipline, consistency and effort in the next term.`.replace(/\s+/g,' ').trim();
}
function generateReportRemarks(payload={}) {
  const subjects = Array.isArray(payload.subjects) ? payload.subjects : [];
  const subjectRemarks = {};
  subjects.forEach(row => { const key = row.subject || row.name; if (key) subjectRemarks[key] = subjectRemark({ subject:key, score:row.score ?? row.average, level:row.level || row.grade }); });
  return {
    subjectRemarks,
    strengths: payload.strengths || '',
    areasNeedingSupport: payload.areasNeedingSupport || '',
    recommendation: payload.recommendation || 'Continue with regular revision, reading and guided practice.',
    classTeacherComment: classTeacherComment(payload),
    headteacherComment: headteacherComment(payload),
    source: 'system_generated_rule_based',
    requiresHumanApproval: true
  };
}
module.exports = { scoreBand, subjectRemark, classTeacherComment, headteacherComment, generateReportRemarks };
