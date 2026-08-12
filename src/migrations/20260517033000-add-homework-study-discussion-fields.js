'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('HomeTasks').catch(() => null);
    if (!table) return;
    if (!table.studyDiscussionEnabled) await queryInterface.addColumn('HomeTasks', 'studyDiscussionEnabled', { type: Sequelize.BOOLEAN, defaultValue: false });
    if (!table.studyThreadId) await queryInterface.addColumn('HomeTasks', 'studyThreadId', { type: Sequelize.INTEGER, allowNull: true });
    if (!table.studyDiscussionTitle) await queryInterface.addColumn('HomeTasks', 'studyDiscussionTitle', { type: Sequelize.STRING, allowNull: true });
    if (!table.studyDiscussionSettings) await queryInterface.addColumn('HomeTasks', 'studyDiscussionSettings', { type: Sequelize.JSONB, defaultValue: {} });
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('HomeTasks').catch(() => null);
    if (!table) return;
    for (const column of ['studyDiscussionSettings','studyDiscussionTitle','studyThreadId','studyDiscussionEnabled']) {
      if (table[column]) await queryInterface.removeColumn('HomeTasks', column);
    }
  }
};
