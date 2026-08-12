module.exports = (sequelize, DataTypes) => {
  const BackgroundJob = sequelize.define('BackgroundJob', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    type: { type: DataTypes.STRING(80), allowNull: false },
    status: { type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed', 'cancelled'), allowNull: false, defaultValue: 'queued' },
    schoolCode: { type: DataTypes.STRING, allowNull: true, references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' } },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    result: { type: DataTypes.JSONB, allowNull: true },
    progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    error: { type: DataTypes.TEXT, allowNull: true },
    logs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    lockedBy: { type: DataTypes.STRING(120), allowNull: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    failedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'BackgroundJobs',
    timestamps: true,
    indexes: [
      { fields: ['status', 'createdAt'] },
      { fields: ['schoolCode', 'createdAt'] },
      { fields: ['createdBy', 'createdAt'] }
    ]
  });
  return BackgroundJob;
};
