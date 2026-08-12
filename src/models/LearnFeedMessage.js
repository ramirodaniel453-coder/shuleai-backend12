module.exports = (sequelize, DataTypes) => {
  const LearnFeedMessage = sequelize.define('LearnFeedMessage', {
    fromUserId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    toUserId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    text: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'sent' },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { tableName: 'LearnFeedMessages', timestamps: true, indexes: [{ fields: ['fromUserId', 'toUserId', 'createdAt'] }, { fields: ['toUserId', 'status', 'createdAt'] }] });
  return LearnFeedMessage;
};
