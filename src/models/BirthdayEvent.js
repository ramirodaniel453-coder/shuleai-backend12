module.exports = (sequelize, DataTypes) => {
  const BirthdayEvent = sequelize.define('BirthdayEvent', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    eventDate: { type: DataTypes.DATEONLY, allowNull: false },
    eventType: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'same_day' },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'created' },
    audience: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['schoolCode', 'studentId', 'eventDate', 'eventType'] },
      { fields: ['schoolCode', 'eventDate'] }
    ]
  });
  return BirthdayEvent;
};
