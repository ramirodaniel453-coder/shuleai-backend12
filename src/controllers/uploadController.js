const { UploadLog } = require('../models');
const CSVProcessor = require('../services/csv/csvProcessor');
const path = require('path');
const fs = require('fs');
const { validateCsvUpload } = require('../services/mediaAssetService');

function safeUploadPath(originalName) {
  const base = path.basename(String(originalName || 'upload.csv')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpRoot = process.env.UPLOAD_TMP_DIR || path.join(process.cwd(), 'uploads', 'tmp');
  if (!fs.existsSync(tmpRoot)) fs.mkdirSync(tmpRoot, { recursive: true });
  return path.join(tmpRoot, `${Date.now()}-${base}`);
}
function safeUnlink(filePath) { try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {} }

// @desc    Upload students CSV (creates students with random ELIMUIDs)
// @route   POST /api/upload/students
// @access  Private/Teacher/Admin
exports.uploadStudents = async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const file = req.files.file;
    await validateCsvUpload(file);
    const filePath = safeUploadPath(file.name);
    await file.mv(filePath);

    const processor = new CSVProcessor(req.user.schoolCode, req.user.id, req.user.role);
    const result = await processor.processStudentUpload(filePath);

    safeUnlink(filePath);

    // Log upload
    await UploadLog.create({
      type: 'students',
      filename: file.name,
      fileSize: file.size,
      uploadedBy: req.user.id,
      schoolCode: req.user.schoolCode,
      stats: result.stats,
      errors: result.errors,
      warnings: result.warnings
    });

    res.json({
      success: true,
      message: `Processed ${result.stats.processed} students. Created: ${result.stats.created}`,
      data: result
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// @desc    Upload marks CSV
// @route   POST /api/upload/marks
// @access  Private/Teacher
exports.uploadMarks = async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const file = req.files.file;
    await validateCsvUpload(file);
    const filePath = safeUploadPath(file.name);
    await file.mv(filePath);

    const processor = new CSVProcessor(req.user.schoolCode, req.user.id, req.user.role);
    const result = await processor.processMarksUpload(filePath);

    safeUnlink(filePath);

    await UploadLog.create({
      type: 'marks',
      filename: file.name,
      fileSize: file.size,
      uploadedBy: req.user.id,
      schoolCode: req.user.schoolCode,
      stats: result.stats,
      errors: result.errors,
      warnings: result.warnings
    });

    res.json({
      success: true,
      message: `Processed ${result.stats.processed} marks records.`,
      data: result
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// @desc    Upload attendance CSV
// @route   POST /api/upload/attendance
// @access  Private/Teacher
exports.uploadAttendance = async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const file = req.files.file;
    await validateCsvUpload(file);
    const filePath = safeUploadPath(file.name);
    await file.mv(filePath);

    const processor = new CSVProcessor(req.user.schoolCode, req.user.id, req.user.role);
    const result = await processor.processAttendanceUpload(filePath);

    safeUnlink(filePath);

    await UploadLog.create({
      type: 'attendance',
      filename: file.name,
      fileSize: file.size,
      uploadedBy: req.user.id,
      schoolCode: req.user.schoolCode,
      stats: result.stats,
      errors: result.errors,
      warnings: result.warnings
    });

    res.json({
      success: true,
      message: `Processed ${result.stats.processed} attendance records.`,
      data: result
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

// @desc    Download sample CSV template
// @route   GET /api/upload/template/:type
// @access  Private
exports.downloadTemplate = (req, res) => {
  const { type } = req.params;
  const templates = {
    students: 'name,email,grade,parentEmail,parentPhone,dob,gender\nJohn Doe,,Grade 5,parent@email.com,0712345678,2015-01-01,M',
    marks: 'name,elimuid,subject,score,date,assessmentType\nJohn Doe,ELIMU-2024-1234,Mathematics,78,2024-02-15,test',
    attendance: 'name,elimuid,date,status,reason\nJohn Doe,ELIMU-2024-1234,2024-02-15,present,'
  };

  if (!templates[type]) {
    return res.status(404).json({ success: false, message: 'Template not found' });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${type}_template.csv`);
  res.send(templates[type]);
};

// @desc    Get upload history
// @route   GET /api/upload/history
// @access  Private
exports.getUploadHistory = async (req, res) => {
  try {
    const logs = await UploadLog.findAll({
      where: { schoolCode: req.user.schoolCode },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Validate CSV before processing
// @route   POST /api/upload/validate
// @access  Private
exports.validateCSV = async (req, res) => {
  try {
    if (!req.files || !req.files.file) return res.status(400).json({ success: false, message: 'No file' });
    const validation = await validateCsvUpload(req.files.file);
    return res.json({
      success: true,
      message: 'CSV content and header structure verified.',
      data: {
        mimeType: validation.detectedMime,
        byteSize: validation.byteSize,
        headers: validation.headers,
        rowEstimate: validation.rowEstimate
      }
    });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }
};

exports.downloadMarksTemplate = (req, res) => {
  const template = `name,elimuid,subject,score,assessmentType,date,assessmentName,term,year
John Doe,ELI-2024-001,Mathematics,85,exam,2024-04-10,Math Mid-Term,Term 1,2024
Jane Smith,ELI-2024-002,English,78,test,2024-04-09,English Essay,Term 1,2024`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=marks_template.csv');
  res.send(template);
};
