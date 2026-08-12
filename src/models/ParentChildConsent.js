module.exports = (sequelize, DataTypes) => {
  const ParentChildConsent = sequelize.define('ParentChildConsent', {
    parentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    studentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Students', key: 'id' }
    },
    consentGiven: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { timestamps: true });
  
  return ParentChildConsent;
};
