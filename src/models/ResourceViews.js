module.exports = (sequelize, DataTypes) => {
  const ResourceViews = sequelize.define('ResourceViews', {
    resourceId: { type: DataTypes.INTEGER, allowNull: false },
    resourceType: { type: DataTypes.STRING(50), allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    viewedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { timestamps: false });
  return ResourceViews;
};
