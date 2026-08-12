module.exports = (sequelize, DataTypes) => {
  const SchoolNameRequest = sequelize.define('SchoolNameRequest', {
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: false
    },
    currentName: DataTypes.STRING,
    newName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    reason: DataTypes.TEXT,
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending'
    },
    requestedBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    reviewedBy: DataTypes.INTEGER,
    reviewedAt: DataTypes.DATE,
    rejectionReason: DataTypes.TEXT
  }, {
    timestamps: true
  });

  return SchoolNameRequest;
};