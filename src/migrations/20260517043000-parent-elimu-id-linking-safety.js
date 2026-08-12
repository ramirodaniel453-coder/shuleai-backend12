'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "StudentParents" (
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "studentId" INTEGER NOT NULL REFERENCES "Students"("id") ON DELETE CASCADE,
        "parentId" INTEGER NOT NULL REFERENCES "Parents"("id") ON DELETE CASCADE,
        "relationship" VARCHAR(40) DEFAULT 'guardian',
        "linkedByElimuId" BOOLEAN NOT NULL DEFAULT TRUE,
        "linkedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("studentId", "parentId")
      );
    `);

    await queryInterface.sequelize.query(`ALTER TABLE "StudentParents" ADD COLUMN IF NOT EXISTS "relationship" VARCHAR(40) DEFAULT 'guardian';`);
    await queryInterface.sequelize.query(`ALTER TABLE "StudentParents" ADD COLUMN IF NOT EXISTS "linkedByElimuId" BOOLEAN NOT NULL DEFAULT TRUE;`);
    await queryInterface.sequelize.query(`ALTER TABLE "StudentParents" ADD COLUMN IF NOT EXISTS "linkedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    await queryInterface.sequelize.query(`ALTER TABLE "StudentParents" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);
    await queryInterface.sequelize.query(`ALTER TABLE "StudentParents" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();`);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "studentparents_student_parent_unique"
      ON "StudentParents" ("studentId", "parentId");
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "studentparents_parent_lookup_idx"
      ON "StudentParents" ("parentId");
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "studentparents_student_lookup_idx"
      ON "StudentParents" ("studentId");
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "studentparents_student_parent_unique";`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "studentparents_parent_lookup_idx";`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "studentparents_student_lookup_idx";`);
  }
};
