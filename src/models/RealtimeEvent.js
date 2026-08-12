module.exports = (sequelize, DataTypes) => {
  const RealtimeEvent = sequelize.define('RealtimeEvent', {
    eventType: { type: DataTypes.STRING(120), allowNull: false },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    audience: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    entityType: { type: DataTypes.STRING(120), allowNull: true },
    entityId: { type: DataTypes.STRING(120), allowNull: true },
    recordVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    emittedAt: { type: DataTypes.DATE, allowNull: true },
    lastError: { type: DataTypes.TEXT, allowNull: true }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'id'] },
      { fields: ['status', 'createdAt'] },
      { fields: ['eventType', 'createdAt'] }
    ]
  });
  return RealtimeEvent;
};
