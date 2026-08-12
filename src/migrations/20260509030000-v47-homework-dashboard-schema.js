'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const add = async (table, column, def) => {
      try { await queryInterface.addColumn(table, column, def); } catch (e) { if (!String(e.message || '').includes('already exists')) console.warn(`[v47] ${table}.${column}: ${e.message}`); }
    };
    await add('Attendances', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('Attendances', 'markedBy', { type: Sequelize.INTEGER, allowNull: true });
    await add('Attendances', 'editedBy', { type: Sequelize.INTEGER, allowNull: true });
    await add('Attendances', 'editReason', { type: Sequelize.TEXT, allowNull: true });
    await add('Attendances', 'auditTrail', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('HomeTasks', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    await add('HomeTasks', 'createdBy', { type: Sequelize.INTEGER, allowNull: true });
    await add('HomeTasks', 'createdByUserId', { type: Sequelize.INTEGER, allowNull: true });
    await add('HomeTasks', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('HomeTasks', 'className', { type: Sequelize.STRING, allowNull: true });
    await add('HomeTaskAssignments', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    await add('HomeTaskAssignments', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS idx_hometasks_teacher_school ON "HomeTasks" ("createdBy", "schoolCode")').catch(() => null);
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS idx_hometask_assignments_student ON "HomeTaskAssignments" ("studentId", "status")').catch(() => null);
  },
  async down(queryInterface) {
    throw new Error('Irreversible migration 20260509030000-v47-homework-dashboard-schema.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
