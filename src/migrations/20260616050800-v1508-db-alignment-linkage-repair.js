module.exports = {
  async up(queryInterface, Sequelize) {
    const q = queryInterface.sequelize;
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "relationship" VARCHAR(80) DEFAULT 'guardian'`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "linkedByElimuId" BOOLEAN DEFAULT false`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "linkedAt" TIMESTAMP WITH TIME ZONE`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "status" VARCHAR(30) DEFAULT 'active'`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50) DEFAULT 'manual'`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP WITH TIME ZONE`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "verifiedBy" INTEGER`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}'::jsonb`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()`).catch(() => null);
    await q.query(`UPDATE "StudentParents" SET "relationship" = COALESCE("relationship", 'guardian'), "status" = COALESCE("status", 'active')`).catch(() => null);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_studentparents_status_lookup_v1508" ON "StudentParents" ("studentId", "parentId", "status")`).catch(() => null);

    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ALTER COLUMN "assessmentType" TYPE VARCHAR(80) USING "assessmentType"::text`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "assessmentKey" VARCHAR(120)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "assessmentCategory" VARCHAR(80)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "maxScore" DECIMAL(8,2)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "assessmentWeight" DECIMAL(8,2)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "showOnReport" BOOLEAN DEFAULT true`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "countInFinal" BOOLEAN DEFAULT true`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER DEFAULT 0`).catch(() => null);
    await q.query(`UPDATE "AcademicRecords" SET "assessmentKey" = COALESCE("assessmentKey", lower(regexp_replace(COALESCE("assessmentName", "assessmentType", 'assessment'), '[^a-zA-Z0-9]+', '_', 'g'))), "assessmentCategory" = COALESCE("assessmentCategory", "assessmentType"::text)`).catch(() => null);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_academic_records_assessment_key_v1508" ON "AcademicRecords" ("schoolCode", "studentId", "term", "year", "assessmentKey")`).catch(() => null);
  },
  async down() {
    throw new Error('Irreversible migration 20260616050800-v1508-db-alignment-linkage-repair.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
