module.exports = (sequelize, DataTypes) => {
  return sequelize.define('PlatformSetting', {
    id: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false, defaultValue: 1, validate: { isIn: [[1]] } },
    platformName: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'ShuleAI' },
    defaultCurriculum: { type: DataTypes.ENUM('cbc','844','british','american'), allowNull: false, defaultValue: 'cbc' },
    nameChangeFee: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50, validate: { min: 0, max: 1000000 } },
    maintenanceMode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    allowNewRegistrations: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    contactEmail: { type: DataTypes.STRING(254), allowNull: false, defaultValue: 'support@shuleai.com', validate: { isEmail: true } },
    supportPhone: { type: DataTypes.STRING(40), allowNull: true },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' } }
  }, { tableName: 'PlatformSettings', timestamps: true });
};
