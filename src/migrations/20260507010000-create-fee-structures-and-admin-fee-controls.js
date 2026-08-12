'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('FeeStructures', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      classId: { type: Sequelize.INTEGER, allowNull: true },
      className: { type: Sequelize.STRING, allowNull: false },
      gradeLevel: { type: Sequelize.STRING, allowNull: true },
      curriculum: { type: Sequelize.STRING, allowNull: true, defaultValue: 'CBC' },
      term: { type: Sequelize.ENUM('Term 1', 'Term 2', 'Term 3'), allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'KES' },
      items: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      optionalItems: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      discounts: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      totalAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('draft', 'active', 'locked', 'archived'), allowNull: false, defaultValue: 'draft' },
      effectiveFrom: { type: Sequelize.DATE, allowNull: true },
      dueDate: { type: Sequelize.DATE, allowNull: true },
      lockedAt: { type: Sequelize.DATE, allowNull: true },
      lockedBy: { type: Sequelize.INTEGER, allowNull: true },
      createdBy: { type: Sequelize.INTEGER, allowNull: true },
      updatedBy: { type: Sequelize.INTEGER, allowNull: true },
      auditTrail: { type: Sequelize.JSONB, defaultValue: [] },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });
    await queryInterface.addIndex('FeeStructures', ['schoolCode', 'className', 'term', 'year']);
    await queryInterface.addIndex('FeeStructures', ['schoolCode', 'status']);

    const safeAdd = async (table, column, spec) => {
      try { const desc = await queryInterface.describeTable(table); if (!desc[column]) await queryInterface.addColumn(table, column, spec); } catch (e) { console.warn(`Skipped ${table}.${column}: ${e.message}`); }
    };
    await safeAdd('Fees', 'feeStructureId', { type: Sequelize.INTEGER, allowNull: true });
    await safeAdd('Fees', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await safeAdd('Fees', 'currency', { type: Sequelize.STRING, defaultValue: 'KES' });
    await safeAdd('Fees', 'locked', { type: Sequelize.BOOLEAN, defaultValue: false });
    await safeAdd('Fees', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });
    await safeAdd('Fees', 'adjustments', { type: Sequelize.JSONB, defaultValue: [] });
    await safeAdd('Fees', 'lastReconciledAt', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('FeeStructures');
  }
};
