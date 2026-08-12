module.exports = (sequelize, DataTypes) => {
  const FeeInvoice = sequelize.define('FeeInvoice', {
    schoolId: { type: DataTypes.INTEGER, allowNull: true },
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    parentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Parents', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    feeId: { type: DataTypes.INTEGER, allowNull: true },
    feeStructureId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'FeeStructures', key: 'id' } },
    invoiceNumber: { type: DataTypes.STRING, allowNull: false },
    term: { type: DataTypes.STRING, allowNull: true },
    year: { type: DataTypes.INTEGER, allowNull: true },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'KES' },
    subtotalAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    discountAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    taxAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    paidAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    creditAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    balanceAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'unpaid' },
    dueDate: { type: DataTypes.DATE, allowNull: true },
    issuedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true }
  }, { timestamps: true, indexes: [{ fields: ['schoolCode', 'studentId', 'status'] }, { unique: true, fields: ['schoolCode', 'invoiceNumber'] }] });
  return FeeInvoice;
};
