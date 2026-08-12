module.exports = (sequelize, DataTypes) => {
  const FeeStructure = sequelize.define('FeeStructure', {
    schoolCode: { type: DataTypes.STRING, allowNull: false },
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    className: { type: DataTypes.STRING, allowNull: false },
    classIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    assignedClasses: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    groupKey: { type: DataTypes.STRING, allowNull: true },
    studentsAssigned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    gradeLevel: { type: DataTypes.STRING, allowNull: true },
    curriculum: { type: DataTypes.STRING, allowNull: true, defaultValue: 'CBC' },
    term: { type: DataTypes.ENUM('Term 1', 'Term 2', 'Term 3'), allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'KES' },
    items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    optionalItems: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    discounts: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    totalAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('draft', 'active', 'locked', 'archived'), allowNull: false, defaultValue: 'draft' },
    effectiveFrom: { type: DataTypes.DATE, allowNull: true },
    dueDate: { type: DataTypes.DATE, allowNull: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    lockedBy: { type: DataTypes.INTEGER, allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true },
    auditTrail: { type: DataTypes.JSONB, defaultValue: [] }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'className', 'term', 'year'] },
      { fields: ['schoolCode', 'status'] }
    ]
  });

  FeeStructure.prototype.calculateTotal = function () {
    const required = Array.isArray(this.items) ? this.items : [];
    return required.reduce((sum, item) => sum + Math.max(0, Math.round(Number(item.amount || 0))), 0);
  };

  return FeeStructure;
};
