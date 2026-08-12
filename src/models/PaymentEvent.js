module.exports = (sequelize, DataTypes) => {
  const PaymentEvent = sequelize.define('PaymentEvent', {
    paymentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' } },
    paymentTransactionId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'PaymentTransactions', key: 'id' } },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    provider: { type: DataTypes.STRING, allowNull: false },
    eventType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'webhook' },
    providerEventId: { type: DataTypes.STRING, allowNull: true },
    internalReference: { type: DataTypes.STRING, allowNull: true },
    providerReference: { type: DataTypes.STRING, allowNull: true },
    idempotencyKey: { type: DataTypes.STRING, allowNull: true },
    verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    verificationMethod: { type: DataTypes.STRING, allowNull: true },
    sourceIp: { type: DataTypes.STRING, allowNull: true },
    processed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    processingError: { type: DataTypes.TEXT, allowNull: true },
    rawPayload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['paymentId'] },
      { fields: ['schoolCode'] },
      { fields: ['provider'] },
      { fields: ['internalReference'] },
      { fields: ['provider', 'providerEventId'], unique: true, name: 'payment_events_provider_event_unique' }
    ]
  });
  return PaymentEvent;
};
