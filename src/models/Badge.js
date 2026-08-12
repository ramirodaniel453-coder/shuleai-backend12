module.exports = (sequelize, DataTypes) => {
  const Badge = sequelize.define('Badge', {
    name: { type: DataTypes.STRING, allowNull: false },
    description: DataTypes.TEXT,
    icon: DataTypes.STRING,
    category: { type: DataTypes.ENUM('academic','attendance','behavior','extracurricular','other'), defaultValue: 'other' },
    requiredPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
    schoolId: { type: DataTypes.STRING, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { timestamps: true });
  return Badge;
};
