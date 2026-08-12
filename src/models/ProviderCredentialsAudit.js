module.exports = (sequelize, DataTypes) => {
  const ProviderCredentialsAudit = sequelize.define('ProviderCredentialsAudit', {
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    scope: { type: DataTypes.STRING, allowNull: false, defaultValue: 'school' },
    provider: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false },
    actorUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    changedFields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { timestamps: true, indexes: [{ fields: ['schoolCode', 'provider'] }] });
  return ProviderCredentialsAudit;
};
