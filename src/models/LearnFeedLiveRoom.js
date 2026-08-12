module.exports = (sequelize, DataTypes) => {
  const LearnFeedLiveRoom = sequelize.define('LearnFeedLiveRoom', {
    hostUserId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    title: { type: DataTypes.STRING(180), allowNull: false },
    subject: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'General' },
    emoji: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '🔴' },
    viewers: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'live' },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    endedAt: { type: DataTypes.DATE, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { tableName: 'LearnFeedLiveRooms', timestamps: true, indexes: [{ fields: ['status', 'createdAt'] }, { fields: ['hostUserId', 'status'] }] });
  return LearnFeedLiveRoom;
};
