module.exports = (sequelize, DataTypes) => {
  const TutorMessage = sequelize.define('TutorMessage', {
    schoolId: { type: DataTypes.STRING, allowNull: false, index: true },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    sessionId: { type: DataTypes.INTEGER, allowNull: true },
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    role: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // Keep content for older/live databases that still have a NOT NULL content column.
    // New code writes both message and content so TutorMessages never fails on legacy schema.
    content: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    subject: { type: DataTypes.STRING, allowNull: true },
    topic: { type: DataTypes.STRING, allowNull: true },
    command: { type: DataTypes.STRING, allowNull: true },
    source: { type: DataTypes.STRING, allowNull: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, { timestamps: true });
  return TutorMessage;
};
