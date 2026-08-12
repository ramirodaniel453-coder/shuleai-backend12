module.exports = (sequelize, DataTypes) => {
  const AttendanceSession = sequelize.define('AttendanceSession', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    classId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'not_started' },
    startedBy: { type: DataTypes.INTEGER, allowNull: true },
    submittedBy: { type: DataTypes.INTEGER, allowNull: true },
    submittedAt: { type: DataTypes.DATE, allowNull: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Africa/Nairobi' },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['schoolCode', 'classId', 'date'] },
      { fields: ['schoolCode', 'date', 'status'] }
    ]
  });
  return AttendanceSession;
};
