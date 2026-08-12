module.exports = (sequelize, DataTypes) => {
  const LearnFeedVideo = sequelize.define('LearnFeedVideo', {
    creatorId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    subject: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'General' },
    className: { type: DataTypes.STRING(80), allowNull: true },
    title: { type: DataTypes.STRING(180), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    visualEmoji: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '🎓' },
    soundTitle: { type: DataTypes.STRING(180), allowNull: true },
    topic: { type: DataTypes.STRING(120), allowNull: true },
    aiContext: { type: DataTypes.TEXT, allowNull: true },
    quizQuestion: { type: DataTypes.TEXT, allowNull: true },
    quizOptions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    quizAnswerIndex: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    visibility: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'public' },
    allowComments: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    allowDuet: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    allowStitch: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isLiveReplay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'published' },
    likesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    commentsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    savesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sharesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    viewsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, { tableName: 'LearnFeedVideos', timestamps: true, indexes: [{ fields: ['creatorId', 'status'] }, { fields: ['status', 'visibility', 'createdAt'] }, { fields: ['subject', 'status'] }] });
  return LearnFeedVideo;
};
