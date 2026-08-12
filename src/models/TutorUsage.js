module.exports = (sequelize, DataTypes) => {
  const TutorUsage = sequelize.define('TutorUsage', {
    schoolId: { type: DataTypes.STRING, allowNull: false, index: true },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    subscriptionId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Subscriptions', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    planCode: { type: DataTypes.STRING, allowNull: true },
    usageDate: { type: DataTypes.DATEONLY, allowNull: false },
    usageMonth: { type: DataTypes.STRING, allowNull: true },
    totalQuestions: { type: DataTypes.INTEGER, defaultValue: 0 },
    monthlyQuestionsUsed: { type: DataTypes.INTEGER, defaultValue: 0 },
    dailyLimit: { type: DataTypes.INTEGER, allowNull: true },
    monthlyLimit: { type: DataTypes.INTEGER, allowNull: true },
    aiCalls: { type: DataTypes.INTEGER, defaultValue: 0 },
    provider: { type: DataTypes.STRING, allowNull: true },
    model: { type: DataTypes.STRING, allowNull: true },
    inputTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
    outputTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
    costEstimate: { type: DataTypes.DECIMAL(12, 6), defaultValue: 0 }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['schoolId', 'studentId', 'usageDate'] },
      { fields: ['schoolCode', 'studentId'] },
      { fields: ['usageMonth'] }
    ]
  });
  return TutorUsage;
};
