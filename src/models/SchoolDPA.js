module.exports = (sequelize, DataTypes) => {
  const SchoolDPA = sequelize.define('SchoolDPA', {
    schoolId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: { model: 'Schools', key: 'schoolId' }
    },
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    accepted: { type: DataTypes.BOOLEAN, defaultValue: false },
    acceptedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    ipAddress: DataTypes.STRING
  }, { timestamps: true });
  
  return SchoolDPA;
};
