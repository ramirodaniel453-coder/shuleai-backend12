'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const safeAdd = async (table, column, spec) => {
      try {
        const desc = await queryInterface.describeTable(table);
        if (!desc[column]) await queryInterface.addColumn(table, column, spec);
      } catch (error) {
        console.warn(`[v30 migration] ${table}.${column}: ${error.message}`);
      }
    };
    const safeIndex = async (table, columns, name) => {
      try { await queryInterface.addIndex(table, columns, { name }); }
      catch (error) { if (!String(error.message).includes('already exists')) console.warn(`[v30 migration] index ${name}: ${error.message}`); }
    };

    await safeAdd('Students', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await safeAdd('Students', 'curriculum', { type: Sequelize.STRING, allowNull: true, defaultValue: 'cbc' });
    await safeAdd('Students', 'admissionNumber', { type: Sequelize.STRING, allowNull: true });

    await safeAdd('Fees', 'feeStructureId', { type: Sequelize.INTEGER, allowNull: true });
    await safeAdd('Fees', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await safeAdd('Fees', 'currency', { type: Sequelize.STRING, allowNull: true, defaultValue: 'KES' });
    await safeAdd('Fees', 'locked', { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false });
    await safeAdd('Fees', 'auditTrail', { type: Sequelize.JSONB, allowNull: true, defaultValue: [] });
    await safeAdd('Fees', 'adjustments', { type: Sequelize.JSONB, allowNull: true, defaultValue: [] });
    await safeAdd('Fees', 'lastReconciledAt', { type: Sequelize.DATE, allowNull: true });

    await safeIndex('Students', ['classId'], 'idx_students_class_id_v30_migration');
    await safeIndex('Fees', ['schoolCode', 'classId', 'term', 'year'], 'idx_fees_class_term_v30_migration');
  },
  async down() {
    throw new Error('Irreversible migration 20260508010000-v30-runtime-classid-analytics-fix.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
