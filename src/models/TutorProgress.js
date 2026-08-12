module.exports = (sequelize, DataTypes) => {
  const TutorProgress = sequelize.define('TutorProgress', {
    schoolId: { type: DataTypes.STRING, allowNull: false, index: true },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false },
    grade: { type: DataTypes.STRING, allowNull: true },
    level: { type: DataTypes.STRING, allowNull: true },
    subject: { type: DataTypes.STRING, allowNull: false },
    topic: { type: DataTypes.STRING, allowNull: false, defaultValue: 'General' },
    attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    correct: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastCommand: { type: DataTypes.STRING, allowNull: true },
    lastSource: { type: DataTypes.STRING, allowNull: true },
    lastStudiedAt: { type: DataTypes.DATE, allowNull: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, {
    timestamps: true,
    indexes: [{ unique: true, fields: ['schoolId', 'studentId', 'subject', 'topic'] }]
  });
  return TutorProgress;
};
