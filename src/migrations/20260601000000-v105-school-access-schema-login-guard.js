'use strict';

async function addColumnIfMissing(queryInterface, table, column, definition) {
  const described = await queryInterface.describeTable(table).catch(() => null);
  if (!described || described[column]) return;
  await queryInterface.addColumn(table, column, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotFullAccessEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotStartedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotEndsAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotEnabledBy', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialAccessEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialStartedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialEndsAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmed', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentAmount', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentReference', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmedBy', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionPlan', { type: Sequelize.STRING, allowNull: false, defaultValue: 'free' });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionStatus', { type: Sequelize.STRING, allowNull: false, defaultValue: 'inactive' });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionStartedAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionEndsAt', { type: Sequelize.DATE });
    await addColumnIfMissing(queryInterface, 'Schools', 'accessMode', { type: Sequelize.STRING, allowNull: false, defaultValue: 'default' });
    await addColumnIfMissing(queryInterface, 'Schools', 'accessStatus', { type: Sequelize.STRING, allowNull: false, defaultValue: 'limited' });
    await addColumnIfMissing(queryInterface, 'Schools', 'schoolStructure', { type: Sequelize.STRING, allowNull: false, defaultValue: 'mixed' });
    await addColumnIfMissing(queryInterface, 'Schools', 'enabledLevels', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'Schools', 'curriculumVersion', { type: Sequelize.STRING });

    await addColumnIfMissing(queryInterface, 'Classes', 'curriculum', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Classes', 'levelCode', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Classes', 'levelLabel', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Classes', 'curriculumLevel', { type: Sequelize.STRING });

    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "SchoolPaymentRequests" (
      "id" SERIAL PRIMARY KEY,
      "schoolCode" VARCHAR(255) NOT NULL,
      "submittedBy" INTEGER,
      "amount" INTEGER DEFAULT 0,
      "currency" VARCHAR(255) DEFAULT 'KES',
      "method" VARCHAR(255) DEFAULT 'mpesa',
      "reference" VARCHAR(255),
      "paidAt" TIMESTAMP WITH TIME ZONE,
      "notes" TEXT,
      "proofUrl" TEXT,
      "requestedPlan" VARCHAR(255) DEFAULT 'growth',
      "status" VARCHAR(255) DEFAULT 'pending',
      "reviewedBy" INTEGER,
      "reviewedAt" TIMESTAMP WITH TIME ZONE,
      "reviewNotes" TEXT,
      "metadata" JSONB DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "StudentSubjectSelections" (
      "id" SERIAL PRIMARY KEY,
      "schoolCode" VARCHAR(255) NOT NULL,
      "studentId" INTEGER NOT NULL,
      "classId" INTEGER,
      "subjectId" VARCHAR(255),
      "subjectName" VARCHAR(255) NOT NULL,
      "status" VARCHAR(255) DEFAULT 'taking',
      "pathway" VARCHAR(255),
      "track" VARCHAR(255),
      "isCompulsory" BOOLEAN DEFAULT FALSE,
      "isElective" BOOLEAN DEFAULT TRUE,
      "requestedBy" INTEGER,
      "approvedBy" INTEGER,
      "approvedAt" TIMESTAMP WITH TIME ZONE,
      "metadata" JSONB DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "PlatformAuditEvents" (
      "id" SERIAL PRIMARY KEY,
      "schoolCode" VARCHAR(255),
      "actorUserId" INTEGER,
      "actorRole" VARCHAR(255),
      "module" VARCHAR(255),
      "action" VARCHAR(255),
      "entityType" VARCHAR(255),
      "entityId" VARCHAR(255),
      "before" JSONB DEFAULT '{}'::jsonb,
      "after" JSONB DEFAULT '{}'::jsonb,
      "metadata" JSONB DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_school_payment_requests_school_status" ON "SchoolPaymentRequests" ("schoolCode", "status")');
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_student_subject_selections_school_student" ON "StudentSubjectSelections" ("schoolCode", "studentId")');
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_platform_audit_school_created" ON "PlatformAuditEvents" ("schoolCode", "createdAt")');
  },

  async down() {
    throw new Error('Irreversible migration 20260601000000-v105-school-access-schema-login-guard.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
