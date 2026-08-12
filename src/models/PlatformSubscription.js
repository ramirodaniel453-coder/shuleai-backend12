module.exports = (sequelize, DataTypes) => {
  const PlatformSubscription = sequelize.define('PlatformSubscription', {
    schoolId: { type: DataTypes.INTEGER, allowNull: true },
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    planCode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'basic' },
    planName: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Basic' },
    billingCycle: { type: DataTypes.STRING, allowNull: false, defaultValue: 'monthly' },
    amount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'KES' },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
    startsAt: { type: DataTypes.DATE, allowNull: true },
    endsAt: { type: DataTypes.DATE, allowNull: true },
    lastPaymentTransactionId: { type: DataTypes.INTEGER, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { timestamps: true, indexes: [{ fields: ['schoolCode', 'status'] }] });
  return PlatformSubscription;
};
