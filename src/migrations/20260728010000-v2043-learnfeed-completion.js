'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('LearnFeedWalletTransactions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      counterpartyUserId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'SET NULL' },
      type: { type: Sequelize.STRING(40), allowNull: false },
      direction: { type: Sequelize.ENUM('credit', 'debit'), allowNull: false },
      amountCents: { type: Sequelize.INTEGER, allowNull: false },
      balanceAfterCents: { type: Sequelize.INTEGER, allowNull: false },
      currency: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'KES' },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'completed' },
      reference: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });
    await queryInterface.addIndex('LearnFeedWalletTransactions', ['userId', 'createdAt'], { name: 'learnfeed_wallet_user_created_idx' });
    await queryInterface.addIndex('LearnFeedWalletTransactions', ['status', 'createdAt'], { name: 'learnfeed_wallet_status_created_idx' });
    await queryInterface.addIndex('LearnFeedWalletTransactions', ['reference'], { name: 'learnfeed_wallet_reference_unique', unique: true });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('LearnFeedWalletTransactions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_LearnFeedWalletTransactions_direction"');
  }
};
