// models/Alert.js
module.exports = (sequelize, DataTypes) => {
  const Alert = sequelize.define('Alert', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      }
    },
    role: {
      type: DataTypes.ENUM('student', 'parent', 'teacher', 'admin', 'finance_officer', 'super_admin'),
      allowNull: false,
      defaultValue: 'admin'
    },
    type: {
      type: DataTypes.ENUM('academic', 'attendance', 'fee', 'system', 'improvement', 'duty', 'approval', 'message', 'career'),
      allowNull: false,
      defaultValue: 'system'
    },
    severity: {
      type: DataTypes.ENUM('critical', 'warning', 'info', 'success'),
      allowNull: false,
      defaultValue: 'info'
    },
    title: DataTypes.STRING,
    message: DataTypes.TEXT,
    categoryLabel: DataTypes.STRING,
    sourceType: DataTypes.STRING,
    sourceLabel: DataTypes.STRING,
    targetRole: DataTypes.STRING,
    targetUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    studentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    priority: DataTypes.STRING,
    dedupeKey: DataTypes.STRING,
    actionLabel: DataTypes.STRING,
    readAt: DataTypes.DATE,
    data: DataTypes.JSONB,
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActioned: { type: DataTypes.BOOLEAN, defaultValue: false },
    actionUrl: DataTypes.STRING,
    expiresAt: DataTypes.DATE
  }, {
    timestamps: true
  });

  return Alert;
};
