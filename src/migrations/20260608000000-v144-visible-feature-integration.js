'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const students = await queryInterface.describeTable('Students');
    if (!students.dateOfBirthVerified) {
      await queryInterface.addColumn('Students', 'dateOfBirthVerified', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }
    if (!students.birthdayPrivacy) {
      await queryInterface.addColumn('Students', 'birthdayPrivacy', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal("'{\"enabled\":true,\"notifyParent\":true,\"notifyTeacher\":true,\"notifyStudent\":true,\"announceToClass\":false}'::jsonb")
      });
    }
    await queryInterface.addIndex('Students', ['dateOfBirth'], {
      name: 'idx_students_date_of_birth'
    }).catch(() => null);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Students', 'idx_students_date_of_birth').catch(() => null);
    await queryInterface.removeColumn('Students', 'birthdayPrivacy').catch(() => null);
    await queryInterface.removeColumn('Students', 'dateOfBirthVerified').catch(() => null);
  }
};
