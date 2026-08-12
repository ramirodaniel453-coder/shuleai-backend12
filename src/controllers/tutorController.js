const { Op } = require('sequelize');
const { TutorSession, TutorMessage, TutorProgress, TutorUsage, Student, User, Parent, StudentParent, Class, Teacher, TeacherSubjectAssignment, AcademicRecord, Attendance, Subscription, SubscriptionPlan } = require('../models');
const { detectCommand } = require('../services/tutor/commandDetector');
const { LEVELS, normalizeGrade, getLevelByGrade, detectSubject } = require('../services/tutor/curriculumSubjects');
const { detectTopic, buildTutorAnswer } = require('../services/tutor/tutorKnowledge');
const { callStudentTutorAI, getAIProviderConfig } = require('../services/aiProviderService');

// v127: Final parent subscription AI rules.
// Basic has NO AI Tutor. Premium has 6 AI messages/day. Ultimate has extended access.
// Legacy Essential/Smart/Genius codes remain accepted as aliases so old active subscriptions do not crash;
// they are normalized into Basic/Premium/Ultimate behavior.
const CHILD_AI_PLAN_LIMITS = {
  child_basic: { daily: 0, monthly: 0, label: 'Basic', aiTutor: false },
  basic: { daily: 0, monthly: 0, label: 'Basic', aiTutor: false },
  child_essential: { daily: 0, monthly: 0, label: 'Basic', aiTutor: false },
  essential: { daily: 0, monthly: 0, label: 'Basic', aiTutor: false },
  child_premium: { daily: 6, monthly: 180, label: 'Premium', aiTutor: true },
  premium: { daily: 6, monthly: 180, label: 'Premium', aiTutor: true },
  child_smart: { daily: 6, monthly: 180, label: 'Premium', aiTutor: true },
  smart: { daily: 6, monthly: 180, label: 'Premium', aiTutor: true },
  child_ultimate: { daily: 50, monthly: 1500, label: 'Ultimate', aiTutor: true },
  ultimate: { daily: 50, monthly: 1500, label: 'Ultimate', aiTutor: true },
  child_genius: { daily: 50, monthly: 1500, label: 'Ultimate', aiTutor: true },
  genius: { daily: 50, monthly: 1500, label: 'Ultimate', aiTutor: true }
};

function todayISO() { return new Date().toISOString().slice(0, 10); }
function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }

function normalizePlanCode(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (!raw) return 'child_basic';
  if (raw.includes('genius') || raw === 'ultimate' || raw === 'child_ultimate') return 'child_ultimate';
  if (raw.includes('smart') || raw === 'premium' || raw === 'child_premium') return 'child_premium';
  if (raw.includes('essential') || raw === 'basic' || raw === 'child_basic') return 'child_basic';
  return raw.startsWith('child_') ? raw : `child_${raw}`;
}

function planLimitsFrom(subscription, plan) {
  const planCode = normalizePlanCode(subscription?.planCode || plan?.code || plan?.name || subscription?.planName);
  const defaults = CHILD_AI_PLAN_LIMITS[planCode] || CHILD_AI_PLAN_LIMITS.child_basic;
  const limits = { ...(plan?.limits || {}), ...(subscription?.limits || {}) };
  const explicitAi = limits.aiTutor ?? limits.aiTutorEnabled ?? limits.aiTutorAccess ?? defaults.aiTutor;
  const aiTutorEnabled = explicitAi === true || explicitAi === 'true' || explicitAi === 1 || explicitAi === '1' || defaults.aiTutor === true;
  const dailyRaw = limits.aiQuestionsPerDay ?? limits.dailyAiTutorQuestions ?? limits.dailyQuestions ?? defaults.daily;
  const monthlyRaw = limits.aiQuestionsPerMonth ?? limits.monthlyAiTutorQuestions ?? limits.monthlyQuestions ?? defaults.monthly;
  const daily = Number(dailyRaw);
  const monthly = Number(monthlyRaw);
  return {
    planCode,
    planName: subscription?.planName || plan?.displayName || plan?.name || defaults.label,
    aiTutorEnabled,
    dailyLimit: aiTutorEnabled && Number.isFinite(daily) && daily > 0 ? daily : defaults.daily,
    monthlyLimit: aiTutorEnabled && Number.isFinite(monthly) && monthly > 0 ? monthly : defaults.monthly
  };
}

