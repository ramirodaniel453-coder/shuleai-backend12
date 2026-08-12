'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName).catch(() => null);
  return !!(table && table[columnName]);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('TutorSessions').catch(() => null);
    if (!table) return;

    if (!(await columnExists(queryInterface, 'TutorSessions', 'title'))) {
      await queryInterface.addColumn('TutorSessions', 'title', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'AI Tutor Session'
      });
    } else {
      await queryInterface.sequelize.query(`
        UPDATE "TutorSessions"
        SET "title" = COALESCE(NULLIF(TRIM("title"), ''), 'AI Tutor Session')
        WHERE "title" IS NULL OR TRIM("title") = ''
      `).catch(() => null);
      await queryInterface.changeColumn('TutorSessions', 'title', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'AI Tutor Session'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    if (await columnExists(queryInterface, 'TutorSessions', 'title')) {
      await queryInterface.changeColumn('TutorSessions', 'title', {
        type: Sequelize.STRING,
        allowNull: true
      }).catch(() => null);
    }
  }
};
