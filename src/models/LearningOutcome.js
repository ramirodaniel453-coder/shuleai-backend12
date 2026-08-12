module.exports = (sequelize, DataTypes) => {
  const LearningOutcome = sequelize.define('LearningOutcome', {
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false
    },
    gradeLevel: {
      type: DataTypes.STRING,
      allowNull: false
    },
    competencyId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Competencies', key: 'id' }
    },
    curriculum: {
      type: DataTypes.ENUM('cbc', '844', 'british', 'american'),
      defaultValue: 'cbc'
    }
  }, { timestamps: true });
  return LearningOutcome;
};
