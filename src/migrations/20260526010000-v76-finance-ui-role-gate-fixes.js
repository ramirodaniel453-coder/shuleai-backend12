'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const add = async (table, column, spec) => {
      try { await queryInterface.addColumn(table, column, spec); }
      catch (e) { if (!String(e.message || '').includes('already exists')) throw e; }
    };
    await add('SchoolPaymentSettings', 'auditTrail', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('SchoolPaymentSettings', 'metadata', { type: Sequelize.JSONB, allowNull: false, defaultValue: {} });
    await queryInterface.sequelize.query(`
      UPDATE "SchoolPaymentSettings"
      SET "auditTrail" = COALESCE("auditTrail", '[]'::jsonb),
          "metadata" = COALESCE("metadata", '{}'::jsonb)
    `).catch((e) => {
      if (!String(e.message || '').includes('does not exist')) throw e;
    });
  },
  async down() {
    throw new Error('Irreversible migration 20260526010000-v76-finance-ui-role-gate-fixes.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
