'use strict';

async function addColumnSafe(queryInterface, table, name, definition) {
  const desc = await queryInterface.describeTable(table).catch(() => null);
  if (!desc || desc[name]) return;
  await queryInterface.addColumn(table, name, definition);
}
async function createIndexSafe(queryInterface, table, fields, options={}) {
  try { await queryInterface.addIndex(table, fields, options); } catch (e) { if (!/already exists|duplicate/i.test(e.message)) throw e; }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AuditLogs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      actorUserId: Sequelize.INTEGER,
      actorRole: Sequelize.STRING,
      module: { type: Sequelize.STRING, allowNull: false },
      action: { type: Sequelize.STRING, allowNull: false },
      entityType: { type: Sequelize.STRING, allowNull: false },
      entityId: Sequelize.STRING,
      before: Sequelize.JSONB,
      after: Sequelize.JSONB,
      reason: Sequelize.TEXT,
      ipAddress: Sequelize.STRING,
      userAgent: Sequelize.TEXT,
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if(!/already exists/i.test(e.message)) throw e; });

    await queryInterface.createTable('ReportSnapshots', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' } },
      classId: Sequelize.INTEGER,
      term: { type: Sequelize.STRING, allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      curriculum: Sequelize.STRING,
      reportType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'academic' },
      status: { type: Sequelize.ENUM('draft','published','archived'), defaultValue: 'draft' },
      generatedBy: Sequelize.INTEGER,
      publishedBy: Sequelize.INTEGER,
      publishedAt: Sequelize.DATE,
      snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      sourceRecordIds: { type: Sequelize.ARRAY(Sequelize.INTEGER), defaultValue: [] },
      checksum: Sequelize.STRING,
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if(!/already exists/i.test(e.message)) throw e; });

    await addColumnSafe(queryInterface, 'Payments', 'accountReference', { type: Sequelize.STRING });
    await addColumnSafe(queryInterface, 'Payments', 'checkoutRequestId', { type: Sequelize.STRING });
    await addColumnSafe(queryInterface, 'Payments', 'merchantRequestId', { type: Sequelize.STRING });
    await addColumnSafe(queryInterface, 'Payments', 'mpesaReceiptNumber', { type: Sequelize.STRING });
    await addColumnSafe(queryInterface, 'Payments', 'payerPhone', { type: Sequelize.STRING });
    await addColumnSafe(queryInterface, 'Payments', 'paidTo', { type: Sequelize.STRING, defaultValue: 'platform' });
    await addColumnSafe(queryInterface, 'Payments', 'locked', { type: Sequelize.BOOLEAN, defaultValue: true });
    await addColumnSafe(queryInterface, 'Payments', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });

    await addColumnSafe(queryInterface, 'Fees', 'feeStructureId', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'Fees', 'classId', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'Fees', 'currency', { type: Sequelize.STRING, defaultValue: 'KES' });
    await addColumnSafe(queryInterface, 'Fees', 'locked', { type: Sequelize.BOOLEAN, defaultValue: false });
    await addColumnSafe(queryInterface, 'Fees', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnSafe(queryInterface, 'Fees', 'adjustments', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnSafe(queryInterface, 'Fees', 'lastReconciledAt', { type: Sequelize.DATE });

    await addColumnSafe(queryInterface, 'AcademicRecords', 'classId', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'curriculum', { type: Sequelize.STRING });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'status', { type: Sequelize.STRING, defaultValue: 'draft' });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'publishedAt', { type: Sequelize.DATE });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'publishedBy', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'lockedAt', { type: Sequelize.DATE });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'unlockedBy', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'unlockReason', { type: Sequelize.TEXT });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'version', { type: Sequelize.INTEGER, defaultValue: 1 });
    await addColumnSafe(queryInterface, 'AcademicRecords', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });

    await addColumnSafe(queryInterface, 'Attendance', 'classId', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'Attendance', 'markedBy', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'Attendance', 'editedBy', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'Attendance', 'editReason', { type: Sequelize.TEXT });
    await addColumnSafe(queryInterface, 'Attendance', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });

    await addColumnSafe(queryInterface, 'Students', 'classId', { type: Sequelize.INTEGER });
    await addColumnSafe(queryInterface, 'Students', 'curriculum', { type: Sequelize.STRING, defaultValue: 'cbc' });
    await addColumnSafe(queryInterface, 'Students', 'admissionNumber', { type: Sequelize.STRING });

    await createIndexSafe(queryInterface, 'ReportSnapshots', ['schoolCode','studentId','term','year','reportType'], { unique: true, name:'reports_snapshot_unique_v27' });
    await createIndexSafe(queryInterface, 'AuditLogs', ['schoolCode','module'], { name:'audit_school_module_v27' });
  },
  async down() {
    throw new Error('Irreversible migration 20260507000000-v27-production-merge-safety-fields.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
