module.exports = (sequelize, DataTypes) => {
  const ChatGroup = sequelize.define('ChatGroup', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    schoolCode: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, defaultValue: 'general' }, // department, committee, project, staff, class
    description: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    departmentId: { type: DataTypes.INTEGER, allowNull: true },
    classId: { type: DataTypes.INTEGER, allowNull: true },
    onlyAdminsCanSend: { type: DataTypes.BOOLEAN, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, { timestamps: true });
  return ChatGroup;
};
