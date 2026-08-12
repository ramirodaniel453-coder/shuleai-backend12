'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const addColumnSafe = async (table, column, spec) => {
      try { await queryInterface.addColumn(table, column, spec); }
      catch (e) { if (!/already exists|duplicate column/i.test(String(e.message || ''))) throw e; }
    };

    await addColumnSafe('SchoolCalendars', 'time', { type: Sequelize.STRING, allowNull: true });
    await addColumnSafe('SchoolCalendars', 'location', { type: Sequelize.STRING, allowNull: true });
    await addColumnSafe('SchoolCalendars', 'audience', { type: Sequelize.STRING, allowNull: false, defaultValue: 'whole_school' });
    await addColumnSafe('SchoolCalendars', 'isPublic', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });

    await addColumnSafe('SchoolPaymentSettings', 'metadata', { type: Sequelize.JSONB, allowNull: false, defaultValue: {} });
    await addColumnSafe('SchoolPaymentSettings', 'auditTrail', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await addColumnSafe('SchoolPaymentSettings', 'bankName', { type: Sequelize.STRING, allowNull: true });
    await addColumnSafe('SchoolPaymentSettings', 'bankAccountName', { type: Sequelize.STRING, allowNull: true });
    await addColumnSafe('SchoolPaymentSettings', 'bankAccountNumber', { type: Sequelize.STRING, allowNull: true });
    await addColumnSafe('SchoolPaymentSettings', 'bankBranch', { type: Sequelize.STRING, allowNull: true });

    await queryInterface.sequelize.query(`
      UPDATE "SchoolPaymentSettings"
      SET "metadata" = COALESCE("metadata", '{}'::jsonb),
          "auditTrail" = COALESCE("auditTrail", '[]'::jsonb)
    `).catch(() => {});

    await queryInterface.addIndex('SchoolCalendars', ['schoolId', 'startDate'], { name: 'v88_school_calendar_school_start_idx' }).catch(() => {});
  },
  async down() {
    throw new Error('Irreversible migration 20260526080000-v88-calendar-payment-role-stability.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
