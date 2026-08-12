module.exports = (sequelize, DataTypes) => {
  const Competency = sequelize.define('Competency', {
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: DataTypes.TEXT,
    category: {
      type: DataTypes.ENUM('core', 'generic', 'specific'),
      defaultValue: 'core'
    },
    curriculum: {
      type: DataTypes.ENUM('cbc', '844', 'british', 'american'),
      defaultValue: 'cbc'
    }
  }, { timestamps: true });
  return Competency;
};
