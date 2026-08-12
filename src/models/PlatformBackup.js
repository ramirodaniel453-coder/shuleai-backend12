module.exports = (sequelize, DataTypes) => {
  return sequelize.define('PlatformBackup', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    status: { type: DataTypes.ENUM('queued','processing','completed','failed'), allowNull: false, defaultValue: 'queued' },
    requestedBy: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' } },
    jobId: { type: DataTypes.UUID, allowNull: true, references: { model: 'BackgroundJobs', key: 'id' } },
    filename: { type: DataTypes.STRING(255), allowNull: true },
    storageProvider: { type: DataTypes.STRING(40), allowNull: true },
    storageUrl: { type: DataTypes.TEXT, allowNull: true },
    checksum: { type: DataTypes.STRING(64), allowNull: true },
    byteSize: { type: DataTypes.BIGINT, allowNull: true },
    archiveVerifiedAt: { type: DataTypes.DATE, allowNull: true },
    restoreVerifiedAt: { type: DataTypes.DATE, allowNull: true },
    verificationDetails: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    failedAt: { type: DataTypes.DATE, allowNull: true },
    error: { type: DataTypes.TEXT, allowNull: true }
  }, { tableName: 'PlatformBackups', timestamps: true, indexes: [{ fields: ['status','createdAt'] }, { fields: ['requestedBy','createdAt'] }] });
};
