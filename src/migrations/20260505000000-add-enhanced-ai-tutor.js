'use strict';

async function tableExists(queryInterface, tableName) {
  try {
    await queryInterface.describeTable(tableName);
    return true;
  } catch (err) {
    return false;
  }
}

async function ensureColumn(queryInterface, Sequelize, tableName, columnName, definition) {
  const exists = await tableExists(queryInterface, tableName);
  if (!exists) return false;
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
  return true;
}

async function safeAddIndex(queryInterface, tableName, fields, options = {}) {
  const indexName = options.name || `idx_${tableName.toLowerCase()}_${fields.join('_')}`;
  try {
    const table = await queryInterface.describeTable(tableName);
    const missing = fields.filter((field) => !table[field]);
    if (missing.length) {
      console.warn(`[migration:tutor] Skipping index ${indexName}; missing columns on ${tableName}: ${missing.join(', ')}`);
      return;
    }
    await queryInterface.addIndex(tableName, fields, { ...options, name: indexName });
  } catch (err) {
    const msg = String(err && (err.message || err.original?.message || err));
    if (msg.includes('already exists') || msg.includes('relation') || msg.includes('exists') || msg.includes('does not exist') || msg.includes('column')) {
      console.warn(`[migration:tutor] Skipped index ${indexName} safely: ${msg}`);
      return;
    }
    throw err;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'TutorSessions'))) {
      await queryInterface.createTable('TutorSessions', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        schoolId: { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' },
        studentId: { type: Sequelize.INTEGER, allowNull: false },
        userId: { type: Sequelize.INTEGER, allowNull: true },
        title: { type: Sequelize.STRING, allowNull: false, defaultValue: 'AI Tutor Session' },
        grade: { type: Sequelize.STRING, allowNull: true },
        gradeLevel: { type: Sequelize.STRING, allowNull: true, defaultValue: 'Grade 5' },
        level: { type: Sequelize.STRING, allowNull: true },
        subject: { type: Sequelize.STRING, allowNull: true },
        mode: { type: Sequelize.STRING, allowNull: false, defaultValue: 'learn' },
        lastCommand: { type: Sequelize.STRING, allowNull: true },
        metadata: { type: Sequelize.JSONB, defaultValue: {} },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      });
    }

    if (!(await tableExists(queryInterface, 'TutorMessages'))) {
      await queryInterface.createTable('TutorMessages', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        schoolId: { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' },
        sessionId: { type: Sequelize.INTEGER, allowNull: true },
        studentId: { type: Sequelize.INTEGER, allowNull: false },
        userId: { type: Sequelize.INTEGER, allowNull: true },
        title: { type: Sequelize.STRING, allowNull: false, defaultValue: 'AI Tutor Session' },
        role: { type: Sequelize.STRING, allowNull: false },
        message: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
        content: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
        subject: { type: Sequelize.STRING, allowNull: true },
        topic: { type: Sequelize.STRING, allowNull: true },
        command: { type: Sequelize.STRING, allowNull: true },
        source: { type: Sequelize.STRING, allowNull: true },
        metadata: { type: Sequelize.JSONB, defaultValue: {} },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      });
    }

    if (!(await tableExists(queryInterface, 'TutorProgresses'))) {
      await queryInterface.createTable('TutorProgresses', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        schoolId: { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' },
        studentId: { type: Sequelize.INTEGER, allowNull: false },
        grade: { type: Sequelize.STRING, allowNull: true },
        gradeLevel: { type: Sequelize.STRING, allowNull: true, defaultValue: 'Grade 5' },
        level: { type: Sequelize.STRING, allowNull: true },
        subject: { type: Sequelize.STRING, allowNull: false },
        topic: { type: Sequelize.STRING, allowNull: false, defaultValue: 'General' },
        attempts: { type: Sequelize.INTEGER, defaultValue: 0 },
        correct: { type: Sequelize.INTEGER, defaultValue: 0 },
        lastCommand: { type: Sequelize.STRING, allowNull: true },
        lastSource: { type: Sequelize.STRING, allowNull: true },
        lastStudiedAt: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, defaultValue: {} },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      });
    }

    if (!(await tableExists(queryInterface, 'TutorUsages'))) {
      await queryInterface.createTable('TutorUsages', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        schoolId: { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' },
        studentId: { type: Sequelize.INTEGER, allowNull: false },
        usageDate: { type: Sequelize.DATEONLY, allowNull: false },
        totalQuestions: { type: Sequelize.INTEGER, defaultValue: 0 },
        aiCalls: { type: Sequelize.INTEGER, defaultValue: 0 },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      });
    }

    // Repair partially-created Render tables from older tutor builds.
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'schoolId', { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'studentId', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'userId', { type: Sequelize.INTEGER, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'title', { type: Sequelize.STRING, allowNull: false, defaultValue: 'AI Tutor Session' });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'grade', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'gradeLevel', { type: Sequelize.STRING, allowNull: true, defaultValue: 'Grade 5' });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'level', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'subject', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'mode', { type: Sequelize.STRING, allowNull: false, defaultValue: 'learn' });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'lastCommand', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'metadata', { type: Sequelize.JSONB, defaultValue: {} });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'createdAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
    await ensureColumn(queryInterface, Sequelize, 'TutorSessions', 'updatedAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });

    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'schoolId', { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'sessionId', { type: Sequelize.INTEGER, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'studentId', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'userId', { type: Sequelize.INTEGER, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'role', { type: Sequelize.STRING, allowNull: false, defaultValue: 'student' });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'message', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'content', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'subject', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'topic', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'command', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'source', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'metadata', { type: Sequelize.JSONB, defaultValue: {} });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'createdAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
    await ensureColumn(queryInterface, Sequelize, 'TutorMessages', 'updatedAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });

    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'schoolId', { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'studentId', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'grade', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'level', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'subject', { type: Sequelize.STRING, allowNull: false, defaultValue: 'General' });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'topic', { type: Sequelize.STRING, allowNull: false, defaultValue: 'General' });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'attempts', { type: Sequelize.INTEGER, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'correct', { type: Sequelize.INTEGER, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'lastCommand', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'lastSource', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'lastStudiedAt', { type: Sequelize.DATE, allowNull: true });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'metadata', { type: Sequelize.JSONB, defaultValue: {} });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'createdAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
    await ensureColumn(queryInterface, Sequelize, 'TutorProgresses', 'updatedAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });

    await ensureColumn(queryInterface, Sequelize, 'TutorUsages', 'schoolId', { type: Sequelize.STRING, allowNull: false, defaultValue: 'default-school' });
    await ensureColumn(queryInterface, Sequelize, 'TutorUsages', 'studentId', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorUsages', 'usageDate', { type: Sequelize.DATEONLY, allowNull: false, defaultValue: Sequelize.literal('CURRENT_DATE') });
    await ensureColumn(queryInterface, Sequelize, 'TutorUsages', 'totalQuestions', { type: Sequelize.INTEGER, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorUsages', 'aiCalls', { type: Sequelize.INTEGER, defaultValue: 0 });
    await ensureColumn(queryInterface, Sequelize, 'TutorUsages', 'createdAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
    await ensureColumn(queryInterface, Sequelize, 'TutorUsages', 'updatedAt', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });

    await safeAddIndex(queryInterface, 'TutorMessages', ['schoolId', 'studentId', 'createdAt'], { name: 'idx_tutor_messages_school_student_created' });
    await safeAddIndex(queryInterface, 'TutorProgresses', ['schoolId', 'studentId', 'subject', 'topic'], { unique: true, name: 'idx_tutor_progress_school_student_subject_topic' });
    await safeAddIndex(queryInterface, 'TutorUsages', ['schoolId', 'studentId', 'usageDate'], { unique: true, name: 'idx_tutor_usage_school_student_date' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TutorUsages');
    await queryInterface.dropTable('TutorProgresses');
    await queryInterface.dropTable('TutorMessages');
    await queryInterface.dropTable('TutorSessions');
  }
};
