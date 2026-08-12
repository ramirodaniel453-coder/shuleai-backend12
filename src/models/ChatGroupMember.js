module.exports = (sequelize, DataTypes) => {
  const ChatGroupMember = sequelize.define('ChatGroupMember', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    groupId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'member' }, // owner, admin, member
    muted: { type: DataTypes.BOOLEAN, defaultValue: false }
  }, { timestamps: true });
  return ChatGroupMember;
};
