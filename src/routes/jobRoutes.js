const express = require('express');
const fs = require('fs');
const path = require('path');
const { protect, authorize } = require('../middleware/auth');
const { enqueueJob, getJob, listJobs } = require('../services/jobQueue');
const { validateCsvUpload } = require('../services/mediaAssetService');

const router = express.Router();
router.use(protect);

function scopedQueueUser(req) {
  if (req.user.role !== 'super_admin') return req.user;
  const schoolCode = String(req.body?.schoolCode || '').trim();
  if (!schoolCode) {
    const error = new Error('schoolCode is required when a super admin queues school work.');
    error.status = 400;
    throw error;
  }
  return { id: req.user.id, role: req.user.role, schoolCode };
}

async function persistQueuedCsv(req, prefix) {
  let file = req.files?.file || null;
  if (Array.isArray(file)) file = file[0];
  if (!file) {
    const error = new Error('A CSV file is required.');
    error.status = 400;
    throw error;
  }
  const originalName = path.basename(String(file.name || `${prefix}.csv`)).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!originalName.toLowerCase().endsWith('.csv')) {
    const error = new Error('Only CSV files can be queued for this operation.');
    error.status = 400;
    throw error;
  }
  await validateCsvUpload(file);
  const root = process.env.UPLOAD_TMP_DIR || path.join(process.cwd(), 'uploads', 'tmp');
  await fs.promises.mkdir(root, { recursive: true });
  const filePath = path.join(root, `${Date.now()}-${prefix}-${originalName}`);
  await file.mv(filePath);
  return { filePath, originalName, fileSize: Number(file.size || 0) };
}

router.post('/csv-import', authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const upload = await persistQueuedCsv(req, 'students');
    const job = await enqueueJob('csv-import', { ...upload, mode: 'students' }, scopedQueueUser(req));
    res.status(202).json({ success: true, message: 'Student import queued for durable worker processing.', data: job });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/marks-import', authorize('admin', 'teacher', 'super_admin'), async (req, res) => {
  try {
    const upload = await persistQueuedCsv(req, 'marks');
    const job = await enqueueJob('marks-import', { ...upload, term: req.body?.term, year: req.body?.year }, scopedQueueUser(req));
    res.status(202).json({ success: true, message: 'Marks import queued for durable worker processing.', data: job });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/report-cards', authorize('admin', 'teacher', 'super_admin'), async (req, res) => {
  try {
    const classId = Number(req.body?.classId || 0);
    const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds.map(Number).filter(Boolean) : [];
    if (!classId && !studentIds.length) return res.status(400).json({ success: false, message: 'classId or studentIds is required.' });
    if (!req.body?.term || !Number(req.body?.year)) return res.status(400).json({ success: false, message: 'term and year are required.' });
    const job = await enqueueJob('report-card-generation', { classId: classId || null, studentIds, term: req.body.term, year: Number(req.body.year), assessmentType: req.body.assessmentType || null, assessmentName: req.body.assessmentName || null }, scopedQueueUser(req));
    res.status(202).json({ success: true, message: 'Report-card generation queued.', data: job });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/', authorize('admin', 'teacher', 'super_admin'), async (req, res) => {
  try {
    const schoolCode = req.user.role === 'super_admin' ? req.query.schoolCode : req.user.schoolCode;
    if (req.user.role === 'super_admin' && !schoolCode) return res.status(400).json({ success: false, message: 'schoolCode is required for platform job listing.' });
    res.json({ success: true, data: await listJobs({ schoolCode, limit: Number(req.query.limit || 50) }) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:jobId', authorize('admin', 'teacher', 'super_admin'), async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (req.user.role !== 'super_admin' && job.schoolCode !== req.user.schoolCode) return res.status(403).json({ success: false, message: 'Forbidden' });
    res.json({ success: true, data: job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