function safeTutorText(value, fallback = 'Tutor message') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

async function resolveStudent(req) {
  if (req.user.role !== 'student') return null;

  // Student records do NOT carry schoolCode in the current schema.
  // Tenant ownership is enforced through the linked User.schoolCode.
  // This prevents the production error: column Student.schoolCode does not exist.
  const student = await Student.findOne({
    where: { userId: req.user.id },
    include: [{
      model: User,
      attributes: ['id', 'name', 'email', 'schoolCode'],
      required: true,
      where: { schoolCode: req.user.schoolCode }
    }]
  });

  return student;
}

async function getActiveChildSubscription(studentId, schoolCode) {
  const subscription = await Subscription.findOne({
    where: {
      ownerType: 'child',
      studentId,
      schoolCode,
      status: 'active',
      endDate: { [Op.gt]: new Date() }
    },
    include: [{ model: SubscriptionPlan, required: false }],
    order: [['endDate', 'DESC']]
  });
  return subscription;
}

async function getMonthlyUsage(schoolId, studentId, usageMonth) {
  const rows = await TutorUsage.findAll({ where: { schoolId, studentId, usageMonth } });
  return rows.reduce((sum, row) => sum + Number(row.totalQuestions || 0), 0);
}

async function createTutorMessage({ schoolId, schoolCode, sessionId, studentId, userId, role, text, subject, topic, command, source, metadata }) {
  const safeText = safeTutorText(text, role === 'tutor' ? 'I am ready to help you learn. Ask me any question.' : 'Student question');
  return TutorMessage.create({
    schoolId,
    schoolCode,
    sessionId,
    studentId,
    userId,
    role,
    message: safeText,
    content: safeText,
    subject,
    topic,
    command,
    source,
    metadata: metadata || {}
  });
}

function buildTutorSessionTitle(question, subject, topic, command) {
  const clean = String(question || '').replace(/\s+/g, ' ').trim();
  const safeSubject = String(subject || '').replace(/\s+/g, ' ').trim();
  const safeTopic = String(topic || '').replace(/\s+/g, ' ').trim();
  const safeCommand = String(command || '').replace(/\s+/g, ' ').trim();
  if (safeTopic && safeSubject) return `${safeSubject}: ${safeTopic}`.slice(0, 90);
  if (safeSubject) return `${safeSubject} Tutor Session`.slice(0, 90);
  if (safeCommand && safeCommand !== 'ask') return `${safeCommand.charAt(0).toUpperCase() + safeCommand.slice(1)} Tutor Session`.slice(0, 90);
  if (clean) return (clean.length > 64 ? `${clean.slice(0, 61)}...` : clean) || 'AI Tutor Session';
  return 'AI Tutor Session';
}

exports.getTutorConfig = async (req, res) => {
  const providerConfig = getAIProviderConfig();
  res.json({
    success: true,
    data: {
      levels: LEVELS,
      commands: ['ask', 'explain', 'solve', 'quiz', 'summarize', 'revise', 'homework', 'weakness', 'plan'],
      access: 'student_subscription_required',
      freeTier: false,
      provider: providerConfig.provider,
      model: providerConfig.provider === 'anthropic' ? providerConfig.anthropic.model : providerConfig.deepseek.model,
      plans: [
        { code: 'child_basic', name: 'Basic', aiTutor: false, dailyLimit: 0, monthlyLimit: 0, priceKes: 100, features: ['Report cards', 'Attendance', 'Progress'] },
        { code: 'child_premium', name: 'Premium', aiTutor: true, dailyLimit: 6, monthlyLimit: 180, priceKes: 250, features: ['Everything in Basic', 'AI Tutor: 6 messages/day', 'Child timetable if school has timetable'] },
        { code: 'child_ultimate', name: 'Ultimate', aiTutor: true, dailyLimit: 50, monthlyLimit: 1500, priceKes: 500, features: ['Everything in Premium', 'Extended AI Tutor', 'Live child analytics', 'Stronger alerts', 'Child recommendations'] }
      ]
    }
  });
};

