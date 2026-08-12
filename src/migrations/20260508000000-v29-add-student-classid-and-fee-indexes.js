'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const safeAdd = async (table, column, spec) => {
      try {
        const desc = await queryInterface.describeTable(table);
        if (!desc[column]) await queryInterface.addColumn(table, column, spec);
      } catch (error) {
        console.warn(`[v29 migration] Skipped ${table}.${column}: ${error.message}`);
      }
    };

    const safeIndex = async (table, columns, name) => {
      try {
        await queryInterface.addIndex(table, columns, { name });
      } catch (error) {
        const msg = error?.message || '';
        if (!msg.includes('already exists')) console.warn(`[v29 migration] Skipped index ${name}: ${msg}`);
      }
    };

    await safeAdd('Students', 'classId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Classes', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await safeAdd('Students', 'curriculum', { type: Sequelize.STRING, allowNull: true, defaultValue: 'cbc' });
    await safeAdd('Students', 'admissionNumber', { type: Sequelize.STRING, allowNull: true });

    await safeIndex('Students', ['classId'], 'idx_students_class_id_v29');
    await safeIndex('Students', ['grade'], 'idx_students_grade_v29');

    await safeAdd('Fees', 'feeStructureId', { type: Sequelize.INTEGER, allowNull: true });
    await safeAdd('Fees', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await safeAdd('Fees', 'currency', { type: Sequelize.STRING, defaultValue: 'KES' });
    await safeAdd('Fees', 'locked', { type: Sequelize.BOOLEAN, defaultValue: false });
    await safeAdd('Fees', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });
    await safeAdd('Fees', 'adjustments', { type: Sequelize.JSONB, defaultValue: [] });
    await safeAdd('Fees', 'lastReconciledAt', { type: Sequelize.DATE, allowNull: true });

    await safeIndex('Fees', ['schoolCode', 'studentId', 'term', 'year'], 'idx_fees_student_term_v29');
    await safeIndex('Fees', ['schoolCode', 'classId', 'term', 'year'], 'idx_fees_class_term_v29');
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Students', 'classId');
  }
};
