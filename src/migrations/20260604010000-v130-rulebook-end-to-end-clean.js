'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('ALTER TABLE "Schools" ALTER COLUMN "system" TYPE VARCHAR(50)').catch(() => null);
    await queryInterface.addColumn('Schools', 'schoolStructure', { type: Sequelize.STRING, defaultValue:'mixed' }).catch(() => null);
    await queryInterface.addColumn('Schools', 'enabledLevels', { type: Sequelize.JSONB, defaultValue:[] }).catch(() => null);
    await queryInterface.addColumn('Classes', 'curriculum', { type: Sequelize.STRING }).catch(() => null);
    await queryInterface.addColumn('Classes', 'levelCode', { type: Sequelize.STRING }).catch(() => null);
    await queryInterface.addColumn('Classes', 'levelLabel', { type: Sequelize.STRING }).catch(() => null);
    await queryInterface.addColumn('Classes', 'curriculumLevel', { type: Sequelize.STRING }).catch(() => null);
    await queryInterface.addColumn('Classes', 'isActive', { type: Sequelize.BOOLEAN, defaultValue:true }).catch(() => null);
    await queryInterface.addColumn('Classes', 'settings', { type: Sequelize.JSONB, defaultValue:{} }).catch(() => null);
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "StudentSubjectSelections" ("id" SERIAL PRIMARY KEY,"schoolCode" VARCHAR(255) NOT NULL,"studentId" INTEGER NOT NULL,"classId" INTEGER,"subjectId" VARCHAR(255),"subjectName" VARCHAR(255) NOT NULL,"category" VARCHAR(255),"status" VARCHAR(50) DEFAULT 'taking',"pathway" VARCHAR(255),"track" VARCHAR(255),"isCore" BOOLEAN DEFAULT false,"countsInFinal" BOOLEAN DEFAULT true,"selectedBy" INTEGER,"verifiedBy" INTEGER,"verifiedAt" TIMESTAMP,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL DEFAULT NOW())`).catch(() => null);
    await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS "student_subject_selection_unique_v130" ON "StudentSubjectSelections" ("schoolCode","studentId",COALESCE("classId",0),LOWER("subjectName"))`).catch(() => null);
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "SmsOutbox" ("id" SERIAL PRIMARY KEY,"schoolCode" VARCHAR(255) NOT NULL,"senderUserId" INTEGER,"audience" VARCHAR(255),"message" TEXT NOT NULL,"recipientCount" INTEGER DEFAULT 0,"successCount" INTEGER DEFAULT 0,"failedCount" INTEGER DEFAULT 0,"tokensUsed" INTEGER DEFAULT 0,"mode" VARCHAR(50) DEFAULT 'manual',"status" VARCHAR(50) DEFAULT 'sent',"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL DEFAULT NOW())`).catch(() => null);
    for (const [col, type] of [['schoolCode','VARCHAR(255)'],['senderUserId','INTEGER'],['audience','VARCHAR(255)'],['recipientCount','INTEGER DEFAULT 0'],['successCount','INTEGER DEFAULT 0'],['failedCount','INTEGER DEFAULT 0'],['tokensUsed','INTEGER DEFAULT 0'],['mode','VARCHAR(50) DEFAULT \'manual\''],['status','VARCHAR(50) DEFAULT \'sent\'']]) {
      await queryInterface.sequelize.query(`ALTER TABLE "SmsOutbox" ADD COLUMN IF NOT EXISTS "${col}" ${type}`).catch(() => null);
    }
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "PlatformAuditEvents" ("id" SERIAL PRIMARY KEY,"schoolCode" VARCHAR(255),"actorUserId" INTEGER,"eventType" VARCHAR(255) NOT NULL,"payload" JSONB DEFAULT '{}'::jsonb,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL DEFAULT NOW())`).catch(() => null);
    await queryInterface.sequelize.query(`CREATE TABLE IF NOT EXISTS "SchoolPaymentRequests" ("id" SERIAL PRIMARY KEY,"schoolCode" VARCHAR(255) NOT NULL,"submittedBy" INTEGER,"amount" INTEGER DEFAULT 0,"method" VARCHAR(50),"reference" VARCHAR(255),"paidAt" TIMESTAMP,"notes" TEXT,"proofUrl" TEXT,"requestedPlan" VARCHAR(50) DEFAULT 'growth',"status" VARCHAR(50) DEFAULT 'pending',"reviewedBy" INTEGER,"reviewedAt" TIMESTAMP,"createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),"updatedAt" TIMESTAMP NOT NULL DEFAULT NOW())`).catch(() => null);
  },
  async down() {
    throw new Error('Irreversible migration 20260604010000-v130-rulebook-end-to-end-clean.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
