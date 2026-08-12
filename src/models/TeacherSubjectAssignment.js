const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TeacherSubjectAssignment = sequelize.define('TeacherSubjectAssignment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    teacherId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    classId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false
    },
    isClassTeacher: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    academicYear: {
      type: DataTypes.STRING,
      defaultValue: () => new Date().getFullYear().toString()
    },
    schoolSubjectId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    curriculum: {
      type: DataTypes.STRING,
      allowNull: true
    },
    levelCode: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    timestamps: true,
    tableName: 'TeacherSubjectAssignments'
  });

  return TeacherSubjectAssignment;
};
