module.exports = (sequelize, DataTypes) => {
  const SubscriptionPayment = sequelize.define('SubscriptionPayment', {
    subscriptionId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Subscriptions', key: 'id' } },
    ownerType: { type: DataTypes.ENUM('school', 'child'), allowNull: false },
    schoolId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' } },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    parentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Parents', key: 'id' } },
    studentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' } },
    planId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'SubscriptionPlans', key: 'id' } },
    planCode: { type: DataTypes.STRING, allowNull: false },
    planName: { type: DataTypes.STRING, allowNull: false },
    billingCycle: { type: DataTypes.ENUM('monthly', 'termly', 'yearly', 'custom'), defaultValue: 'monthly' },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, defaultValue: 'KES' },
    paymentMethod: { type: DataTypes.ENUM('mpesa', 'bank', 'card', 'manual'), defaultValue: 'mpesa' },
    checkoutRequestId: { type: DataTypes.STRING, allowNull: true },
    merchantRequestId: { type: DataTypes.STRING, allowNull: true },
    mpesaReceiptNumber: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'success', 'failed', 'cancelled', 'expired'), defaultValue: 'pending' },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    rawCallback: { type: DataTypes.JSONB, defaultValue: {} },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
    auditTrail: { type: DataTypes.JSONB, defaultValue: [] }
  }, { timestamps: true, indexes: [{ fields: ['checkoutRequestId'] }, { fields: ['ownerType'] }, { fields: ['studentId'] }, { fields: ['schoolCode'] }] });
  return SubscriptionPayment;
};
