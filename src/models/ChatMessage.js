module.exports = (sequelize, DataTypes) => {
  const ChatMessage = sequelize.define('ChatMessage', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    receiverId: { type: DataTypes.INTEGER, allowNull: true },
    groupId: { type: DataTypes.INTEGER, allowNull: true },
    messageType: { type: DataTypes.STRING, defaultValue: 'text' },
    content: { type: DataTypes.TEXT, allowNull: false },
    attachmentUrl: { type: DataTypes.STRING, allowNull: true },
    pointsAwarded: { type: DataTypes.INTEGER, defaultValue: 0 },
    streakAwarded: { type: DataTypes.INTEGER, defaultValue: 0 },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    clientMessageId: { type: DataTypes.STRING(120), allowNull: true },
    conversationKey: { type: DataTypes.STRING(220), allowNull: true },
    deliveryStatus: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'sent' },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'conversationKey', 'createdAt'] },
      { unique: true, fields: ['schoolCode', 'senderId', 'clientMessageId'] }
    ]
  });
  return ChatMessage;
};
