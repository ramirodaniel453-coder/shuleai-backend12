module.exports = (sequelize, DataTypes) => {
  const StudentFeeAccount = sequelize.define('StudentFeeAccount', {
    schoolId: { type: DataTypes.INTEGER, allowNull: true },
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'KES' },
    openingBalance: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    invoicedAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    paidAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    creditAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    refundedAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    balanceAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'unpaid' },
    lastTransactionAt: { type: DataTypes.DATE, allowNull: true },
    lastRecalculatedAt: { type: DataTypes.DATE, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { timestamps: true, indexes: [{ unique: true, fields: ['schoolCode', 'studentId'] }] });
  return StudentFeeAccount;
};
