module.exports = (sequelize, DataTypes) => {
  const PaymentReconciliation = sequelize.define('PaymentReconciliation', {
    paymentTransactionId: { type: DataTypes.INTEGER, allowNull: true },
    legacyPaymentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    provider: { type: DataTypes.STRING, allowNull: false },
    internalReference: { type: DataTypes.STRING, allowNull: true },
    providerReference: { type: DataTypes.STRING, allowNull: true },
    statusBefore: { type: DataTypes.STRING, allowNull: true },
    statusAfter: { type: DataTypes.STRING, allowNull: true },
    result: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
    message: { type: DataTypes.TEXT, allowNull: true },
    checkedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    rawResponse: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { timestamps: true, indexes: [{ fields: ['internalReference'] }, { fields: ['schoolCode', 'result'] }] });
  return PaymentReconciliation;
};
