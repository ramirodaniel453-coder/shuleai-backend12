module.exports = (sequelize, DataTypes) => {
  const LearnFeedFollow = sequelize.define('LearnFeedFollow', {
    followerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
    creatorId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' }
  }, { tableName: 'LearnFeedFollows', timestamps: true, indexes: [{ unique: true, fields: ['followerId', 'creatorId'] }, { fields: ['creatorId'] }] });
  return LearnFeedFollow;
};
