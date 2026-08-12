module.exports = (sequelize, DataTypes) => {
  const UserConsent = sequelize.define('UserConsent', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    termsAccepted: { type: DataTypes.BOOLEAN, defaultValue: false },
    privacyAccepted: { type: DataTypes.BOOLEAN, defaultValue: false },
    acceptedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    ipAddress: DataTypes.STRING,
    userAgent: DataTypes.TEXT
  }, { timestamps: true });
  
  return UserConsent;
};
