const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { saveUploadAsset } = require('../services/mediaAssetService');
const { HomeTask, HomeTaskAssignment, Student, Teacher, Class, User, TeacherSubjectAssignment, ClassroomThread } = require('../models');

function cleanString(value, fallback = '') {
  const s = String(value ?? '').trim();
  return s || fallback;
}


function normalizeClassText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classTextsMatch(a, b) {
  const left = normalizeClassText(a);
  const right = normalizeClassText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeAttachments(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => {
    if (typeof item === 'string') return { url: item, name: item.split('/').pop() || 'Attachment' };
    return {
      url: item.url || item.secureUrl || item.path || item.viewUrl || item.downloadUrl || '',
      secureUrl: item.secureUrl || item.url || item.viewUrl || item.downloadUrl || '',
      downloadUrl: item.downloadUrl || item.secureUrl || item.url || '',
      viewUrl: item.viewUrl || item.secureUrl || item.url || '',
      name: item.name || item.originalName || item.filename || 'Attachment',
      filename: item.filename || path.basename(String(item.url || item.secureUrl || item.path || item.viewUrl || item.downloadUrl || '')),
      mimeType: item.mimeType || item.type || 'application/octet-stream',
      size: item.size || 0,
      // Durable fallback for Render/local-disk restarts. Kept only when upload endpoint supplies it.
      dataBase64: item.dataBase64 || item.base64 || '',
      storedInDb: Boolean(item.storedInDb || item.dataBase64 || item.base64)
    };
  }).filter(item => item.url || item.secureUrl || item.dataBase64);
  if (typeof value === 'string') {
    try { return normalizeAttachments(JSON.parse(value)); } catch (_) { return value ? [{ url: value, name: value.split('/').pop() || 'Attachment' }] : []; }
  }
  return [];
}

function homeTaskAttachmentUrl(req, relativeUrl) {
  if (!relativeUrl) return '';
  if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const safeProto = req.get('host')?.includes('onrender.com') ? 'https' : proto;
  return `${safeProto}://${req.get('host')}${relativeUrl}`;
}

function homeworkFileSigningKey() {
  return String(process.env.HOMEWORK_FILE_SIGNING_SECRET || process.env.JWT_SECRET || '');
}

function homeworkFileSignature(filename, schoolCode, expiresAt) {
  return crypto.createHmac('sha256', homeworkFileSigningKey())
    .update(`${filename}\n${schoolCode}\n${expiresAt}`)
    .digest('base64url');
}

