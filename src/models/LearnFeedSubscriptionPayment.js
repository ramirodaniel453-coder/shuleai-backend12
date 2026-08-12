module.exports = (sequelize, DataTypes) => {
  const LearnFeedSubscriptionPayment = sequelize.define('LearnFeedSubscriptionPayment', {
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    learnFeedId: { type: DataTypes.STRING(40), allowNull: true, references: { model: 'LearnFeedUsers', key: 'learnFeedId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    legacyPaymentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onDelete: 'SET NULL' },
    planCode: { type: DataTypes.STRING(80), allowNull: false },
    planName: { type: DataTypes.STRING(120), allowNull: false },
    provider: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'daraja' },
    phone: { type: DataTypes.STRING(40), allowNull: true },
    amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'KES' },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'pending' },
    internalReference: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    providerReference: { type: DataTypes.STRING(120), allowNull: true },
    checkoutRequestId: { type: DataTypes.STRING(120), allowNull: true },
    checkoutUrl: { type: DataTypes.TEXT, allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { tableName: 'LearnFeedSubscriptionPayments', timestamps: true, indexes: [{ unique: true, fields: ['internalReference'] }, { fields: ['userId', 'status'] }, { fields: ['learnFeedId', 'status'] }, { fields: ['legacyPaymentId'] }, { fields: ['provider', 'providerReference'] }] });
  return LearnFeedSubscriptionPayment;
};
