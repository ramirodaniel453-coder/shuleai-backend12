module.exports = (sequelize, DataTypes) => {
  const ClassroomThread = sequelize.define('ClassroomThread', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    classId: { type: DataTypes.INTEGER, allowNull: true },
    subject: { type: DataTypes.STRING, allowNull: false },
    topic: { type: DataTypes.STRING, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    teacherId: { type: DataTypes.INTEGER, allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: false },
    isPinned: { type: DataTypes.BOOLEAN, defaultValue: false },
    isClosed: { type: DataTypes.BOOLEAN, defaultValue: false },
    pointsAwarded: { type: DataTypes.INTEGER, defaultValue: 0 },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, { timestamps: true });
  return ClassroomThread;
};
