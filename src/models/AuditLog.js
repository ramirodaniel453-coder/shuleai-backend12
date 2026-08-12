module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    schoolCode: { type: DataTypes.STRING, allowNull: true, references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    actorUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    actorRole: { type: DataTypes.STRING, allowNull: true },
    module: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false },
    entityType: { type: DataTypes.STRING, allowNull: false },
    entityId: { type: DataTypes.STRING, allowNull: true },
    before: { type: DataTypes.JSONB, defaultValue: null },
    after: { type: DataTypes.JSONB, defaultValue: null },
    reason: { type: DataTypes.TEXT, allowNull: true },
    ipAddress: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.TEXT, allowNull: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'module'] },
      { fields: ['entityType', 'entityId'] },
      { fields: ['createdAt'] }
    ]
  });
  return AuditLog;
};
