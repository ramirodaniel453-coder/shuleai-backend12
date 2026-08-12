module.exports = (sequelize, DataTypes) => {
  const Attendance = sequelize.define('Attendance', {
    studentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Students', key: 'id' }
    },
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: false
    , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('present', 'absent', 'late', 'holiday', 'sick'),
      allowNull: false
    },
    reason: DataTypes.TEXT,
    reportedBy: DataTypes.INTEGER,
    reportedByParent: { type: DataTypes.BOOLEAN, defaultValue: false },
    timeIn: DataTypes.STRING,
    timeOut: DataTypes.STRING,
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    markedBy: { type: DataTypes.INTEGER, allowNull: true },
    editedBy: { type: DataTypes.INTEGER, allowNull: true },
    editReason: { type: DataTypes.TEXT, allowNull: true },
    auditTrail: { type: DataTypes.JSONB, defaultValue: [] },
    sessionId: { type: DataTypes.INTEGER, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    lockedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['schoolCode', 'studentId', 'date'] }
    ]
  });

  return Attendance;
};