// src/models/Class.js - Add subjectTeachers field
module.exports = (sequelize, DataTypes) => {
  const Class = sequelize.define('Class', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    grade: {
      type: DataTypes.STRING,
      allowNull: false
    },
    stream: {
      type: DataTypes.STRING,
      allowNull: true
    },
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'Schools',
        key: 'schoolId'
      }
    },
    teacherId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Teachers',
        key: 'id'
      }
    },
    subjectTeachers: {
      type: DataTypes.JSONB,
      defaultValue: [] // [{ teacherId, subject, assignedAt }]
    },
    academicYear: {
      type: DataTypes.STRING,
      defaultValue: new Date().getFullYear().toString()
    },
    curriculum: {
      type: DataTypes.STRING,
      allowNull: true
    },
    curriculumPackId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'CurriculumPacks', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    curriculumPackVersion: { type: DataTypes.STRING(80), allowNull: true },
    levelCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    levelLabel: {
      type: DataTypes.STRING,
      allowNull: true
    },
    curriculumLevel: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    timestamps: true
  });

  return Class;
};
