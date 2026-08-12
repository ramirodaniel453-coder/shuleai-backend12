module.exports = (sequelize, DataTypes) => {
  const ReportShare = sequelize.define('ReportShare', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    reportSnapshotId: { type: DataTypes.INTEGER, allowNull: false },
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    recipientUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    channel: { type: DataTypes.STRING(30), allowNull: false },
    recipientAddress: { type: DataTypes.STRING, allowNull: true },
    tokenHash: { type: DataTypes.STRING, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'queued' },
    sentBy: { type: DataTypes.INTEGER, allowNull: false },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'studentId', 'createdAt'] },
      { fields: ['reportSnapshotId', 'status'] },
      { fields: ['tokenHash'] }
    ]
  });
  return ReportShare;
};
