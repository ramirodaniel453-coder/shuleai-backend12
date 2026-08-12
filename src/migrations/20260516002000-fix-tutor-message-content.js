'use strict';

async function columnExists(queryInterface, table, column) {
  try {
    const desc = await queryInterface.describeTable(table);
    return !!desc[column];
  } catch (_) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'TutorMessages';
    try {
      const desc = await queryInterface.describeTable(table);
      if (!desc.content) {
        await queryInterface.addColumn(table, 'content', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' });
      }
      if (!desc.message) {
        await queryInterface.addColumn(table, 'message', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' });
      }
      await queryInterface.sequelize.query(`UPDATE "TutorMessages" SET "content" = COALESCE(NULLIF("content", ''), "message", 'Tutor message') WHERE "content" IS NULL OR "content" = ''`).catch(() => null);
      await queryInterface.sequelize.query(`UPDATE "TutorMessages" SET "message" = COALESCE(NULLIF("message", ''), "content", 'Tutor message') WHERE "message" IS NULL OR "message" = ''`).catch(() => null);
      await queryInterface.changeColumn(table, 'content', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' }).catch(() => null);
      await queryInterface.changeColumn(table, 'message', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' }).catch(() => null);
    } catch (error) {
      console.warn('[migration] TutorMessages content alignment skipped:', error.message);
    }
  },

  async down(queryInterface) {
    throw new Error('Irreversible migration 20260516002000-fix-tutor-message-content.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
