module.exports = (sequelize, DataTypes) => {
  const UploadLog = sequelize.define('UploadLog', {
    type: {
      type: DataTypes.ENUM('students', 'marks', 'attendance'),
      allowNull: false
    },
    filename: DataTypes.STRING,
    originalName: DataTypes.STRING,
    fileSize: DataTypes.INTEGER,
    uploadedBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: false
    , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    stats: DataTypes.JSONB,
    dateRange: DataTypes.JSONB,
    errors: DataTypes.JSONB,
    warnings: DataTypes.JSONB,
    metadata: DataTypes.JSONB
  }, {
    timestamps: true
  });

  return UploadLog;
};