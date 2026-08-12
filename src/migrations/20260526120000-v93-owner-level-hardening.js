'use strict';

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql).catch((err) => {
      console.warn('[v93-owner-hardening migration-safe]', err.message);
    });

    await q(`ALTER TABLE IF EXISTS "Schools" ADD COLUMN IF NOT EXISTS "ownerHardening" JSONB NOT NULL DEFAULT '{}'::jsonb;`);
    await q(`ALTER TABLE IF EXISTS "Users" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE;`);
    await q(`ALTER TABLE IF EXISTS "Users" ADD COLUMN IF NOT EXISTS "passwordIssuedAt" TIMESTAMP WITH TIME ZONE;`);
    await q(`ALTER TABLE IF EXISTS "Payments" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(255);`);
    await q(`ALTER TABLE IF EXISTS "Payments" ADD COLUMN IF NOT EXISTS "reconciliationStatus" VARCHAR(40) DEFAULT 'pending';`);
    await q(`ALTER TABLE IF EXISTS "Payments" ADD COLUMN IF NOT EXISTS "reconciliationNotes" TEXT;`);
    await q(`ALTER TABLE IF EXISTS "Payments" ADD COLUMN IF NOT EXISTS "lastStatusQueryAt" TIMESTAMP WITH TIME ZONE;`);
    await q(`ALTER TABLE IF EXISTS "Alerts" ADD COLUMN IF NOT EXISTS "dedupeKey" VARCHAR(255);`);
    await q(`ALTER TABLE IF EXISTS "Alerts" ADD COLUMN IF NOT EXISTS "categoryLabel" VARCHAR(80);`);
    await q(`ALTER TABLE IF EXISTS "Alerts" ADD COLUMN IF NOT EXISTS "sourceLabel" VARCHAR(80);`);

    await q(`
      CREATE TABLE IF NOT EXISTS "StudentCareerInterests" (
        "id" SERIAL PRIMARY KEY,
        "schoolCode" VARCHAR(255) NOT NULL,
        "studentId" INTEGER NOT NULL REFERENCES "Students"("id") ON DELETE CASCADE,
        "careerName" VARCHAR(160) NOT NULL,
        "careerCategory" VARCHAR(120),
        "interestLevel" VARCHAR(40) DEFAULT 'interested',
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "selectedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS "student_career_active_unique" ON "StudentCareerInterests" ("studentId", LOWER("careerName")) WHERE "isActive" = TRUE;`);
    await q(`CREATE INDEX IF NOT EXISTS "student_career_school_idx" ON "StudentCareerInterests" ("schoolCode", "careerName");`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_unique" ON "Payments" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS "alerts_dedupe_unique" ON "Alerts" ("dedupeKey") WHERE "dedupeKey" IS NOT NULL;`);
  },
  async down() {
    throw new Error('Irreversible migration 20260526120000-v93-owner-level-hardening.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
