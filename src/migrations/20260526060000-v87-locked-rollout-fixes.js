module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'career';`).catch(() => {});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'subscription';`).catch(() => {});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'message';`).catch(() => {});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'announcement';`).catch(() => {});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'wellness';`).catch(() => {});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'financial';`).catch(() => {});

    const tables = await sequelize.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`, { type: Sequelize.QueryTypes.SELECT }).catch(() => []);
    const has = new Set(tables.map(t => t.table_name));
    if (!has.has('StudentCareerInterests')) {
      await queryInterface.createTable('StudentCareerInterests', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        schoolCode: { type: Sequelize.STRING, allowNull: false },
        studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onDelete: 'CASCADE' },
        careerId: { type: Sequelize.STRING, allowNull: false },
        careerName: { type: Sequelize.STRING, allowNull: false },
        interestLevel: { type: Sequelize.STRING, allowNull: false, defaultValue: 'interested' },
        isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        selectedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
      });
    }
    await queryInterface.addIndex('StudentCareerInterests', ['schoolCode', 'studentId', 'careerId'], { unique: true, name: 'student_career_interest_unique' }).catch(() => {});
    await queryInterface.addIndex('StudentCareerInterests', ['schoolCode', 'studentId', 'isActive'], { name: 'student_career_interest_active_idx' }).catch(() => {});
  },
  async down(queryInterface) {
    await queryInterface.dropTable('StudentCareerInterests').catch(() => {});
  }
};
