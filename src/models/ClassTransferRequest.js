module.exports = (sequelize, DataTypes) => {
  const ClassTransferRequest = sequelize.define('ClassTransferRequest', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    requestedBy: { type: DataTypes.INTEGER, allowNull: false },
    requestedByRole: { type: DataTypes.STRING(30), allowNull: false },
    fromEnrollmentId: { type: DataTypes.INTEGER, allowNull: true },
    fromClassId: { type: DataTypes.INTEGER, allowNull: false },
    toClassId: { type: DataTypes.INTEGER, allowNull: false },
    academicYear: { type: DataTypes.INTEGER, allowNull: false },
    term: { type: DataTypes.STRING(20), allowNull: false },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: false },
    reason: { type: DataTypes.STRING(120), allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true },
    feeAction: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'keep_current_period' },
    feePreview: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    impactPreview: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pending' },
    approvedBy: { type: DataTypes.INTEGER, allowNull: true },
    approvedAt: { type: DataTypes.DATE, allowNull: true },
    rejectedBy: { type: DataTypes.INTEGER, allowNull: true },
    rejectedAt: { type: DataTypes.DATE, allowNull: true },
    rejectionReason: { type: DataTypes.TEXT, allowNull: true },
    appliedBy: { type: DataTypes.INTEGER, allowNull: true },
    appliedAt: { type: DataTypes.DATE, allowNull: true },
    appliedEnrollmentId: { type: DataTypes.INTEGER, allowNull: true },
    rollbackBy: { type: DataTypes.INTEGER, allowNull: true },
    rollbackAt: { type: DataTypes.DATE, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'status', 'effectiveDate'] },
      { fields: ['schoolCode', 'studentId', 'createdAt'] },
      { fields: ['schoolCode', 'fromClassId', 'status'] },
      { fields: ['schoolCode', 'toClassId', 'status'] }
    ]
  });
  return ClassTransferRequest;
};
