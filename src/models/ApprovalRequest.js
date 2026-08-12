module.exports = (sequelize, DataTypes) => {
  const ApprovalRequest = sequelize.define('ApprovalRequest', {
    schoolId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    role: {
      type: DataTypes.ENUM('teacher', 'parent', 'student'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending'
    },
    data: DataTypes.JSONB,
    reviewedBy: DataTypes.INTEGER,
    reviewedAt: DataTypes.DATE,
    rejectionReason: DataTypes.TEXT,
    notes: DataTypes.TEXT,
    metadata: DataTypes.JSONB,
    expiresAt: {
      type: DataTypes.DATE,
      defaultValue: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  }, {
    timestamps: true
  });

  return ApprovalRequest;
};