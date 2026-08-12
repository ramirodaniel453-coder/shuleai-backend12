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
    const hasGradeLevel = await columnExists(queryInterface, 'TutorSessions', 'gradeLevel');
    if (!hasGradeLevel) {
      await queryInterface.addColumn('TutorSessions', 'gradeLevel', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: 'Grade 5'
      });
    } else {
      await queryInterface.changeColumn('TutorSessions', 'gradeLevel', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: 'Grade 5'
      });
    }
  },
  async down(queryInterface, Sequelize) {
    if (await columnExists(queryInterface, 'TutorSessions', 'gradeLevel')) {
      await queryInterface.changeColumn('TutorSessions', 'gradeLevel', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }
  }
};
