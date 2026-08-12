module.exports = (sequelize, DataTypes) => {
  const MediaAsset = sequelize.define('MediaAsset', {
    token: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    ownerUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    kind: { type: DataTypes.STRING(40), allowNull: false },
    mimeType: { type: DataTypes.STRING(120), allowNull: false },
    originalName: { type: DataTypes.STRING(255), allowNull: true },
    byteSize: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    checksum: { type: DataTypes.STRING(64), allowNull: false },
    data: { type: DataTypes.BLOB('long'), allowNull: true },
    storageProvider: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'database' },
    externalUrl: { type: DataTypes.TEXT, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'MediaAssets',
    indexes: [
      { unique: true, fields: ['token'] },
      { fields: ['schoolCode', 'kind'] },
      { fields: ['ownerUserId', 'kind', 'isActive'] },
      { fields: ['storageProvider'] }
    ]
  });
  return MediaAsset;
};
