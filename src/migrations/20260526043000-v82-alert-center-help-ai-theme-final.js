module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Alerts').catch(() => null);
    if (!table) return;
    const add = async (name, spec) => {
      if (!table[name]) {
        try { await queryInterface.addColumn('Alerts', name, spec); }
        catch (e) { console.warn(`[migration-safe] Alerts.${name}: ${e.message}`); }
      }
    };
    await queryInterface.sequelize.query(`ALTER TYPE "enum_Alerts_role" ADD VALUE IF NOT EXISTS 'super_admin';`).catch(() => {});
    await add('categoryLabel', { type: Sequelize.STRING, allowNull: true });
    await add('sourceType', { type: Sequelize.STRING, allowNull: true });
    await add('sourceLabel', { type: Sequelize.STRING, allowNull: true });
    await add('targetRole', { type: Sequelize.STRING, allowNull: true });
    await add('targetUserId', { type: Sequelize.INTEGER, allowNull: true });
    await add('studentId', { type: Sequelize.INTEGER, allowNull: true });
    await add('classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('priority', { type: Sequelize.STRING, allowNull: true });
    await add('dedupeKey', { type: Sequelize.STRING(520), allowNull: true });
    await add('actionLabel', { type: Sequelize.STRING, allowNull: true });
    await add('readAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addIndex('Alerts', ['userId', 'dedupeKey'], { unique: true, name: 'alerts_user_dedupe_unique' }).catch(e => console.warn('[migration-safe] duplicate index on Alerts user/dedupe; continuing'));
    await queryInterface.addIndex('Alerts', ['userId', 'createdAt'], { name: 'alerts_user_created_idx' }).catch(() => {});
  },
  async down() {
    throw new Error('Irreversible migration 20260526043000-v82-alert-center-help-ai-theme-final.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
