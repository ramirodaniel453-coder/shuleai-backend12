'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add department field to Teachers
    await queryInterface.addColumn('Teachers', 'department', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'general'
    });

    // Add timetable field to Teachers
    await queryInterface.addColumn('Teachers', 'timetable', {
      type: Sequelize.JSONB,
      defaultValue: {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: []
      }
    });

    // Update statistics structure
    // Note: This is a JSONB field, so we don't need to change the column type
    // Just ensure existing data has the new fields
    
    // Add indexes for performance
    await queryInterface.addIndex('Teachers', ['department']);
    await queryInterface.addIndex('DutyRosters', ['schoolId', 'date']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Teachers', 'department');
    await queryInterface.removeColumn('Teachers', 'timetable');
    await queryInterface.removeIndex('Teachers', ['department']);
    await queryInterface.removeIndex('DutyRosters', ['schoolId', 'date']);
  }
};