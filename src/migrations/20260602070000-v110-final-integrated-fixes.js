'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE IF EXISTS "SchoolCalendars" ADD COLUMN IF NOT EXISTS "classId" INTEGER').catch(() => null);
    await queryInterface.sequelize.query('ALTER TABLE IF EXISTS "SchoolCalendars" ADD COLUMN IF NOT EXISTS "createdByUserId" INTEGER').catch(() => null);
    await queryInterface.sequelize.query(`ALTER TABLE IF EXISTS "SchoolCalendars" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}'::jsonb`).catch(() => null);
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_school_calendars_owner" ON "SchoolCalendars" ("schoolId", "createdByUserId")').catch(() => null);
    await queryInterface.sequelize.query(`ALTER TABLE IF EXISTS "StudentSubjectSelections" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}'::jsonb`).catch(() => null);
    await queryInterface.sequelize.query('ALTER TABLE IF EXISTS "StudentSubjectSelections" ADD COLUMN IF NOT EXISTS "requestedBy" INTEGER').catch(() => null);
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS "idx_student_subject_selection_status" ON "StudentSubjectSelections" ("schoolCode", "status")').catch(() => null);
  },
  async down() {
    throw new Error('Irreversible migration 20260602070000-v110-final-integrated-fixes.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
