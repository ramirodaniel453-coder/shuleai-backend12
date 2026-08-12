module.exports = (sequelize, DataTypes) => {
  const ClassRelease = sequelize.define('ClassRelease', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    classId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    updateNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    releaseType: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'normal' },
    message: { type: DataTypes.TEXT, allowNull: false },
    channel: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'platform' },
    releasedBy: { type: DataTypes.INTEGER, allowNull: false },
    releasedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    parentTargetCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    successCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    failedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['schoolCode', 'classId', 'date', 'updateNumber'] },
      { fields: ['schoolCode', 'date'] }
    ]
  });
  return ClassRelease;
};
