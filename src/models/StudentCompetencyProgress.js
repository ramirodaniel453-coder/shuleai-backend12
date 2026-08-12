module.exports = (sequelize, DataTypes) => {
  const StudentCompetencyProgress = sequelize.define('StudentCompetencyProgress', {
    studentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Students', key: 'id' }
    },
    learningOutcomeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'LearningOutcomes', key: 'id' }
    },
    level: {
      type: DataTypes.ENUM('EE', 'ME', 'AE', 'BE'),
      defaultValue: 'BE'
    },
    evidence: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    lastUpdated: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    notes: DataTypes.TEXT
  }, { timestamps: true });
  return StudentCompetencyProgress;
};
