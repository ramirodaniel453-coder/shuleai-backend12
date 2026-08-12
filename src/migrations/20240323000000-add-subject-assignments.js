// migrations/20240323000000-add-subject-assignments.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Add subjectCombination to Students
    await queryInterface.addColumn('Students', 'subjectCombination', {
      type: Sequelize.ARRAY(Sequelize.STRING),
      defaultValue: []
    });

    // 2. Create TeacherSubjectAssignments table
    await queryInterface.createTable('TeacherSubjectAssignments', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      teacherId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Teachers',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      classId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Classes',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      subject: {
        type: Sequelize.STRING,
        allowNull: false
      },
      isClassTeacher: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      academicYear: {
        type: Sequelize.STRING,
        defaultValue: new Date().getFullYear().toString()
      },
      createdAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      }
    });

    // 3. Add indexes for performance
    await queryInterface.addIndex('TeacherSubjectAssignments', ['teacherId', 'classId', 'subject']);
    await queryInterface.addIndex('TeacherSubjectAssignments', ['classId']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('TeacherSubjectAssignments');
    await queryInterface.removeColumn('Students', 'subjectCombination');
  }
};
