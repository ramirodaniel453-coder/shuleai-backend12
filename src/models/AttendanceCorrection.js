module.exports = (sequelize, DataTypes) => {
  const AttendanceCorrection = sequelize.define('AttendanceCorrection', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    sessionId: { type: DataTypes.INTEGER, allowNull: false },
    attendanceId: { type: DataTypes.INTEGER, allowNull: false },
    studentId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    previousStatus: { type: DataTypes.STRING(30), allowNull: false },
    newStatus: { type: DataTypes.STRING(30), allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true },
    correctedBy: { type: DataTypes.INTEGER, allowNull: false },
    correctedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'sessionId'] },
      { fields: ['attendanceId', 'correctedAt'] }
    ]
  });
  return AttendanceCorrection;
};
