module.exports = (sequelize, DataTypes) => {
  const SubscriptionPlan = sequelize.define('SubscriptionPlan', {
    code: { type: DataTypes.STRING, allowNull: true, unique: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    displayName: { type: DataTypes.STRING(100), allowNull: true },
    ownerType: { type: DataTypes.ENUM('school', 'child'), defaultValue: 'child' },
    price_kes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    monthlyPriceKes: { type: DataTypes.INTEGER, allowNull: true },
    termlyPriceKes: { type: DataTypes.INTEGER, allowNull: true },
    yearlyPriceKes: { type: DataTypes.INTEGER, allowNull: true },
    setupFeeMinKes: { type: DataTypes.INTEGER, allowNull: true },
    setupFeeMaxKes: { type: DataTypes.INTEGER, allowNull: true },
    schoolId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' } },
    features: { type: DataTypes.JSONB, defaultValue: [] },
    lockedFeatures: { type: DataTypes.JSONB, defaultValue: [] },
    limits: { type: DataTypes.JSONB, defaultValue: {} },
    sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { timestamps: true });
  return SubscriptionPlan;
};
