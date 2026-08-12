module.exports = (sequelize, DataTypes) => {
  const StudentEnrollment = sequelize.define('StudentEnrollment', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    classId: { type: DataTypes.INTEGER, allowNull: true },
    stream: { type: DataTypes.STRING, allowNull: true },
    academicYear: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'active' },
    effectiveFrom: { type: DataTypes.DATEONLY, allowNull: false },
    effectiveTo: { type: DataTypes.DATEONLY, allowNull: true },
    startTerm: { type: DataTypes.STRING(20), allowNull: true },
    endTerm: { type: DataTypes.STRING(20), allowNull: true },
    movementType: { type: DataTypes.STRING(40), allowNull: true },
    movementReason: { type: DataTypes.STRING(120), allowNull: true },
    movementRequestId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'ClassTransferRequests', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    previousEnrollmentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'StudentEnrollments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    classTeacherIdAtStart: { type: DataTypes.INTEGER, allowNull: true },
    classTeacherIdAtEnd: { type: DataTypes.INTEGER, allowNull: true },
    endedReason: { type: DataTypes.STRING(80), allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    closedBy: { type: DataTypes.INTEGER, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'studentId', 'academicYear'] },
      { fields: ['schoolCode', 'classId', 'status'] }
    ]
  });
  return StudentEnrollment;
};
