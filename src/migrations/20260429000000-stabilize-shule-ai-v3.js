'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableExists = async (table) => {
      try {
        await queryInterface.describeTable(table);
        return true;
      } catch (_) {
        return false;
      }
    };

    const add = async (table, column, def) => {
      if (!(await tableExists(table))) return;
      const desc = await queryInterface.describeTable(table);
      if (!desc[column]) await queryInterface.addColumn(table, column, def);
    };

    const jsonType = Sequelize.JSONB || Sequelize.JSON;

    await add('Students', 'assessmentNumber', { type: Sequelize.STRING, allowNull: true });
    await add('Students', 'nemisNumber', { type: Sequelize.STRING, allowNull: true });
    await add('Students', 'location', { type: Sequelize.STRING, allowNull: true });
    await add('Students', 'parentName', { type: Sequelize.STRING, allowNull: true });
    await add('Students', 'parentEmail', { type: Sequelize.STRING, allowNull: true });
    await add('Students', 'parentPhone', { type: Sequelize.STRING, allowNull: true });
    await add('Students', 'parentRelationship', { type: Sequelize.STRING, allowNull: true, defaultValue: 'guardian' });
    await add('Students', 'isPrefect', { type: Sequelize.BOOLEAN, defaultValue: false });

    await add('Timetables', 'term', { type: Sequelize.STRING, allowNull: true });
    await add('Timetables', 'year', { type: Sequelize.INTEGER, allowNull: true });
    await add('Timetables', 'scope', { type: Sequelize.STRING, defaultValue: 'term' });
    await add('Timetables', 'classes', { type: jsonType, defaultValue: [] });
    await add('Timetables', 'warnings', { type: jsonType, defaultValue: [] });

    await add('SchoolCalendars', 'term', { type: Sequelize.STRING, allowNull: true });
    await add('SchoolCalendars', 'year', { type: Sequelize.INTEGER, allowNull: true });
    await add('SchoolCalendars', 'description', { type: Sequelize.TEXT, allowNull: true });
  },

  async down() {
    throw new Error('Irreversible migration 20260429000000-stabilize-shule-ai-v3.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};