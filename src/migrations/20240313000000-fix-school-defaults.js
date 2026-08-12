'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // First, make columns nullable temporarily to allow fixes
    await queryInterface.changeColumn('Schools', 'schoolId', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true
    });
    
    await queryInterface.changeColumn('Schools', 'shortCode', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn('Schools', 'schoolId', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true
    });
    
    await queryInterface.changeColumn('Schools', 'shortCode', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true
    });
  }
};
