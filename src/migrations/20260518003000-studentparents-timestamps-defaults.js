'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE "StudentParents" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    await queryInterface.sequelize.query(`ALTER TABLE "StudentParents" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    await queryInterface.sequelize.query(`UPDATE "StudentParents" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;`);
    await queryInterface.sequelize.query(`UPDATE "StudentParents" SET "updatedAt" = COALESCE("updatedAt", "createdAt", NOW()) WHERE "updatedAt" IS NULL;`);
  },

  async down() {
    throw new Error('Irreversible migration 20260518003000-studentparents-timestamps-defaults.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
