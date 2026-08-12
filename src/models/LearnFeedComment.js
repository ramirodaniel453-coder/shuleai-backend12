module.exports = (sequelize, DataTypes) => {
  const LearnFeedComment = sequelize.define('LearnFeedComment', {
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    videoId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedVideos', key: 'id' }, onDelete: 'CASCADE' },
    text: { type: DataTypes.TEXT, allowNull: false },
    likesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'visible' },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { tableName: 'LearnFeedComments', timestamps: true, indexes: [{ fields: ['videoId', 'status', 'createdAt'] }, { fields: ['userId', 'createdAt'] }] });
  return LearnFeedComment;
};
