module.exports = (sequelize, DataTypes) => {
  const SchoolPaymentSetting = sequelize.define('SchoolPaymentSetting', {
    schoolId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' } },
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    paymentMode: { type: DataTypes.ENUM('manual', 'daraja', 'bank', 'mixed'), defaultValue: 'manual' },
    mpesaType: { type: DataTypes.ENUM('till', 'paybill'), defaultValue: 'paybill' },
    tillNumber: { type: DataTypes.STRING, allowNull: true },
    paybillNumber: { type: DataTypes.STRING, allowNull: true },
    businessShortCode: { type: DataTypes.STRING, allowNull: true },
    accountReferenceFormat: { type: DataTypes.STRING, defaultValue: 'admissionNumber' },
    bankName: { type: DataTypes.STRING, allowNull: true },
    bankAccountName: { type: DataTypes.STRING, allowNull: true },
    bankAccountNumber: { type: DataTypes.STRING, allowNull: true },
    bankBranch: { type: DataTypes.STRING, allowNull: true },
    darajaEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    darajaConsumerKey: { type: DataTypes.TEXT, allowNull: true },
    darajaConsumerSecret: { type: DataTypes.TEXT, allowNull: true },
    darajaPasskey: { type: DataTypes.TEXT, allowNull: true },
    darajaShortcode: { type: DataTypes.STRING, allowNull: true },
    darajaEnvironment: { type: DataTypes.ENUM('sandbox', 'production'), defaultValue: 'sandbox' },
    callbackUrl: { type: DataTypes.STRING, allowNull: true },
    enabledProviders: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    defaultProvider: { type: DataTypes.STRING, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, { timestamps: true, indexes: [{ unique: true, fields: ['schoolCode'], name: 'school_payment_settings_school_unique_v2033' }] });
  return SchoolPaymentSetting;
};
