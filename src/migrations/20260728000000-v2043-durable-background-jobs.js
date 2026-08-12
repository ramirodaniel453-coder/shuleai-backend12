'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('BackgroundJobs', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      type: { type: Sequelize.STRING(80), allowNull: false },
      status: { type: Sequelize.ENUM('queued', 'processing', 'completed', 'failed', 'cancelled'), allowNull: false, defaultValue: 'queued' },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      createdBy: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      result: { type: Sequelize.JSONB, allowNull: true },
      progress: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      maxAttempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      error: { type: Sequelize.TEXT, allowNull: true },
      logs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      lockedBy: { type: Sequelize.STRING(120), allowNull: true },
      lockedAt: { type: Sequelize.DATE, allowNull: true },
      startedAt: { type: Sequelize.DATE, allowNull: true },
      completedAt: { type: Sequelize.DATE, allowNull: true },
      failedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });
    await queryInterface.addIndex('BackgroundJobs', ['status', 'createdAt'], { name: 'background_jobs_status_created_idx' });
    await queryInterface.addIndex('BackgroundJobs', ['schoolCode', 'createdAt'], { name: 'background_jobs_school_created_idx' });
    await queryInterface.addIndex('BackgroundJobs', ['createdBy', 'createdAt'], { name: 'background_jobs_creator_created_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('BackgroundJobs');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_BackgroundJobs_status"');
  }
};
