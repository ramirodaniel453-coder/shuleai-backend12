module.exports = (sequelize, DataTypes) => {
  const PlatformPaymentSetting = sequelize.define('PlatformPaymentSetting', {
    businessName: { type: DataTypes.STRING, defaultValue: 'Shule AI' },
    paymentMode: { type: DataTypes.ENUM('manual', 'daraja', 'bank', 'mixed'), defaultValue: 'daraja' },
    mpesaType: { type: DataTypes.ENUM('till', 'paybill'), defaultValue: 'paybill' },
    tillNumber: { type: DataTypes.STRING, allowNull: true },
    paybillNumber: { type: DataTypes.STRING, allowNull: true },
    businessShortCode: { type: DataTypes.STRING, allowNull: true },
    accountNumber: { type: DataTypes.STRING, defaultValue: 'SHULEAI' },
    darajaConsumerKey: { type: DataTypes.TEXT, allowNull: true },
    darajaConsumerSecret: { type: DataTypes.TEXT, allowNull: true },
    darajaPasskey: { type: DataTypes.TEXT, allowNull: true },
    darajaShortcode: { type: DataTypes.STRING, allowNull: true },
    darajaEnvironment: { type: DataTypes.ENUM('sandbox', 'production'), defaultValue: 'sandbox' },
    callbackUrl: { type: DataTypes.STRING, allowNull: true },
    enabledProviders: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    defaultProvider: { type: DataTypes.STRING, allowNull: true },
    bankName: { type: DataTypes.STRING, allowNull: true },
    bankAccountName: { type: DataTypes.STRING, allowNull: true },
    bankAccountNumber: { type: DataTypes.STRING, allowNull: true },
    bankBranch: { type: DataTypes.STRING, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, { timestamps: true });
  return PlatformPaymentSetting;
};
