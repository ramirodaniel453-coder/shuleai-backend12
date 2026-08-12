require('dotenv').config();
const fs = require('fs');
const CSVProcessor = require('../services/csv/csvProcessor');
const reportController = require('../controllers/reportController');
const reportSnapshotService = require('../services/reportSnapshotService');
const { processNextJob } = require('../services/jobQueue');
const { User, Student, Class, UploadLog, AuditLog } = require('../models');
const { createVerifiedPlatformBackup } = require('../services/platformBackupService');

async function creatorFor(job) {
  const user = await User.findOne({ where: { id: job.createdBy, isActive: true } });
  if (!user) throw new Error('The user who queued this job is missing, inactive, or outside the job school.');
  if (user.role !== 'super_admin' && String(user.schoolCode) !== String(job.schoolCode)) {
    throw new Error('The user who queued this job is outside the job school.');
  }
  if (user.role === 'super_admin') user.schoolCode = job.schoolCode;
  return user;
}

async function consumeCsv(job, progress, mode) {
  const user = await creatorFor(job);
  const filePath = String(job.payload?.filePath || '');
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Queued CSV file is unavailable. Upload the file again.');
  await progress(15, 'CSV validated and processor started');
  const processor = new CSVProcessor(job.schoolCode, user.id, user.role);
  const result = mode === 'students'
    ? await processor.processStudentUpload(filePath)
    : await processor.processMarksUpload(filePath);
  await progress(85, 'Database import completed; writing audit record');
  await UploadLog.create({
    type: mode,
    filename: job.payload.originalName || `${mode}.csv`,
    fileSize: Number(job.payload.fileSize || 0),
    uploadedBy: user.id,
    schoolCode: job.schoolCode,
    stats: result.stats,
    errors: result.errors || [],
    warnings: result.warnings || []
  });
  await fs.promises.unlink(filePath).catch(() => null);
  return result;
}

const handlers = {
  async 'database-backup'(job, progress) {
    const user = await User.findOne({ where: { id: job.createdBy, role: 'super_admin', isActive: true } });
    if (!user) throw new Error('Only an active super admin can run a platform backup.');
    return createVerifiedPlatformBackup({ backupId: job.payload.backupId, progress });
  },
  async 'csv-import'(job, progress) {
    return consumeCsv(job, progress, 'students');
  },
  async 'marks-import'(job, progress) {
    return consumeCsv(job, progress, 'marks');
  },
  async 'report-card-generation'(job, progress) {
    const user = await creatorFor(job);
    const classId = Number(job.payload?.classId || 0);
    if (user.role === 'teacher') {
      const allowed = classId && await reportController.teacherOwnsClassForWorker({ user }, classId);
      if (!allowed) throw new Error('Teacher is not the assigned class teacher for this report-card job.');
    }
    if (classId) {
      const cls = await Class.findOne({ where: { id: classId, schoolCode: job.schoolCode } });
      if (!cls) throw new Error('Class not found in this school.');
    }
    let studentIds = Array.isArray(job.payload?.studentIds) ? job.payload.studentIds.map(Number).filter(Boolean) : [];
    if (!studentIds.length && classId) {
      const students = await Student.findAll({ where: { schoolCode: job.schoolCode, classId, status: 'active' }, attributes: ['id'] });
      studentIds = students.map(student => student.id);
    }
    if (!studentIds.length) throw new Error('No eligible students were found for report-card generation.');
    const results = [];
    for (let index = 0; index < studentIds.length; index += 1) {
      const studentId = studentIds[index];
      const built = await reportController.buildSnapshotForWorker({
        studentId,
        schoolCode: job.schoolCode,
        term: job.payload.term,
        year: Number(job.payload.year),
        assessmentType: job.payload.assessmentType || null,
        assessmentName: job.payload.assessmentName || null
      });
      const published = await reportSnapshotService.createPublishedVersion({
        schoolCode: job.schoolCode,
        studentId,
        classId: built.cls?.id || null,
        term: job.payload.term,
        year: Number(job.payload.year),
        curriculum: built.snapshot.curriculum,
        reportType: 'academic',
        assessmentType: job.payload.assessmentType || null,
        assessmentName: job.payload.assessmentName || null,
        snapshot: built.snapshot,
        sourceRecordIds: built.records.map(record => record.id),
        generatedBy: user.id,
        publishedBy: user.id,
        publishedAt: new Date(),
        metadata: { engine: 'v2043_background_report_worker', backgroundJobId: job.id }
      });
      results.push({ studentId, reportId: published.row.id, version: published.row.version, unchanged: published.unchanged });
      await progress(10 + Math.round(((index + 1) / studentIds.length) * 80), `Generated ${index + 1} of ${studentIds.length} report cards`);
    }
    await AuditLog.create({ schoolCode: job.schoolCode, actorUserId: user.id, actorRole: user.role, module: 'reports', action: 'report_batch_published', entityType: 'BackgroundJob', entityId: String(job.id), after: { count: results.length, term: job.payload.term, year: job.payload.year } });
    return { processed: results.length, reports: results };
  }
};

async function loop() {
  await processNextJob(handlers);
  setTimeout(loop, Number(process.env.JOB_WORKER_INTERVAL_MS || 5000)).unref?.();
}

console.log('Shule AI durable job worker started');
loop().catch(error => { console.error(error); process.exit(1); });

module.exports = { handlers };
