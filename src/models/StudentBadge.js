module.exports = (sequelize, DataTypes) => {
  const StudentBadge = sequelize.define('StudentBadge', {
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    badgeId: { type: DataTypes.INTEGER, allowNull: false },
    awardedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { timestamps: true });
  return StudentBadge;
};