exports.askTutor = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'AI Tutor is currently available to students only.', data: { locked: true, reason: 'student_only' } });
    }

    const { question = '', grade, gradeLevel, level: requestedLevel, subject, mode, curriculum, sessionId } = req.body;
    if (!String(question).trim()) return res.status(400).json({ success: false, message: 'Question is required' });

    const schoolId = req.user.schoolCode || 'default';
    const student = await resolveStudent(req);
    if (!student) return res.status(403).json({ success: false, message: 'Student profile not found for this account.' });
    const realStudentId = student.id;

    const subscription = await getActiveChildSubscription(realStudentId, schoolId);
    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'AI Tutor is locked. Ask your parent to activate Premium or Ultimate for this child. Basic includes report cards, attendance and progress only.',
        data: { locked: true, subscriptionRequired: true, freeTier: false, plans: ['Premium', 'Ultimate'], basicIncludesAiTutor: false }
      });
    }

    const plan = subscription.SubscriptionPlan || await SubscriptionPlan.findByPk(subscription.planId).catch(() => null);
    const planLimit = planLimitsFrom(subscription, plan);
    if (!planLimit.aiTutorEnabled || planLimit.dailyLimit <= 0) {
      return res.status(403).json({
        success: false,
        message: 'AI Tutor is not included in Basic. Upgrade this child to Premium for 6 messages/day or Ultimate for extended access.',
        data: { locked: true, reason: 'ai_not_in_plan', plan: planLimit.planName, planCode: planLimit.planCode, requiredPlans: ['Premium', 'Ultimate'] }
      });
    }
    const usageDate = todayISO();
    const usageMonth = monthKey();
    let usage = await TutorUsage.findOne({ where: { schoolId, studentId: realStudentId, usageDate } });
    if (!usage) {
      usage = await TutorUsage.create({
        schoolId,
        schoolCode: schoolId,
        studentId: realStudentId,
        subscriptionId: subscription.id,
        planCode: planLimit.planCode,
        usageDate,
        usageMonth,
        totalQuestions: 0,
        aiCalls: 0,
        dailyLimit: planLimit.dailyLimit,
        monthlyLimit: planLimit.monthlyLimit
      });
    }

    const monthlyUsed = await getMonthlyUsage(schoolId, realStudentId, usageMonth);
    if (Number(usage.totalQuestions || 0) >= planLimit.dailyLimit) {
      return res.status(403).json({ success: false, message: `Daily AI tutor limit reached for ${planLimit.planName}. Try again tomorrow or upgrade the child's plan.`, data: { locked: true, dailyLimit: planLimit.dailyLimit, usedToday: usage.totalQuestions, plan: planLimit.planName } });
    }
    if (monthlyUsed >= planLimit.monthlyLimit) {
      return res.status(403).json({ success: false, message: `Monthly AI tutor limit reached for ${planLimit.planName}. Renew or upgrade the child's plan to continue.`, data: { locked: true, monthlyLimit: planLimit.monthlyLimit, usedThisMonth: monthlyUsed, plan: planLimit.planName } });
    }

    const rawGrade = grade || gradeLevel || student.grade || student.className || student.Class?.name || 'Grade 5';
    const realGrade = normalizeGrade(rawGrade || 'Grade 5');
    const level = getLevelByGrade(realGrade) || getLevelByGrade('Grade 5');
    const realSubject = subject || detectSubject(question, realGrade);
    const command = req.body.command || detectCommand(question);
    const topic = detectTopic(question, realSubject);

    const localAnswer = buildTutorAnswer({ question, command, subject: realSubject, topic, grade: realGrade, level });
    const recentMarks = await AcademicRecord.findAll({ where: { studentId: realStudentId, schoolCode: schoolId }, order: [['createdAt','DESC']], limit: 5 }).catch(() => []);
    const recentAttendance = await Attendance.findAll({ where: { studentId: realStudentId, schoolCode: schoolId }, order: [['date','DESC']], limit: 5 }).catch(() => []);

    let aiResult;
    try {
      aiResult = await callStudentTutorAI({
        question,
        command,
        subject: realSubject,
        topic,
        grade: realGrade,
        curriculum: curriculum || student.curriculum || 'cbc',
        studentContext: {
          recentMarks: recentMarks.map(r => ({ subject: r.subject, score: r.score, term: r.term, year: r.year })),
          recentAttendance: recentAttendance.map(a => ({ date: a.date, status: a.status }))
        }
      });
    } catch (aiError) {
      console.error('Student AI tutor provider failed:', aiError.message);
      return res.status(aiError.status || 503).json({ success: false, message: 'Shule AI Tutor could not answer right now. Please try again shortly. Your usage has not been deducted.', data: { usageDeducted: false } });
    }

    const answer = { ...localAnswer, answer: localAnswer.answer || 'Shule AI response', explanation: aiResult.text || localAnswer.explanation, source: aiResult.provider, model: aiResult.model };
    const sessionTitle = buildTutorSessionTitle(question, realSubject, topic, command);
    let session = null;
    if (sessionId) session = await TutorSession.findOne({ where:{ id:Number(sessionId), schoolId, studentId:realStudentId, userId:req.user.id } });
    if (!session) {
      session = await TutorSession.create({
        schoolId, schoolCode: schoolId, studentId: realStudentId, userId: req.user.id,
        title: sessionTitle, grade: realGrade, gradeLevel: realGrade,
        level: level.id || requestedLevel || 'upper_primary', subject: realSubject,
        mode: mode || command || 'ask', lastCommand: command || 'ask',
        metadata: { source: 'student-dashboard', rawGrade, title: sessionTitle, provider: aiResult.provider, model: aiResult.model, subscriptionId: subscription.id, planCode: planLimit.planCode }
      });
    } else {
      await session.update({ subject:realSubject || session.subject, lastCommand:command || session.lastCommand, updatedAt:new Date() });
    }
    await createTutorMessage({ schoolId, schoolCode: schoolId, sessionId: session.id, studentId: realStudentId, userId: req.user.id, role: 'student', text: question, subject: realSubject, topic, command, source: 'student' });
    await createTutorMessage({ schoolId, schoolCode: schoolId, sessionId: session.id, studentId: realStudentId, userId: req.user.id, role: 'tutor', text: answer.explanation, subject: realSubject, topic, command, source: aiResult.provider, metadata: answer });

    const [progress] = await TutorProgress.findOrCreate({ where: { schoolId, studentId: realStudentId, subject: realSubject, topic }, defaults: { schoolId, schoolCode: schoolId, studentId: realStudentId, grade: realGrade, level: level.id, subject: realSubject, topic, attempts: 0, correct: 0 } });
    await progress.update({ attempts: progress.attempts + 1, lastCommand: command, lastSource: answer.source, lastStudiedAt: new Date() });

    const promptTokens = Number(aiResult.usage?.prompt_tokens || aiResult.usage?.input_tokens || 0);
    const completionTokens = Number(aiResult.usage?.completion_tokens || aiResult.usage?.output_tokens || 0);
    await usage.update({
      totalQuestions: Number(usage.totalQuestions || 0) + 1,
      monthlyQuestionsUsed: monthlyUsed + 1,
      aiCalls: Number(usage.aiCalls || 0) + 1,
      subscriptionId: subscription.id,
      planCode: planLimit.planCode,
      dailyLimit: planLimit.dailyLimit,
      monthlyLimit: planLimit.monthlyLimit,
      provider: aiResult.provider,
      model: aiResult.model,
      inputTokens: Number(usage.inputTokens || 0) + promptTokens,
      outputTokens: Number(usage.outputTokens || 0) + completionTokens
    });

    res.json({
      success: true,
      data: {
        ...answer,
        command,
        subject: realSubject,
        grade: realGrade,
        level: level.name,
        supportedSubjects: level.subjects,
        sessionId: session.id,
        aiLabel: 'Generated by Shule AI Tutor',
        sessionTitle: session.title,
        usage: {
          used: Number(usage.totalQuestions || 0) + 1,
          limit: planLimit.dailyLimit,
          usedThisMonth: monthlyUsed + 1,
          monthlyLimit: planLimit.monthlyLimit,
          plan: planLimit.planName,
          planCode: planLimit.planCode
        }
      }
    });
  } catch (error) {
    console.error('Ask tutor error:', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getProgress = async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Tutor progress is currently student-only.' });
    const schoolId = req.user.schoolCode || 'default';
    const student = await resolveStudent(req);
    if (!student) return res.status(403).json({ success: false, message: 'Student profile not found' });
    const progress = await TutorProgress.findAll({ where: { schoolId, studentId: student.id }, order: [['updatedAt', 'DESC']] });
    res.json({ success: true, data: progress });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};

exports.listTutorSessions = async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ success:false, message:'Tutor history is student-only.' });
    const schoolId=req.user.schoolCode||'default'; const student=await resolveStudent(req);
    if(!student)return res.status(403).json({success:false,message:'Student profile not found'});
    const sessions=await TutorSession.findAll({where:{schoolId,studentId:student.id,userId:req.user.id},order:[['updatedAt','DESC']],limit:100});
    const counts=await TutorMessage.findAll({where:{schoolId,studentId:student.id},attributes:['sessionId',[require('sequelize').fn('COUNT',require('sequelize').col('id')),'messageCount']],group:['sessionId'],raw:true}).catch(()=>[]);
    const map=new Map(counts.map(r=>[String(r.sessionId),Number(r.messageCount||0)]));
    res.json({success:true,data:sessions.map(row=>({...row.toJSON(),messageCount:map.get(String(row.id))||0}))});
  } catch(error){res.status(500).json({success:false,message:error.message});}
};
exports.getTutorSession = async (req,res)=>{
  try{
    if(req.user.role!=='student')return res.status(403).json({success:false,message:'Tutor history is student-only.'});
    const schoolId=req.user.schoolCode||'default';const student=await resolveStudent(req);if(!student)return res.status(403).json({success:false,message:'Student profile not found'});
    const session=await TutorSession.findOne({where:{id:Number(req.params.id),schoolId,studentId:student.id,userId:req.user.id}});if(!session)return res.status(404).json({success:false,message:'Tutor chat not found'});
    const messages=await TutorMessage.findAll({where:{schoolId,studentId:student.id,sessionId:session.id},order:[['createdAt','ASC']]});
    res.json({success:true,data:{session,messages}});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};
exports.createTutorSession = async (req,res)=>{
  try{
    if(req.user.role!=='student')return res.status(403).json({success:false,message:'Tutor chats are student-only.'});
    const schoolId=req.user.schoolCode||'default';const student=await resolveStudent(req);if(!student)return res.status(403).json({success:false,message:'Student profile not found'});
    const session=await TutorSession.create({schoolId,schoolCode:schoolId,studentId:student.id,userId:req.user.id,title:String(req.body?.title||'New Tutor Chat').slice(0,90),grade:String(req.body?.grade||student.grade||'Grade 5'),gradeLevel:String(req.body?.grade||student.grade||'Grade 5'),level:String(req.body?.level||'upper_primary'),subject:String(req.body?.subject||'General'),mode:'ask',lastCommand:'ask',metadata:{source:'student-dashboard',empty:true}});
    res.status(201).json({success:true,data:session});
  }catch(error){res.status(500).json({success:false,message:error.message});}
};

exports.getSessionHistory = async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Tutor history is currently student-only.' });
    const schoolId = req.user.schoolCode || 'default';
    const student = await resolveStudent(req);
    if (!student) return res.status(403).json({ success: false, message: 'Student profile not found' });
    const messages = await TutorMessage.findAll({ where: { schoolId, studentId: student.id }, order: [['createdAt', 'DESC']], limit: 40 });
    res.json({ success: true, data: messages.reverse() });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};

