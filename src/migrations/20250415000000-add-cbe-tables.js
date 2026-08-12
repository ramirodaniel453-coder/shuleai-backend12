'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Competencies table
    await queryInterface.createTable('Competencies', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      code: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        comment: 'e.g., CC1, CC2'
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      category: {
        type: Sequelize.ENUM('core', 'generic', 'specific'),
        defaultValue: 'core'
      },
      curriculum: {
        type: Sequelize.ENUM('cbc', '844', 'british', 'american'),
        defaultValue: 'cbc'
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // 2. Learning Outcomes table
    await queryInterface.createTable('LearningOutcomes', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      code: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      subject: {
        type: Sequelize.STRING,
        allowNull: false
      },
      gradeLevel: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'e.g., Grade 7, Grade 8'
      },
      competencyId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Competencies', key: 'id' },
        onDelete: 'CASCADE'
      },
      curriculum: {
        type: Sequelize.ENUM('cbc', '844', 'british', 'american'),
        defaultValue: 'cbc'
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // 3. Student Competency Progress table
    await queryInterface.createTable('StudentCompetencyProgress', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      studentId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Students', key: 'id' },
        onDelete: 'CASCADE'
      },
      learningOutcomeId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'LearningOutcomes', key: 'id' },
        onDelete: 'CASCADE'
      },
      level: {
        type: Sequelize.ENUM('EE', 'ME', 'AE', 'BE'),
        allowNull: false,
        defaultValue: 'BE'
      },
      evidence: {
        type: Sequelize.JSONB,
        defaultValue: [],
        comment: 'Array of assessment ids or file references'
      },
      lastUpdated: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    // 4. Add foreign key indexes
    await queryInterface.addIndex('LearningOutcomes', ['competencyId']);
    await queryInterface.addIndex('StudentCompetencyProgress', ['studentId']);
    await queryInterface.addIndex('StudentCompetencyProgress', ['learningOutcomeId']);
    await queryInterface.addIndex('StudentCompetencyProgress', ['studentId', 'learningOutcomeId'], { unique: true });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('StudentCompetencyProgress');
    await queryInterface.dropTable('LearningOutcomes');
    await queryInterface.dropTable('Competencies');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Competencies_category";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_StudentCompetencyProgress_level";');
  }
};