function homeworkFileApiUrl(req, rawUrl, schoolCode) {
  if (!rawUrl) return '';
  let filename = '';
  const raw = String(rawUrl || '').trim();
  try {
    if (/^https?:\/\//i.test(raw)) filename = path.basename(new URL(raw).pathname || '');
    else filename = path.basename(raw);
  } catch (_) {
    filename = path.basename(raw);
  }
  if (!filename || filename === '.' || filename === '..') return '';
  const tenant = String(schoolCode || req.user?.schoolCode || '').trim();
  if (!tenant || !homeworkFileSigningKey()) return '';
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
  const signature = homeworkFileSignature(filename, tenant, expiresAt);
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const safeProto = req.get('host')?.includes('onrender.com') ? 'https' : proto;
  return `${safeProto}://${req.get('host')}/homework-files/${encodeURIComponent(filename)}?school=${encodeURIComponent(tenant)}&expires=${expiresAt}&signature=${encodeURIComponent(signature)}`;
}

function safeHomeworkDownloadUrl(req, relativeUrl, schoolCode) {
  if (!relativeUrl) return '';
  // Use the dedicated homework file route instead of raw /uploads links.
  // This avoids CSP/inline-script browser previews and keeps view/download stable across dashboards.
  return homeworkFileApiUrl(req, relativeUrl, schoolCode);
}

function normalizeAttachmentUrlsForResponse(req, attachments = [], schoolCode = req.user?.schoolCode) {
  return normalizeAttachments(attachments).map(file => {
    const raw = file.secureUrl || file.url || file.viewUrl || file.downloadUrl || file.filename || '';
    const secureUrl = safeHomeworkDownloadUrl(req, raw, schoolCode);
    return {
      url: secureUrl,
      secureUrl,
      downloadUrl: secureUrl,
      viewUrl: secureUrl,
      name: file.name || file.filename || 'Attachment',
      filename: file.filename || path.basename(String(raw || '')),
      mimeType: file.mimeType || 'application/octet-stream',
      size: file.size || 0,
      storedInDb: Boolean(file.storedInDb || file.dataBase64)
    };
  });
}

async function findHomeworkAttachmentInDatabase(filename, schoolCode) {
  const wanted = path.basename(String(filename || ''));
  if (!wanted) return null;
  const tasks = await HomeTask.findAll({
    attributes: ['id', 'attachments'],
    where: { schoolCode, attachments: { [Op.ne]: null } },
    order: [['updatedAt', 'DESC']],
    limit: 3000
  }).catch(() => []);
  for (const task of tasks) {
    const files = normalizeAttachments(task.attachments);
    const found = files.find(file => {
      const names = [file.filename, file.name, file.url, file.secureUrl, file.viewUrl, file.downloadUrl]
        .filter(Boolean)
        .map(v => path.basename(String(v)));
      return names.includes(wanted);
    });
    if (found) return found;
  }

  // Also recover student submission files stored in HomeTaskAssignment.studentFeedback.
  const assignments = await HomeTaskAssignment.findAll({
    attributes: ['id', 'studentFeedback'],
    where: { schoolCode, studentFeedback: { [Op.ne]: null } },
    order: [['updatedAt', 'DESC']],
    limit: 5000
  }).catch(() => []);
  for (const assignment of assignments) {
    const feedback = assignment.studentFeedback || {};
    const files = normalizeAttachments(feedback.submissionFiles || feedback.files || (feedback.fileUrl ? [{ url: feedback.fileUrl, filename: feedback.filename, name: feedback.name, dataBase64: feedback.dataBase64, mimeType: feedback.mimeType }] : []));
    const found = files.find(file => {
      const names = [file.filename, file.name, file.url, file.secureUrl, file.viewUrl, file.downloadUrl]
        .filter(Boolean)
        .map(v => path.basename(String(v)));
      return names.includes(wanted);
    });
    if (found) return found;
  }
  return null;
}

function homeworkUploadRoot() {
  return path.join(__dirname, '../../uploads/homework');
}

exports.serveHomeworkAttachment = async (req, res) => {
  try {
    const filename = path.basename(String(req.params.filename || ''));
    if (!filename) return res.status(400).send('Invalid homework file');
    const schoolCode = String(req.query.school || '').trim();
    const expiresAt = Number(req.query.expires || 0);
    const suppliedSignature = String(req.query.signature || '');
    if (!schoolCode || !Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || expiresAt > Math.floor(Date.now() / 1000) + 3600) {
      return res.status(403).send('Homework file link is invalid or expired');
    }
    const expectedSignature = homeworkFileSignature(filename, schoolCode, expiresAt);
    const suppliedBuffer = Buffer.from(suppliedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return res.status(403).send('Homework file link is invalid or expired');
    }
    const dbFile = await findHomeworkAttachmentInDatabase(filename, schoolCode);
    if (!dbFile) return res.status(404).send('Homework file not found for this school');

    const uploadRoot = homeworkUploadRoot();
    const candidateRoots = [
      uploadRoot,
      path.join(__dirname, '../uploads/homework'),
      path.join(__dirname, '../../src/uploads/homework'),
      path.join(process.cwd(), 'uploads/homework'),
      path.join(process.cwd(), 'backend/uploads/homework')
    ];
    let fullPath = '';
    for (const root of candidateRoots) {
      const candidate = path.join(root, filename);
      const safeRoot = path.resolve(root);
      const safeCandidate = path.resolve(candidate);
      if (safeCandidate.startsWith(safeRoot) && fs.existsSync(safeCandidate)) {
        fullPath = safeCandidate;
        break;
      }
    }

    const originalName = filename.replace(/^homework-\d+-\d+-\d+-/, '') || filename;
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Security-Policy', "default-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; object-src 'self' blob: data:; script-src 'none'; style-src 'self' 'unsafe-inline'");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', `${disposition}; filename="${originalName.replace(/"/g, '')}"`);

    if (fullPath) return res.sendFile(fullPath);

    // Render/local disks can be wiped on deploy/restart. For files uploaded on this build,
    // fall back to the base64 copy stored inside the HomeTask attachments JSON.
    if (dbFile?.dataBase64) {
      const buffer = Buffer.from(String(dbFile.dataBase64), 'base64');
      res.setHeader('Content-Type', dbFile.mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', buffer.length);
      return res.end(buffer);
    }

    return res.status(404).send('Homework file not found. Please re-upload the assignment file. Files uploaded before the durable homework-file fix may need re-uploading after redeploy.');
  } catch (error) {
    console.error('Serve homework attachment error:', error);
    return res.status(500).send('Could not open homework file');
  }
};

function deriveAssignmentTiming(assignment, task) {
  const due = task?.dueDate ? new Date(task.dueDate) : null;
  const submittedAt = assignment?.completedAt ? new Date(assignment.completedAt) : null;
  const now = new Date();
  const status = String(assignment?.status || 'pending').toLowerCase();
  const isSubmitted = ['submitted', 'graded', 'completed'].includes(status) || Boolean(submittedAt);
  const isGraded = status === 'graded';
  const isLate = Boolean(due && !isSubmitted && now > due);
  const submittedLate = Boolean(due && submittedAt && submittedAt > due);
  let displayStatus = 'Pending';
  if (isGraded) displayStatus = submittedLate ? 'Graded late' : 'Graded';
  else if (isSubmitted) displayStatus = submittedLate ? 'Submitted late' : 'Submitted';
  else if (isLate) displayStatus = 'Late';
  return { isSubmitted, isGraded, isLate, submittedLate, displayStatus };
}

async function getTeacherFromUser(userId) {
  return Teacher.findOne({ where: { userId } });
}

function classNamesForStudentLookup(classItem) {
  return [...new Set([
    classItem?.name,
    classItem?.grade,
    `${classItem?.grade || ''} ${classItem?.stream || ''}`.trim(),
    `${classItem?.name || ''} ${classItem?.stream || ''}`.trim()
  ].filter(Boolean))];
}

async function getStudentsForClass(classItem, schoolCode) {
  if (!classItem) return [];
  const names = classNamesForStudentLookup(classItem);
  const normalizedNames = names.map(normalizeClassText).filter(Boolean);
  const seen = new Set();
  const results = [];
  const userIncludeSoft = { model: User, attributes: ['id', 'name', 'email', 'schoolCode'], required: false };
  const belongsToSchool = (student) => {
    const userSchool = student?.User?.schoolCode || student?.User?.dataValues?.schoolCode;
    return !schoolCode || !userSchool || userSchool === schoolCode;
  };
  const addMany = (rows = []) => rows.forEach((student) => {
    if (!student || seen.has(student.id) || !belongsToSchool(student)) return;
    seen.add(student.id);
    results.push(student);
  });

  const activeWhere = { status: { [Op.ne]: 'inactive' } };

  if (classItem.id) {
    addMany(await Student.unscoped().findAll({
      where: { ...activeWhere, classId: classItem.id },
      include: [userIncludeSoft],
      attributes: ['id', 'userId', 'grade', 'classId', 'status'],
      limit: 5000
    }));
  }

  if (names.length) {
    addMany(await Student.unscoped().findAll({
      where: { ...activeWhere, classId:null, grade: { [Op.in]: names } },
      include: [userIncludeSoft],
      attributes: ['id', 'userId', 'grade', 'classId', 'status'],
      limit: 5000
    }));
  }

  // Broad fallback for old records where grade/class text differs by case, stream spacing, or punctuation.
  if (normalizedNames.length) {
    const schoolStudents = await Student.unscoped().findAll({
      where: activeWhere,
      include: [userIncludeSoft],
      attributes: ['id', 'userId', 'grade', 'classId', 'status'],
      limit: 10000
    });
    addMany(schoolStudents.filter(student => {
      if (!belongsToSchool(student)) return false;
      if (classItem.id && Number(student.classId) === Number(classItem.id)) return true;
      if (student.classId !== null && student.classId !== undefined) return false;
      const studentGrade = normalizeClassText(student.grade);
      return normalizedNames.some(name => studentGrade === name || studentGrade.includes(name) || name.includes(studentGrade));
    }));
  }

  return results;
}

async function resolveClass({ classId, className, grade, schoolCode }) {
  let classItem = null;
  if (classId) {
    classItem = await Class.findOne({ where: { id: classId, schoolCode, isActive: true } });
  }
  if (!classItem && (className || grade)) {
    const name = cleanString(className || grade);
    classItem = await Class.findOne({
      where: {
        schoolCode,
        isActive: true,
        [Op.or]: [
          { name },
          { grade: name },
          { name: { [Op.iLike]: `%${name}%` } },
          { grade: { [Op.iLike]: `%${name}%` } }
        ]
      }
    });
  }
  return classItem;
}



function parseBool(value) {
  if (value === true || value === 1) return true;
  const s = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on', 'open'].includes(s);
}

async function ensureHomeworkStudyThread(req, task, options = {}) {
  if (!task || !ClassroomThread) return null;
  const existingId = Number(task.studyThreadId || 0);
  if (existingId) {
    const existing = await ClassroomThread.findOne({ where: { id: existingId, schoolCode: req.user.schoolCode } }).catch(() => null);
    if (existing) return existing;
  }

  const discussionTitle = cleanString(
    options.discussionTitle || task.studyDiscussionTitle || `${task.title} Discussion`,
    `${task.title || 'Homework'} Discussion`
  );
  const teacher = await getTeacherFromUser(req.user.id).catch(() => null);
  const thread = await ClassroomThread.create({
    schoolCode: req.user.schoolCode,
    classId: task.classId || null,
    subject: task.subject || 'Homework',
    topic: discussionTitle,
    content: cleanString(
      options.discussionContent || `Use this study discussion to ask questions, share ideas, and get teacher guidance for: ${task.title}`,
      `Homework discussion for ${task.title || 'assignment'}`
    ),
    teacherId: teacher?.id || task.createdBy || null,
    createdBy: req.user.id,
    isPinned: false,
    isClosed: false,
    metadata: {
      source: 'homework',
      homeworkTaskId: task.id,
      homeworkTitle: task.title,
      className: task.className || task.gradeLevel || null,
      grade: task.gradeLevel || task.className || null,
      approvalRequired: true,
      approvalStatus: 'approved',
      createdByRole: req.user.role,
      allowStudentReplies: options.allowStudentReplies !== false,
      teacherModerationOnly: Boolean(options.teacherModerationOnly),
      rewardParticipation: Boolean(options.rewardParticipation)
    }
  });

  task.studyDiscussionEnabled = true;
  task.studyThreadId = thread.id;
  task.studyDiscussionTitle = discussionTitle;
  task.studyDiscussionSettings = {
    allowStudentReplies: options.allowStudentReplies !== false,
    teacherModerationOnly: Boolean(options.teacherModerationOnly),
    rewardParticipation: Boolean(options.rewardParticipation)
  };
  await task.save();
  return thread;
}


async function saveHomeworkUploadedFile(req, options = {}) {
  const kind = options.kind || 'homework';
  const prefix = options.prefix || 'homework';
  const uploadRoot = homeworkUploadRoot();
  if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

  let file = req.file || null;
  if (!file && req.files) {
    file = req.files.file || req.files.attachment || req.files.upload || req.files.submission || null;
    if (Array.isArray(file)) file = file[0];
  }
  if (Array.isArray(req.files) && req.files.length) file = req.files[0];
  if (!file) return null;

  const originalName = file.originalname || file.name || file.filename || `${kind}-file`;
  const saved = await saveUploadAsset({
    file,
    schoolCode: req.user.schoolCode,
    ownerUserId: req.user.id,
    kind,
    maxBytes: Number(process.env.HOMEWORK_FILE_MAX_BYTES || 25 * 1024 * 1024),
    allowAnyMime: true,
    deactivatePrevious: false,
    metadata: { uploadedBy: req.user.id, role: req.user.role, module: 'homework', prefix }
  });
  return {
    url: saved.url,
    secureUrl: homeTaskAttachmentUrl(req, saved.url),
    viewUrl: homeTaskAttachmentUrl(req, saved.url),
    downloadUrl: homeTaskAttachmentUrl(req, saved.url),
    filename: saved.token || originalName,
    name: originalName,
    mimeType: saved.mimeType || file.mimetype || file.type || 'application/octet-stream',
    size: saved.byteSize || file.size || 0,
    kind,
    storageProvider: saved.storageProvider,
    durable: true
  };
}

exports.uploadHomeworkAttachment = async (req, res) => {
  try {
    const teacher = await getTeacherFromUser(req.user.id);
    if (!teacher) return res.status(403).json({ success: false, message: 'Teacher account not found' });
    const payload = await saveHomeworkUploadedFile(req, { kind: 'homework-material', prefix: 'homework' });
    if (!payload) return res.status(400).json({ success: false, message: 'No homework file uploaded' });
    res.status(201).json({ success: true, data: payload });
  } catch (error) {
    console.error('Upload homework attachment error:', error);
    res.status(500).json({ success: false, message: error.message || 'Homework upload failed' });
  }
};

exports.uploadHomeworkSubmission = async (req, res) => {
  try {
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(403).json({ success: false, message: 'Not a student' });
    const payload = await saveHomeworkUploadedFile(req, { kind: 'student-submission', prefix: 'submission' });
    if (!payload) return res.status(400).json({ success: false, message: 'No submission file uploaded' });
    res.status(201).json({ success: true, data: payload });
  } catch (error) {
    console.error('Upload homework submission error:', error);
    res.status(500).json({ success: false, message: error.message || 'Submission upload failed' });
  }
};

exports.createAssignment = async (req, res) => {
  try {
    const {
      title,
      instructions,
      description,
      content,
      subject,
      dueDate,
      classId,
      className,
      grade,
      studentIds,
      estimatedMinutes,
      points,
      difficulty,
      attachments,
      teacherNote,
      openStudyDiscussion,
      createStudyDiscussion,
      discussionTitle,
      allowStudentReplies,
      teacherModerationOnly,
      rewardParticipation
    } = req.body || {};

    const teacher = await getTeacherFromUser(req.user.id);
    if (!teacher) return res.status(403).json({ success: false, message: 'Teacher account not found' });

    const safeTitle = cleanString(title);
    const safeSubject = cleanString(subject, 'General');
    const safeInstructions = cleanString(instructions || description || content);

    if (!safeTitle) return res.status(400).json({ success: false, message: 'Homework title is required' });
    if (!safeInstructions) return res.status(400).json({ success: false, message: 'Homework instructions are required' });

    const classItem = await resolveClass({ classId, className, grade, schoolCode: req.user.schoolCode });
    const resolvedClassId = classItem?.id || classId || null;
    const resolvedClassName = classItem?.name || className || grade || null;

    const requestedStudentIds = Array.isArray(studentIds)
      ? [...new Set(studentIds.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0))]
      : [];
    const explicitStudentTargeting = requestedStudentIds.length > 0;
    let targetStudentIds = requestedStudentIds;

    if (explicitStudentTargeting) {
      const StudentModel = Student.unscoped ? Student.unscoped() : Student;
      const selectedStudents = await StudentModel.findAll({
        where: { id: { [Op.in]: requestedStudentIds }, status: { [Op.ne]: 'inactive' } },
        include: [{ model: User, attributes: ['id', 'schoolCode'], where: { schoolCode: req.user.schoolCode }, required: true }],
        attributes: ['id', 'classId', 'grade', 'status']
      });
      const allowedStudents = classItem
        ? selectedStudents.filter(student => Number(student.classId) === Number(classItem.id)
          || (!student.classId && (classTextsMatch(student.grade, classItem.name) || classTextsMatch(student.grade, classItem.grade))))
        : selectedStudents;
      targetStudentIds = [...new Set(allowedStudents.map(student => Number(student.id)).filter(Boolean))];
      if (!targetStudentIds.length) {
        return res.status(400).json({ success: false, message: 'No selected students were found in this school/class for the homework assignment' });
      }
    } else if (classItem) {
      const students = await getStudentsForClass(classItem, req.user.schoolCode);
      targetStudentIds = students.map(s => s.id);
    }

    const task = await HomeTask.create({
      title: safeTitle,
      instructions: safeInstructions,
      type: 'teacher',
      subject: safeSubject,
      gradeLevel: classItem?.grade || resolvedClassName || 'all',
      difficulty: difficulty || 'medium',
      estimatedMinutes: Number(estimatedMinutes || 30),
      points: Number(points || 10),
      competencyId: null,
      learningOutcomeId: null,
      createdBy: teacher.id,
      createdByUserId: req.user.id,
      schoolCode: req.user.schoolCode,
      classId: resolvedClassId,
      className: resolvedClassName,
      dueDate: dueDate || null,
      materials: '',
      attachments: normalizeAttachments(attachments),
      teacherNote: cleanString(teacherNote || ''),
      studyDiscussionEnabled: parseBool(openStudyDiscussion) || parseBool(createStudyDiscussion),
      studyThreadId: null,
      studyDiscussionTitle: cleanString(discussionTitle || ''),
      studyDiscussionSettings: {
        allowStudentReplies: allowStudentReplies !== false,
        teacherModerationOnly: Boolean(teacherModerationOnly),
        rewardParticipation: parseBool(rewardParticipation)
      }
    });

    const assignments = targetStudentIds.map(sid => ({
      studentId: sid,
      taskId: task.id,
      classId: resolvedClassId,
      schoolCode: req.user.schoolCode,
      assignedAt: new Date(),
      status: 'pending'
    }));
    if (assignments.length) await HomeTaskAssignment.bulkCreate(assignments, { ignoreDuplicates: true });

    const repairedStudents = explicitStudentTargeting ? [] : await ensureHomeworkAssignmentsForTask(task, req.user.schoolCode);
    const assignedCount = await HomeTaskAssignment.count({ where: { taskId: task.id } });
    let studyThread = null;
    if (parseBool(openStudyDiscussion) || parseBool(createStudyDiscussion)) {
      studyThread = await ensureHomeworkStudyThread(req, task, { discussionTitle, allowStudentReplies: allowStudentReplies !== false, teacherModerationOnly, rewardParticipation: parseBool(rewardParticipation) });
    }

    res.status(201).json({
      success: true,
      message: assignedCount ? 'Homework assigned successfully' : 'Homework saved, but no matching students were found for the selected class',
      data: {
        task: { ...task.toJSON(), attachments: normalizeAttachmentUrlsForResponse(req, task.attachments, task.schoolCode), studyThread },
        assignedCount,
        repairedCount: repairedStudents.length,
        taskId: task.id,
        classId: resolvedClassId || null,
        className: resolvedClassName || null
      }
    });
  } catch (error) {
    console.error('Create homework error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};



exports.createHomeworkDiscussion = async (req, res) => {
  try {
    const teacher = await getTeacherFromUser(req.user.id);
    if (!teacher) return res.status(403).json({ success: false, message: 'Teacher account not found' });
    const task = await HomeTask.findOne({
      where: {
        id: Number(req.params.taskId),
        [Op.or]: [{ createdBy: teacher.id }, { createdByUserId: req.user.id }],
        schoolCode: req.user.schoolCode
      }
    });
    if (!task) return res.status(404).json({ success: false, message: 'Homework not found' });
    const thread = await ensureHomeworkStudyThread(req, task, req.body || {});
    res.status(201).json({ success: true, data: { task: { ...task.toJSON(), attachments: normalizeAttachmentUrlsForResponse(req, task.attachments, task.schoolCode) }, thread } });
  } catch (error) {
    console.error('Create homework discussion error:', error);
    res.status(500).json({ success: false, message: error.message || 'Could not create homework discussion' });
  }
};

exports.getTeacherAssignments = async (req, res) => {
  try {
    const teacher = await getTeacherFromUser(req.user.id);
    if (!teacher) return res.status(403).json({ success: false, message: 'Not a teacher' });

    const tasks = await HomeTask.findAll({
      where: {
        [Op.or]: [
          { createdBy: teacher.id },
          { createdByUserId: req.user.id }
        ],
        [Op.and]: [
          { [Op.or]: [{ schoolCode: req.user.schoolCode }, { schoolCode: null }] }
        ]
      },
      include: [{ model: HomeTaskAssignment, required: false }],
      order: [['createdAt', 'DESC']]
    });

    for (const task of tasks) {
      const count = Array.isArray(task.HomeTaskAssignments) ? task.HomeTaskAssignments.length : 0;
      if (!count) await ensureHomeworkAssignmentsForTask(task, req.user.schoolCode);
    }

    const refreshed = await HomeTask.findAll({
      where: {
        [Op.or]: [
          { createdBy: teacher.id },
          { createdByUserId: req.user.id }
        ],
        [Op.and]: [
          { [Op.or]: [{ schoolCode: req.user.schoolCode }, { schoolCode: null }] }
        ]
      },
      include: [{ model: HomeTaskAssignment, required: false }],
      order: [['createdAt', 'DESC']]
    });

    res.json({ success: true, data: refreshed.map(t => {
      const json = t.toJSON();
      const assignments = json.HomeTaskAssignments || [];
      return {
        ...json,
        attachments: normalizeAttachmentUrlsForResponse(req, json.attachments, json.schoolCode),
        assignedCount: assignments.length,
        submittedCount: assignments.filter(a => ['submitted','graded'].includes(String(a.status || '').toLowerCase())).length,
        pendingCount: assignments.filter(a => !['submitted','graded'].includes(String(a.status || '').toLowerCase())).length
      };
    }) });
  } catch (error) {
    console.error('Get teacher assignments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};



async function teacherOwnsTask(req, taskId) {
  const teacher = await getTeacherFromUser(req.user.id);
  if (!teacher) return { teacher: null, task: null };
  const task = await HomeTask.findOne({
    where: {
      id: Number(taskId),
      [Op.or]: [{ createdBy: teacher.id }, { createdByUserId: req.user.id }],
      [Op.and]: [{ [Op.or]: [{ schoolCode: req.user.schoolCode }, { schoolCode: null }] }]
    }
  });
  return { teacher, task };
}

async function ensureHomeworkAssignmentsForTask(task, schoolCode) {
  if (!task) return [];
  let classItem = null;
  if (task.classId) {
    classItem = await Class.findOne({ where: { id: task.classId, schoolCode, isActive: true } }).catch(() => null);
  }
  if (!classItem && (task.className || task.gradeLevel)) {
    classItem = await resolveClass({ className: task.className, grade: task.gradeLevel, schoolCode }).catch(() => null);
  }

  let students = [];
  if (classItem) students = await getStudentsForClass(classItem, schoolCode);

  // Final fallback: use task text directly when the Class row cannot be resolved.
  if (!students.length) {
    const names = [...new Set([task.className, task.gradeLevel].filter(Boolean))];
    const normalizedNames = names.map(normalizeClassText).filter(Boolean);
    if (normalizedNames.length) {
      const candidates = await Student.unscoped().findAll({
        where: { status: { [Op.ne]: 'inactive' } },
        include: [{ model: User, attributes: ['id','name','email','schoolCode'], required: false }],
        attributes: ['id','userId','grade','classId','status'],
        limit: 10000
      });
      students = candidates.filter(student => {
        const userSchool = student?.User?.schoolCode || student?.User?.dataValues?.schoolCode;
        if (schoolCode && userSchool && userSchool !== schoolCode) return false;
        const grade = normalizeClassText(student.grade);
        return normalizedNames.some(n => grade === n || grade.includes(n) || n.includes(grade));
      });
    }
  }

  for (const student of students) {
    await HomeTaskAssignment.findOrCreate({
      where: { taskId: task.id, studentId: student.id },
      defaults: {
        studentId: student.id,
        taskId: task.id,
        classId: task.classId || student.classId || null,
        schoolCode: schoolCode || task.schoolCode || null,
        assignedAt: new Date(),
        status: 'pending'
      }
    }).catch(() => null);
  }
  return students;
}

exports.getTeacherAssignmentDetails = async (req, res) => {
  try {
    const { task } = await teacherOwnsTask(req, req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Homework not found' });
    await ensureHomeworkAssignmentsForTask(task, req.user.schoolCode);
    const assignments = await HomeTaskAssignment.findAll({
      where: { taskId: task.id },
      include: [{ model: Student, required: false, include: [{ model: User, attributes: ['id','name','email','profileImage','schoolCode'], required: false }] }],
      order: [['updatedAt', 'DESC']]
    });
    const maxPoints = Number(task.points || 0);
    const enrichedAssignments = assignments.map(row => {
      const json = row.toJSON();
      const timing = deriveAssignmentTiming(json, task);
      return {
        ...json,
        ...timing,
        displayStatus: timing.displayStatus,
        maxPoints,
        scoreText: json.pointsEarned !== null && json.pointsEarned !== undefined ? `${json.pointsEarned}/${maxPoints || ''}`.replace(/\/$/, '') : 'Not graded',
        submissionFiles: normalizeAttachmentUrlsForResponse(req, (json.studentFeedback || {}).submissionFiles || ((json.studentFeedback || {}).fileUrl ? [{ url: (json.studentFeedback || {}).fileUrl }] : []), json.schoolCode || task.schoolCode)
      };
    });
    res.json({ success: true, data: { task: { ...task.toJSON(), attachments: normalizeAttachmentUrlsForResponse(req, task.attachments, task.schoolCode) }, assignments: enrichedAssignments } });
  } catch (error) {
    console.error('Get homework details error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTeacherAssignment = async (req, res) => {
  try {
    const { task } = await teacherOwnsTask(req, req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Homework not found' });
    const allowed = ['title','instructions','subject','dueDate','difficulty','estimatedMinutes','points','teacherNote','attachments'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.title !== undefined) updates.title = cleanString(updates.title, task.title);
    if (updates.instructions !== undefined) updates.instructions = cleanString(updates.instructions, task.instructions);
    if (updates.subject !== undefined) updates.subject = cleanString(updates.subject, task.subject || 'General');
    if (updates.attachments !== undefined) updates.attachments = normalizeAttachments(updates.attachments);
    await task.update(updates);
    res.json({ success: true, message: 'Homework updated successfully', data: task });
  } catch (error) {
    console.error('Update homework error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reviewSubmission = async (req, res) => {
  try {
    const assignment = await HomeTaskAssignment.findByPk(req.params.assignmentId, { include: [{ model: HomeTask }] });
    if (!assignment?.HomeTask) return res.status(404).json({ success: false, message: 'Submission not found' });
    const { task } = await teacherOwnsTask(req, assignment.HomeTask.id);
    if (!task) return res.status(403).json({ success: false, message: 'Not allowed to review this homework' });
    const { status = 'graded', pointsEarned = null, teacherComment = '' } = req.body || {};
    const allowedStatuses = ['graded', 'returned', 'submitted', 'pending'];
    const nextStatus = allowedStatuses.includes(String(status).toLowerCase()) ? String(status).toLowerCase() : 'graded';
    const numericPoints = pointsEarned === '' || pointsEarned === null || pointsEarned === undefined ? null : Math.max(0, Number(pointsEarned));
    const parentFeedback = { ...(assignment.parentFeedback || {}), teacherComment, reviewedAt: new Date().toISOString(), reviewedBy: req.user.id, returnedForCorrection: nextStatus === 'returned' };
    await assignment.update({ status: nextStatus, pointsEarned: Number.isFinite(numericPoints) ? numericPoints : null, parentFeedback });
    res.json({ success: true, message: nextStatus === 'returned' ? 'Submission returned for correction' : 'Submission reviewed', data: assignment });
  } catch (error) {
    console.error('Review homework submission error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

async function ensureHomeworkAssignmentsForStudent(student, schoolCode) {
  const studentClass = student.classId ? await Class.findOne({ where: { id: student.classId, schoolCode, isActive: true } }).catch(() => null) : null;
  const classNames = [...new Set([
    student.grade,
    studentClass?.name,
    studentClass?.grade,
    `${studentClass?.grade || ''} ${studentClass?.stream || ''}`.trim(),
    `${studentClass?.name || ''} ${studentClass?.stream || ''}`.trim()
  ].filter(Boolean))];

  const orRules = [];
  if (student.classId) {
    orRules.push({ classId: student.classId });
    if (classNames.length) {
      orRules.push({ [Op.and]: [{ classId:null }, { className: { [Op.in]: classNames } }] });
      orRules.push({ [Op.and]: [{ classId:null }, { gradeLevel: { [Op.in]: classNames } }] });
    }
  } else if (classNames.length) {
    orRules.push({ classId:null, className: { [Op.in]: classNames } });
    orRules.push({ classId:null, gradeLevel: { [Op.in]: classNames } });
  }
  if (!orRules.length) return;

  let tasks = await HomeTask.findAll({
    where: {
      isActive: { [Op.ne]: false },
      [Op.and]: [
        { [Op.or]: [{ schoolCode }, { schoolCode: null }] },
        { [Op.or]: orRules }
      ]
    },
    attributes: ['id', 'classId', 'className', 'gradeLevel', 'schoolCode'],
    limit: 500
  });

  if (!tasks.length && classNames.length) {
    const candidates = await HomeTask.findAll({
      where: { isActive: { [Op.ne]: false }, [Op.or]: [{ schoolCode }, { schoolCode: null }] },
      attributes: ['id', 'classId', 'className', 'gradeLevel', 'schoolCode'],
      limit: 1000
    });
    tasks = candidates.filter(task => {
      if (student.classId && task.classId) return Number(task.classId) === Number(student.classId);
      if (task.classId) return false;
      return classNames.some(name => classTextsMatch(task.className, name) || classTextsMatch(task.gradeLevel, name));
    });
  }

  for (const task of tasks) {
    await HomeTaskAssignment.findOrCreate({
      where: { taskId: task.id, studentId: student.id },
      defaults: {
        studentId: student.id,
        taskId: task.id,
        classId: task.classId || student.classId || null,
        schoolCode: schoolCode || task.schoolCode || null,
        assignedAt: new Date(),
        status: 'pending'
      }
    }).catch(() => null);
  }
}

exports.getStudentAssignments = async (req, res) => {
  try {
    const student = await Student.findOne({
      where: { userId: req.user.id },
      attributes: ['id', 'userId', 'grade', 'classId', 'status']
    });
    if (!student) return res.status(403).json({ success: false, message: 'Not a student' });

    await ensureHomeworkAssignmentsForStudent(student, req.user.schoolCode);

    const assignments = await HomeTaskAssignment.findAll({
      where: {
        studentId: student.id,
        [Op.or]: [{ schoolCode: req.user.schoolCode }, { schoolCode: null }]
      },
      include: [{
        model: HomeTask,
        required: true,
        where: { [Op.or]: [{ schoolCode: req.user.schoolCode }, { schoolCode: null }] },
        include: [{ model: Teacher, required: false, include: [{ model: User, attributes: ['id', 'name'], required: false }] }]
      }],
      order: [['assignedAt', 'DESC']]
    });

    const data = assignments.map(a => {
      const row = a.toJSON();
      const task = row.HomeTask || {};
      const timing = deriveAssignmentTiming(row, task);
      const maxPoints = Number(task.points || 0);
      return {
        id: row.id,
        assignmentId: row.id,
        studentId: row.studentId,
        taskId: row.taskId,
        status: row.status || 'pending',
        displayStatus: timing.displayStatus,
        isLate: timing.isLate,
        submittedLate: timing.submittedLate,
        assignedAt: row.assignedAt,
        submittedAt: row.completedAt || null,
        studentFeedback: row.studentFeedback || {},
        parentFeedback: row.parentFeedback || {},
        submissionFiles: normalizeAttachmentUrlsForResponse(req, (row.studentFeedback || {}).submissionFiles || ((row.studentFeedback || {}).fileUrl ? [{ url: (row.studentFeedback || {}).fileUrl }] : []), row.schoolCode || task.schoolCode),
        pointsEarned: row.pointsEarned ?? null,
        maxPoints,
        scoreText: row.pointsEarned !== null && row.pointsEarned !== undefined ? `${row.pointsEarned}/${maxPoints || ''}`.replace(/\/$/, '') : 'Not graded',
        schoolCode: row.schoolCode || task.schoolCode || null,
        HomeTask: {
          id: task.id,
          title: task.title || 'Untitled Homework',
          instructions: task.instructions || '',
          description: task.instructions || '',
          subject: task.subject || 'General',
          dueDate: task.dueDate || null,
          classId: task.classId || null,
          className: task.className || null,
          estimatedMinutes: task.estimatedMinutes || null,
          points: task.points || 0,
          difficulty: task.difficulty || null,
          attachments: normalizeAttachmentUrlsForResponse(req, task.attachments, task.schoolCode || row.schoolCode),
          teacherNote: task.teacherNote || '',
          teacherName: task.Teacher?.User?.name || 'Not assigned',
          studyDiscussionEnabled: Boolean(task.studyDiscussionEnabled),
          studyThreadId: task.studyThreadId || null,
          studyDiscussionTitle: task.studyDiscussionTitle || '',
          studyDiscussionSettings: task.studyDiscussionSettings || {},
          createdAt: task.createdAt
        }
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Get student assignments error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.submitAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { fileUrl, comment, submissionFiles = [] } = req.body || {};
    const student = await Student.findOne({ where: { userId: req.user.id } });
    if (!student) return res.status(403).json({ success: false, message: 'Not a student' });
    const assignment = await HomeTaskAssignment.findOne({ where: { id: assignmentId, studentId: student.id } });
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });

    const task = await HomeTask.findByPk(assignment.taskId);
    const currentStatus = String(assignment.status || 'pending').toLowerCase();
    if (currentStatus === 'graded') return res.status(400).json({ success: false, message: 'This homework has already been graded. Ask your teacher before resubmitting.' });

    const files = normalizeAttachments(submissionFiles);
    if (!files.length && !cleanString(comment) && !fileUrl) {
      return res.status(400).json({ success: false, message: 'Add a file or a comment before submitting.' });
    }

    const submittedAt = new Date();
    const due = task?.dueDate ? new Date(task.dueDate) : null;
    const submittedLate = Boolean(due && submittedAt > due);
    const feedback = {
      ...(assignment.studentFeedback || {}),
      fileUrl: fileUrl || files[0]?.url || files[0]?.downloadUrl || '',
      comment: cleanString(comment),
      submittedLate,
      submittedAt: submittedAt.toISOString(),
      submissionFiles: files
    };
    await assignment.update({
      status: 'submitted',
      completedAt: submittedAt,
      studentFeedback: feedback
    });
    res.json({ success: true, data: { submittedLate, displayStatus: submittedLate ? 'Submitted late' : 'Submitted', submissionFiles: normalizeAttachmentUrlsForResponse(req, files, assignment.schoolCode || task?.schoolCode) } });
  } catch (error) {
    console.error('Submit assignment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
