module.exports = (sequelize, DataTypes) => {
  const PromotionBatch = sequelize.define('PromotionBatch', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    closingYear: { type: DataTypes.INTEGER, allowNull: false },
    newYear: { type: DataTypes.INTEGER, allowNull: false },
    effectiveDate: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'draft' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false },
    confirmedBy: { type: DataTypes.INTEGER, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true },
    rollbackBy: { type: DataTypes.INTEGER, allowNull: true },
    rollbackAt: { type: DataTypes.DATE, allowNull: true },
    summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'closingYear', 'newYear'] },
      { fields: ['schoolCode', 'status', 'effectiveDate'] }
    ]
  });
  return PromotionBatch;
};
