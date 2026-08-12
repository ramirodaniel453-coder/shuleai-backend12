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
    for (const field of fields) if (!(await columnExists(queryInterface, table, field))) return;
    await queryInterface.addIndex(table, fields, options);
  } catch (error) {
    if (!String(error.message || '').includes('already exists')) throw error;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'UserRoleAssignments'))) {
      await queryInterface.createTable('UserRoleAssignments', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
        userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        schoolCode: { type: Sequelize.STRING, allowNull: false },
        role: { type: Sequelize.ENUM('finance_officer'), allowNull: false },
        status: { type: Sequelize.ENUM('active', 'revoked'), allowNull: false, defaultValue: 'active' },
        assignedBy: { type: Sequelize.INTEGER, allowNull: true },
        assignedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        revokedBy: { type: Sequelize.INTEGER, allowNull: true },
        revokedAt: { type: Sequelize.DATE, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }

    await addIndexIfPossible(queryInterface, 'UserRoleAssignments', ['userId', 'schoolCode', 'role'], { unique: true, name: 'idx_user_role_assignments_unique' });
    await addIndexIfPossible(queryInterface, 'UserRoleAssignments', ['schoolCode', 'role', 'status'], { name: 'idx_user_role_assignments_school_role_status' });
    await addIndexIfPossible(queryInterface, 'UserRoleAssignments', ['userId', 'status'], { name: 'idx_user_role_assignments_user_status' });

    if (await tableExists(queryInterface, 'Users') && await columnExists(queryInterface, 'Users', 'preferences')) {
      await queryInterface.sequelize.query(`
        UPDATE "Users"
        SET "preferences" = COALESCE("preferences", '{}'::jsonb)
          - 'role' - 'roles' - 'effectiveRole' - 'primaryRole' - 'additionalRoles' - 'permissions'
          - 'isSuperAdmin' - 'isAdmin' - 'schoolCode' - 'schoolId'
          - 'subscription' - 'plan' - 'features' - 'featureLocks'
      `);
    }
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'UserRoleAssignments')) {
      await queryInterface.dropTable('UserRoleAssignments');
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_UserRoleAssignments_role";').catch(() => null);
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_UserRoleAssignments_status";').catch(() => null);
  }
};
