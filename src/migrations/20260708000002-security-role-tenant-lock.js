'use strict';

async function tableExists(queryInterface, tableName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :table LIMIT 1`,
    { replacements: { table: tableName } }
  );
  return rows.length > 0;
}

async function columnExists(queryInterface, tableName, columnName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :table AND column_name = :column LIMIT 1`,
    { replacements: { table: tableName, column: columnName } }
  );
  return rows.length > 0;
}

async function addIndexIfPossible(queryInterface, table, fields, options) {
  try {
    if (!(await tableExists(queryInterface, table))) return;
    for (const field of fields) {
      if (!(await columnExists(queryInterface, table, field))) return;
    }
    await queryInterface.addIndex(table, fields, options);
  } catch (error) {
    if (!String(error.message || '').includes('already exists')) throw error;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'Students')) {
      if (!(await columnExists(queryInterface, 'Students', 'schoolCode'))) {
        await queryInterface.addColumn('Students', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
      }
      if (await tableExists(queryInterface, 'Users')) {
        await queryInterface.sequelize.query(`
          UPDATE "Students" s
          SET "schoolCode" = u."schoolCode"
          FROM "Users" u
          WHERE s."userId" = u."id"
            AND (s."schoolCode" IS NULL OR s."schoolCode" = '')
            AND u."schoolCode" IS NOT NULL
        `);
      }
      await addIndexIfPossible(queryInterface, 'Students', ['schoolCode', 'id'], { name: 'idx_students_school_code_id' });
      await addIndexIfPossible(queryInterface, 'Students', ['schoolCode', 'classId'], { name: 'idx_students_school_code_class_id' });
      await addIndexIfPossible(queryInterface, 'Students', ['schoolCode', 'status'], { name: 'idx_students_school_code_status' });
    }

    if (await tableExists(queryInterface, 'Users') && await columnExists(queryInterface, 'Users', 'preferences')) {
      await queryInterface.sequelize.query(`
        UPDATE "Users"
        SET "preferences" = COALESCE("preferences", '{}'::jsonb)
          - 'role' - 'roles' - 'effectiveRole' - 'primaryRole' - 'permissions'
          - 'isSuperAdmin' - 'isAdmin' - 'schoolCode' - 'schoolId'
          - 'subscription' - 'plan' - 'features' - 'featureLocks'
      `);
      await queryInterface.sequelize.query(`
        UPDATE "Users"
        SET "preferences" = jsonb_set(
          COALESCE("preferences", '{}'::jsonb),
          '{additionalRoles}',
          CASE
            WHEN COALESCE("preferences", '{}'::jsonb) ? 'finance'
              AND COALESCE("preferences", '{}'::jsonb)->'finance' ? 'assignedBy'
              AND COALESCE("preferences", '{}'::jsonb)->'finance' ? 'assignedAt'
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(COALESCE("preferences"->'additionalRoles', '[]'::jsonb)) AS r(value)
                WHERE r.value = 'finance_officer'
              )
            THEN '["finance_officer"]'::jsonb
            ELSE '[]'::jsonb
          END,
          true
        )
        WHERE COALESCE("preferences", '{}'::jsonb) ? 'additionalRoles'
      `);
    }
  },

  async down(queryInterface) {
    throw new Error('Irreversible migration 20260708000002-security-role-tenant-lock.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