exports.submitPracticeAnswer = async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Practice answers are currently student-only.' });
    const { subject = 'General', topic = 'Practice', isCorrect = false } = req.body;
    const schoolId = req.user.schoolCode || 'default';
    const student = await resolveStudent(req);
    if (!student) return res.status(403).json({ success: false, message: 'Student profile not found' });
    const [progress] = await TutorProgress.findOrCreate({ where: { schoolId, studentId: student.id, subject, topic }, defaults: { schoolId, schoolCode: schoolId, studentId: student.id, subject, topic } });
    await progress.update({ attempts: progress.attempts + 1, correct: progress.correct + (isCorrect ? 1 : 0), lastCommand: 'quiz', lastStudiedAt: new Date() });
    res.json({ success: true, data: { correct: !!isCorrect, progress } });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.message }); }
};

async function buildTutorReportRows(studentIds, schoolCode) {
  const ids = [...new Set((studentIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return new Map();
  const [progressRows, usageRows, sessionRows] = await Promise.all([
    TutorProgress.findAll({ where: { schoolId: schoolCode, studentId: { [Op.in]: ids } }, order: [['lastStudiedAt', 'DESC']] }),
    TutorUsage.findAll({ where: { schoolId: schoolCode, studentId: { [Op.in]: ids } }, order: [['usageDate', 'DESC']] }),
    TutorSession.findAll({ where: { schoolId: schoolCode, studentId: { [Op.in]: ids } }, attributes: ['id','studentId','subject','lastCommand','updatedAt'], order: [['updatedAt','DESC']] })
  ]);
  const byStudent = new Map(ids.map(id => [id, { progress: [], usage: [], sessions: [] }]));
  for (const row of progressRows) byStudent.get(Number(row.studentId))?.progress.push(row);
  for (const row of usageRows) byStudent.get(Number(row.studentId))?.usage.push(row);
  for (const row of sessionRows) byStudent.get(Number(row.studentId))?.sessions.push(row);
  return byStudent;
}

function summarizeTutorActivity(bucket = {}) {
  const progress = bucket.progress || [];
  const usage = bucket.usage || [];
  const sessions = bucket.sessions || [];
  const attempts = progress.reduce((sum, row) => sum + Number(row.attempts || 0), 0);
  const correct = progress.reduce((sum, row) => sum + Number(row.correct || 0), 0);
  const questions = usage.reduce((sum, row) => sum + Number(row.totalQuestions || 0), 0);
  const aiCalls = usage.reduce((sum, row) => sum + Number(row.aiCalls || 0), 0);
  return {
    questions, aiCalls, sessionCount: sessions.length, attempts, correct,
    accuracy: attempts ? Math.round((correct / attempts) * 1000) / 10 : null,
    subjects: [...new Set(progress.map(row => row.subject).filter(Boolean))],
    recentTopics: progress.slice(0, 8).map(row => ({ subject: row.subject, topic: row.topic, attempts: row.attempts, correct: row.correct, lastStudiedAt: row.lastStudiedAt })),
    lastActiveAt: sessions[0]?.updatedAt || progress[0]?.lastStudiedAt || usage[0]?.updatedAt || null
  };
}

exports.getParentReport = async (req, res) => {
  try {
    const schoolCode = req.user.schoolCode;
    let parent = null;
    if (req.user.role === 'parent') {
      parent = await Parent.findOne({ where: { userId: req.user.id } });
      if (!parent) return res.status(404).json({ success:false, message:'Parent profile not found' });
      if (req.params.parentId && Number(req.params.parentId) !== Number(parent.id)) return res.status(403).json({ success:false, message:'You can only view your own children’s tutor report' });
    } else {
      const parentId = Number(req.params.parentId);
      if (!Number.isInteger(parentId)) return res.status(400).json({ success:false, message:'parentId is required for an admin report' });
      parent = await Parent.findByPk(parentId);
      if (!parent) return res.status(404).json({ success:false, message:'Parent not found' });
    }
    const links = await StudentParent.findAll({ where: { parentId: parent.id, [Op.or]: [{ status:'active' }, { status:null }] }, attributes:['studentId'] });
    const ids = links.map(link => Number(link.studentId)).filter(Number.isInteger);
    const students = ids.length ? await Student.unscoped().findAll({
      where: { id: { [Op.in]: ids } },
      attributes:['id','elimuid','grade','classId'],
      include:[{ model:User, attributes:['id','name','schoolCode'], required:true, where:{ schoolCode } }],
      order:[[User,'name','ASC']]
    }) : [];
    const activity = await buildTutorReportRows(students.map(student => student.id), schoolCode);
    return res.json({ success:true, data:{ parentId:parent.id, children:students.map(student => ({ id:student.id, elimuid:student.elimuid, name:student.User?.name || 'Student', grade:student.grade, classId:student.classId, tutor:summarizeTutorActivity(activity.get(Number(student.id))) })) } });
  } catch (error) {
    return res.status(error.status || 500).json({ success:false, message:error.message });
  }
};

exports.getTeacherReport = async (req, res) => {
  try {
    const schoolCode = req.user.schoolCode;
    const classId = Number(req.params.classId);
    if (!Number.isInteger(classId)) return res.status(400).json({ success:false, message:'classId is required' });
    const classItem = await Class.findOne({ where:{ id:classId, schoolCode, isActive:true } });
    if (!classItem) return res.status(404).json({ success:false, message:'Class not found' });
    if (req.user.role === 'teacher') {
      const teacher = await Teacher.findOne({ where:{ userId:req.user.id } });
      if (!teacher) return res.status(404).json({ success:false, message:'Teacher profile not found' });
      const assignment = await TeacherSubjectAssignment.findOne({ where:{ teacherId:teacher.id, classId } });
      const ownsClass = Number(classItem.teacherId) === Number(teacher.id) || Number(teacher.classId) === classId || String(teacher.classTeacher || '').toLowerCase() === String(classItem.name || '').toLowerCase();
      if (!ownsClass && !assignment) return res.status(403).json({ success:false, message:'You are not assigned to this class' });
    }
    const students = await Student.unscoped().findAll({
      where:{ classId, status:{ [Op.ne]:'inactive' } },
      attributes:['id','elimuid','grade','classId'],
      include:[{ model:User, attributes:['id','name','schoolCode'], required:true, where:{ schoolCode } }],
      order:[[User,'name','ASC']]
    });
    const activity = await buildTutorReportRows(students.map(student => student.id), schoolCode);
    return res.json({ success:true, data:{ class:{ id:classItem.id, name:classItem.name, grade:classItem.grade, stream:classItem.stream }, students:students.map(student => ({ id:student.id, elimuid:student.elimuid, name:student.User?.name || 'Student', tutor:summarizeTutorActivity(activity.get(Number(student.id))) })) } });
  } catch (error) {
    return res.status(error.status || 500).json({ success:false, message:error.message });
  }
};
