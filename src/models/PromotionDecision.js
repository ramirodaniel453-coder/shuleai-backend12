module.exports = (sequelize, DataTypes) => {
  const PromotionDecision = sequelize.define('PromotionDecision', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    batchId: { type: DataTypes.INTEGER, allowNull: false },
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    currentEnrollmentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'StudentEnrollments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    fromClassId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    toClassId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    fromStream: { type: DataTypes.STRING, allowNull: true },
    toStream: { type: DataTypes.STRING, allowNull: true },
    outcome: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'promote' },
    warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'proposed' },
    appliedEnrollmentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'StudentEnrollments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['batchId', 'studentId'] },
      { fields: ['schoolCode', 'batchId', 'status'] }
    ]
  });
  return PromotionDecision;
};
