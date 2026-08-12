const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, ReportSnapshot } = require('../models');
const realtime = require('./realtimeService');

function assessmentKeyOf({ assessmentType, assessmentName, assessmentKey }) {
  const raw = assessmentKey || [assessmentType, assessmentName].filter(Boolean).join(':') || 'term';
  return String(raw).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 120) || 'term';
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

async function createPublishedVersion(input, options = {}) {
  const ownTransaction = !options.transaction;
  const transaction = options.transaction || await sequelize.transaction();
  try {
    const key = assessmentKeyOf(input);
    const where = {
      schoolCode: input.schoolCode,
      studentId: Number(input.studentId),
      term: input.term,
      year: Number(input.year),
      reportType: input.reportType || 'academic',
      assessmentKey: key
    };
    const previous = await ReportSnapshot.findOne({ where: { ...where, isCurrent: true }, order: [['version','DESC']], transaction, lock: transaction.LOCK.UPDATE });
    if (previous && input.correctionReason == null && previous.checksum === (input.checksum || checksum(input.snapshot))) {
      if (ownTransaction) await transaction.commit();
      return { row: previous, created: false, unchanged: true };
    }
    if (previous) await previous.update({ isCurrent: false, status: 'archived' }, { transaction, hooks: false });
    const version = Number(previous?.version || 0) + 1;
    const now = input.publishedAt || new Date();
    const row = await ReportSnapshot.create({
      schoolCode: input.schoolCode,
      studentId: Number(input.studentId),
      classId: input.classId || null,
      term: input.term,
      year: Number(input.year),
      curriculum: input.curriculum || null,
      reportType: input.reportType || 'academic',
      status: 'published',
      generatedBy: input.generatedBy || input.publishedBy || null,
      publishedBy: input.publishedBy || null,
      publishedAt: now,
      snapshot: input.snapshot || {},
      sourceRecordIds: input.sourceRecordIds || [],
      checksum: input.checksum || checksum(input.snapshot),
      metadata: { ...(input.metadata || {}), immutable: true },
      version,
      assessmentKey: key,
      supersedesId: previous?.id || null,
      correctionReason: input.correctionReason || null,
      isCurrent: true,
      lockedAt: now,
      formatVersion: process.env.REPORT_FORMAT_VERSION || 'v150.6'
    }, { transaction, hooks: false });

    await realtime.emit({
      type: input.correctionReason ? 'report_card:corrected' : 'report_card:published',
      schoolCode: input.schoolCode,
      audience: { school: false, roles: ['admin'], classIds: input.classId ? [input.classId] : [], studentIds: [input.studentId], userIds: input.recipientUserIds || [] },
      entityType: 'ReportSnapshot', entityId: row.id, version,
      data: { reportSnapshotId: row.id, studentId: row.studentId, classId: row.classId, term: row.term, year: row.year, assessmentKey: key, version, publishedAt: now },
      transaction
    });
    await realtime.emitToSchool(input.schoolCode, 'analytics:invalidated', { scope: 'academics', classId: input.classId || null, studentId: input.studentId }, { transaction });
    if (ownTransaction) await transaction.commit();
    return { row, created: true, unchanged: false };
  } catch (error) {
    if (ownTransaction && !transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function listHistory(where, options = {}) {
  return ReportSnapshot.findAll({ where, order: [['year','DESC'],['term','DESC'],['assessmentKey','ASC'],['version','DESC']], ...options });
}

module.exports = { createPublishedVersion, listHistory, assessmentKeyOf, checksum };
