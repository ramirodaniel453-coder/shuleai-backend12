module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    senderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    receiverId: {
      type: DataTypes.INTEGER,
      allowNull: true, // null for group messages
      references: { model: 'Users', key: 'id' }
    },
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: true
    , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    conversationId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    replyToMessageId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Messages', key: 'id' }
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    readAt: DataTypes.DATE,
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    timestamps: true,
    hooks: {
      beforeValidate(message) {
        const metadata = message.metadata || {};
        if (!message.schoolCode && metadata.schoolCode) message.schoolCode = String(metadata.schoolCode);
        if (!message.conversationId && (metadata.conversationKey || metadata.conversationId)) {
          message.conversationId = String(metadata.conversationKey || metadata.conversationId);
        }
      }
    }
  });

  return Message;
};
