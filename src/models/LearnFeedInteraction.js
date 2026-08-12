module.exports = (sequelize, DataTypes) => {
  const LearnFeedInteraction = sequelize.define('LearnFeedInteraction', {
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    videoId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedVideos', key: 'id' }, onDelete: 'CASCADE' },
    type: { type: DataTypes.STRING(40), allowNull: false },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { tableName: 'LearnFeedInteractions', timestamps: true, indexes: [{ unique: true, fields: ['userId', 'videoId', 'type'] }, { fields: ['videoId', 'type'] }] });
  return LearnFeedInteraction;
};
