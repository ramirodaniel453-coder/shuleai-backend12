module.exports = (sequelize, DataTypes) => {
  const HomeTaskAssignment = sequelize.define('HomeTaskAssignment', {
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    taskId: { type: DataTypes.INTEGER, allowNull: false },
    assignedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    status: { type: DataTypes.STRING(20), defaultValue: 'pending' },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    parentFeedback: { type: DataTypes.JSONB, defaultValue: {} },
    studentFeedback: { type: DataTypes.JSONB, defaultValue: {} },
    pointsEarned: { type: DataTypes.INTEGER, allowNull: true },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' }
  }, { timestamps: true });
  return HomeTaskAssignment;
};
