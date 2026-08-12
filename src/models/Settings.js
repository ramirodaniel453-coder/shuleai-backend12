// models/Settings.js
module.exports = (sequelize, DataTypes) => {
  const Settings = sequelize.define('Settings', {
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    value: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    description: DataTypes.TEXT,
    category: DataTypes.STRING
  }, {
    timestamps: true
  });
  
  return Settings;
};
