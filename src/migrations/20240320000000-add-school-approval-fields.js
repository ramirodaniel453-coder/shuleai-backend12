'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableExists = async (table) => {
      try { await queryInterface.describeTable(table); return true; }
      catch (_) { return false; }
    };

    const add = async (table, column, def) => {
      if (!(await tableExists(table))) return;
      const desc = await queryInterface.describeTable(table);
      if (!desc[column]) await queryInterface.addColumn(table, column, def);
    };

    // Correct architecture:
    // super_admin is platform-level and does NOT require a schoolCode.
    if (await tableExists('Users')) {
      try {
        await queryInterface.changeColumn('Users', 'schoolCode', {
          type: Sequelize.STRING,
          allowNull: true
        });
      } catch (e) {
        console.warn('[migration] Could not alter Users.schoolCode nullable:', e.message);
      }

      await queryInterface.sequelize.query(`
        UPDATE "Users"
        SET "schoolCode" = NULL
        WHERE "role" = 'super_admin' AND "schoolCode" = 'SUPER-ADMIN';
      `);
    }

    await add('Schools', 'isApproved', { type: Sequelize.BOOLEAN, defaultValue: false });
    await add('Schools', 'approvedAt', { type: Sequelize.DATE, allowNull: true });
    await add('Schools', 'approvedBy', { type: Sequelize.INTEGER, allowNull: true });
    await add('Schools', 'rejectionReason', { type: Sequelize.TEXT, allowNull: true });
    await add('Schools', 'status', { type: Sequelize.STRING, defaultValue: 'pending' });
  },

  async down() {
    throw new Error('Irreversible migration 20240320000000-add-school-approval-fields.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};