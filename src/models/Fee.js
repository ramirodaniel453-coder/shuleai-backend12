module.exports = (sequelize, DataTypes) => {
  const Fee = sequelize.define('Fee', {
    studentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Students', key: 'id' }
    },
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: false
    , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    term: {
      type: DataTypes.ENUM('Term 1', 'Term 2', 'Term 3'),
      allowNull: false
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    totalAmount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    paidAmount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    parentPaidAmount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    creditAmount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    balance: {
      type: DataTypes.VIRTUAL,
      get() { return Math.max(0, Number(this.totalAmount || 0) - Number(this.parentPaidAmount ?? this.paidAmount ?? 0) - Number(this.creditAmount || 0)); }
    },
    dueDate: DataTypes.DATE,
    status: {
      type: DataTypes.ENUM('paid', 'partial', 'unpaid', 'overdue'),
      defaultValue: 'unpaid'
    },
    paymentPlan: {
      type: DataTypes.ENUM('basic', 'premium', 'ultimate'),
      defaultValue: 'basic'
    },
    payments: { type: DataTypes.JSONB, defaultValue: [] },
    feeStructureId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'FeeStructures', key: 'id' } },
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    currency: { type: DataTypes.STRING, defaultValue: 'KES' },
    locked: { type: DataTypes.BOOLEAN, defaultValue: false },
    auditTrail: { type: DataTypes.JSONB, defaultValue: [] },
    adjustments: { type: DataTypes.JSONB, defaultValue: [] },
    lastReconciledAt: { type: DataTypes.DATE, allowNull: true },
    sourceBreakdown: { type: DataTypes.JSONB, defaultValue: {} },
    lastTransactionAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    timestamps: true
  });

  return Fee;
};