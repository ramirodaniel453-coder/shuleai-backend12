'use strict';

async function addColumnIfMissing(queryInterface, table, column, definition) {
  const desc = await queryInterface.describeTable(table).catch(() => null);
  if (desc && !desc[column]) await queryInterface.addColumn(table, column, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotFullAccessEnabled', { type: Sequelize.BOOLEAN, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotStartedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotEndsAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotEnabledBy', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialAccessEnabled', { type: Sequelize.BOOLEAN, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialStartedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialEndsAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmed', { type: Sequelize.BOOLEAN, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentAmount', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentReference', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmedBy', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionPlan', { type: Sequelize.STRING, defaultValue: 'free' });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionStatus', { type: Sequelize.STRING, defaultValue: 'inactive' });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionStartedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionEndsAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'accessMode', { type: Sequelize.STRING, defaultValue: 'default' });
    await addColumnIfMissing(queryInterface, 'Schools', 'accessStatus', { type: Sequelize.STRING, defaultValue: 'limited' });
    await addColumnIfMissing(queryInterface, 'Schools', 'schoolStructure', { type: Sequelize.STRING, defaultValue: 'mixed' });
    await addColumnIfMissing(queryInterface, 'Schools', 'enabledLevels', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'Schools', 'curriculumVersion', { type: Sequelize.STRING });

    await addColumnIfMissing(queryInterface, 'Classes', 'curriculum', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Classes', 'levelCode', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Classes', 'levelLabel', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Classes', 'curriculumLevel', { type: Sequelize.STRING });

    await addColumnIfMissing(queryInterface, 'TeacherSubjectAssignments', 'schoolSubjectId', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'TeacherSubjectAssignments', 'curriculum', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'TeacherSubjectAssignments', 'levelCode', { type: Sequelize.STRING });

    await queryInterface.createTable('SchoolPaymentRequests', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      submittedBy: { type: Sequelize.INTEGER, allowNull: true },
      amount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING, defaultValue: 'KES' },
      method: { type: Sequelize.STRING, defaultValue: 'mpesa' },
      reference: { type: Sequelize.STRING },
      paidAt: { type: Sequelize.DATE },
      notes: { type: Sequelize.TEXT },
      proofUrl: { type: Sequelize.TEXT },
      requestedPlan: { type: Sequelize.STRING, defaultValue: 'growth' },
      status: { type: Sequelize.STRING, defaultValue: 'pending' },
      reviewedBy: { type: Sequelize.INTEGER },
      reviewedAt: { type: Sequelize.DATE },
      reviewNotes: { type: Sequelize.TEXT },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });
    await queryInterface.addIndex('SchoolPaymentRequests', ['schoolCode', 'status'], { name: 'school_payment_requests_school_status_idx' }).catch(() => null);

    await queryInterface.createTable('StudentSubjectSelections', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false },
      classId: { type: Sequelize.INTEGER },
      subjectId: { type: Sequelize.STRING },
      subjectName: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, defaultValue: 'taking' },
      pathway: { type: Sequelize.STRING },
      track: { type: Sequelize.STRING },
      isCompulsory: { type: Sequelize.BOOLEAN, defaultValue: false },
      isElective: { type: Sequelize.BOOLEAN, defaultValue: true },
      requestedBy: { type: Sequelize.INTEGER },
      approvedBy: { type: Sequelize.INTEGER },
      approvedAt: { type: Sequelize.DATE },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });
    await queryInterface.addIndex('StudentSubjectSelections', ['schoolCode', 'studentId', 'classId'], { name: 'student_subject_selections_scope_idx' }).catch(() => null);

    await queryInterface.createTable('PlatformAuditEvents', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING },
      actorUserId: { type: Sequelize.INTEGER },
      actorRole: { type: Sequelize.STRING },
      module: { type: Sequelize.STRING },
      action: { type: Sequelize.STRING },
      entityType: { type: Sequelize.STRING },
      entityId: { type: Sequelize.STRING },
      before: { type: Sequelize.JSONB, defaultValue: {} },
      after: { type: Sequelize.JSONB, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });
  },

  async down() {
    throw new Error('Irreversible migration 20260531000000-v102-access-curriculum-structure-engine.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
