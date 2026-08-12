module.exports = (sequelize, DataTypes) => {
  const StudentReward = sequelize.define('StudentReward', {
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    rewardId: { type: DataTypes.INTEGER, allowNull: false },
    pointsSpent: { type: DataTypes.INTEGER, allowNull: false },
    redeemedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { timestamps: true });
  return StudentReward;
};
