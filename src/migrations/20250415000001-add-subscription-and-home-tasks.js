'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Add subscription columns to Parents
    await queryInterface.addColumn('Parents', 'subscriptionPlan', {
      type: Sequelize.STRING(20),
      defaultValue: 'basic'
    });
    await queryInterface.addColumn('Parents', 'subscriptionStatus', {
      type: Sequelize.STRING(20),
      defaultValue: 'inactive'
    });
    await queryInterface.addColumn('Parents', 'subscriptionExpiry', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('Parents', 'subscriptionStartDate', {
      type: Sequelize.DATE,
      allowNull: true
    });
    await queryInterface.addColumn('Parents', 'trialEndsAt', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // 2. Create SubscriptionPlans table
    await queryInterface.createTable('SubscriptionPlans', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(20), allowNull: false }, // basic, premium, ultimate
      price_kes: { type: Sequelize.INTEGER, allowNull: false },
      schoolId: { type: Sequelize.INTEGER, references: { model: 'Schools', key: 'id' }, allowNull: true },
      features: { type: Sequelize.JSONB, defaultValue: [] },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // 3. Create HomeTasks table
    await queryInterface.createTable('HomeTasks', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: Sequelize.STRING, allowNull: false },
      instructions: { type: Sequelize.TEXT, allowNull: false },
      type: { type: Sequelize.STRING(20), allowNull: false }, // Practice, Application, Project, Reflection
      subject: { type: Sequelize.STRING, allowNull: false },
      competencyId: { type: Sequelize.INTEGER, references: { model: 'Competencies', key: 'id' }, allowNull: false },
      learningOutcomeId: { type: Sequelize.INTEGER, references: { model: 'LearningOutcomes', key: 'id' }, allowNull: true },
      gradeLevel: { type: Sequelize.STRING, allowNull: false },
      difficulty: { type: Sequelize.STRING(10), allowNull: false }, // Easy, Medium, Hard
      estimatedMinutes: { type: Sequelize.INTEGER, defaultValue: 15 },
      materials: { type: Sequelize.TEXT, allowNull: true },
      points: { type: Sequelize.INTEGER, defaultValue: 10 },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // 4. Create HomeTaskAssignments table
    await queryInterface.createTable('HomeTaskAssignments', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      studentId: { type: Sequelize.INTEGER, references: { model: 'Students', key: 'id' }, allowNull: false, onDelete: 'CASCADE' },
      taskId: { type: Sequelize.INTEGER, references: { model: 'HomeTasks', key: 'id' }, allowNull: false, onDelete: 'CASCADE' },
      assignedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      status: { type: Sequelize.STRING(20), defaultValue: 'pending' }, // pending, completed, skipped
      completedAt: { type: Sequelize.DATE, allowNull: true },
      parentFeedback: { type: Sequelize.JSONB, defaultValue: {} },
      studentFeedback: { type: Sequelize.JSONB, defaultValue: {} },
      pointsEarned: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // 5. Add indexes
    await queryInterface.addIndex('HomeTasks', ['gradeLevel', 'competencyId', 'subject', 'difficulty']);
    await queryInterface.addIndex('HomeTaskAssignments', ['studentId', 'assignedAt', 'status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('HomeTaskAssignments');
    await queryInterface.dropTable('HomeTasks');
    await queryInterface.dropTable('SubscriptionPlans');
    await queryInterface.removeColumn('Parents', 'subscriptionPlan');
    await queryInterface.removeColumn('Parents', 'subscriptionStatus');
    await queryInterface.removeColumn('Parents', 'subscriptionExpiry');
    await queryInterface.removeColumn('Parents', 'subscriptionStartDate');
    await queryInterface.removeColumn('Parents', 'trialEndsAt');
  }
};
