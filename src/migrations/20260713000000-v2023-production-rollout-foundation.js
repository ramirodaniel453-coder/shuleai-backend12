'use strict';

async function addColumnIfMissing(queryInterface, table, column, definition) {
  const desc = await queryInterface.describeTable(table).catch(() => null);
  if (!desc || desc[column]) return;
  await queryInterface.addColumn(table, column, definition).catch(error => {
    const msg = String(error?.message || '');
    if (!msg.includes('already exists')) throw error;
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'MediaAssets', 'storageProvider', { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'database' });
    await addColumnIfMissing(queryInterface, 'MediaAssets', 'externalUrl', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.changeColumn('MediaAssets', 'data', { type: Sequelize.BLOB('long'), allowNull: true }).catch(() => null);
    await queryInterface.addIndex('MediaAssets', ['storageProvider'], { name: 'idx_media_assets_storage_provider' }).catch(() => null);

    // Move access-schema runtime repairs into the migration pipeline so production does not ALTER schema on requests.
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotFullAccessEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotStartedAt', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotEndsAt', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'pilotEnabledBy', { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialAccessEnabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialStartedAt', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'trialEndsAt', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmed', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentAmount', { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentReference', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmedBy', { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'manualPaymentConfirmedAt', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionPlan', { type: Sequelize.STRING, allowNull: false, defaultValue: 'free' });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionStatus', { type: Sequelize.STRING, allowNull: false, defaultValue: 'inactive' });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionStartedAt', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'subscriptionEndsAt', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Schools', 'accessMode', { type: Sequelize.STRING, allowNull: false, defaultValue: 'default' });
    await addColumnIfMissing(queryInterface, 'Schools', 'accessStatus', { type: Sequelize.STRING, allowNull: false, defaultValue: 'limited' });
    await addColumnIfMissing(queryInterface, 'Schools', 'schoolStructure', { type: Sequelize.STRING, allowNull: false, defaultValue: 'mixed' });
    await addColumnIfMissing(queryInterface, 'Schools', 'enabledLevels', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'Schools', 'curriculumVersion', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Classes', 'curriculum', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Classes', 'levelCode', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Classes', 'levelLabel', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'Classes', 'curriculumLevel', { type: Sequelize.STRING, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('MediaAssets', 'idx_media_assets_storage_provider').catch(() => null);
    await queryInterface.removeColumn('MediaAssets', 'externalUrl').catch(() => null);
    await queryInterface.removeColumn('MediaAssets', 'storageProvider').catch(() => null);
  }
};
