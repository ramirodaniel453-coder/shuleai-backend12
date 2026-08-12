// migrations/20240330000001-create-tasks-table.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.describeTable('Tasks');
      console.log('[migration-safe] Tasks table already exists; skipping createTable');
      return;
    } catch (_) {}
    await queryInterface.createTable('Tasks', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE'
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      dueDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      priority: {
        type: Sequelize.ENUM('low', 'medium', 'high', 'urgent'),
        defaultValue: 'medium'
      },
      status: {
        type: Sequelize.ENUM('pending', 'in_progress', 'completed', 'cancelled'),
        defaultValue: 'pending'
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      category: {
        type: Sequelize.STRING,
        defaultValue: 'general'
      },
      reminderSent: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.describeTable('Tasks');
      await queryInterface.dropTable('Tasks');
    } catch (_) {
      console.log('[migration-safe] Tasks table missing; skipping dropTable');
    }
  }
};
