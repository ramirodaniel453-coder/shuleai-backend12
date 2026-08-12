'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserRoleAssignment = sequelize.define('UserRoleAssignment', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: false
    , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    role: {
      type: DataTypes.ENUM('finance_officer'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'revoked'),
      allowNull: false,
      defaultValue: 'active'
    },
    assignedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    assignedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    revokedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['userId', 'schoolCode', 'role'], name: 'idx_user_role_assignments_unique' },
      { fields: ['schoolCode', 'role', 'status'], name: 'idx_user_role_assignments_school_role_status' },
      { fields: ['userId', 'status'], name: 'idx_user_role_assignments_user_status' }
    ]
  });

  return UserRoleAssignment;
};
