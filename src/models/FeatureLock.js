module.exports = (sequelize, DataTypes) => {
  const FeatureLock = sequelize.define('FeatureLock', {
    featureKey: { type: DataTypes.STRING, allowNull: false, unique: true },
    featureName: { type: DataTypes.STRING, allowNull: false },
    ownerType: { type: DataTypes.ENUM('school', 'child', 'both'), defaultValue: 'both' },
    requiredPlans: { type: DataTypes.JSONB, defaultValue: [] },
    gracefulFallback: { type: DataTypes.BOOLEAN, defaultValue: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, { timestamps: true });
  return FeatureLock;
};
