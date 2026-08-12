module.exports = (sequelize, DataTypes) => {
  const LearnFeedWalletTransaction = sequelize.define('LearnFeedWalletTransaction', {
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    counterpartyUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'SET NULL' },
    type: { type: DataTypes.STRING(40), allowNull: false },
    direction: { type: DataTypes.ENUM('credit', 'debit'), allowNull: false },
    amountCents: { type: DataTypes.INTEGER, allowNull: false },
    balanceAfterCents: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'KES' },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'completed' },
    reference: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'LearnFeedWalletTransactions',
    timestamps: true,
    indexes: [{ fields: ['userId', 'createdAt'] }, { fields: ['status', 'createdAt'] }, { unique: true, fields: ['reference'] }]
  });
  return LearnFeedWalletTransaction;
};
