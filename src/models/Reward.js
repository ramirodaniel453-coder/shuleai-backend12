module.exports = (sequelize, DataTypes) => {
  const Reward = sequelize.define('Reward', {
    name: { type: DataTypes.STRING, allowNull: false },
    description: DataTypes.TEXT,
    pointsCost: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, defaultValue: -1 },
    schoolId: { type: DataTypes.STRING, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { timestamps: true });
  return Reward;
};
