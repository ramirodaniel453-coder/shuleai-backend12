module.exports = (sequelize, DataTypes) => {
  const AchievementEvent = sequelize.define('AchievementEvent', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: true },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    awardedBy: { type: DataTypes.INTEGER, allowNull: true },
    sourceType: { type: DataTypes.STRING, allowNull: false }, // thread_reply, chat_message, manual
    sourceId: { type: DataTypes.INTEGER, allowNull: true },
    points: { type: DataTypes.INTEGER, defaultValue: 0 },
    streakDelta: { type: DataTypes.INTEGER, defaultValue: 0 },
    title: { type: DataTypes.STRING, defaultValue: 'Achievement' },
    note: { type: DataTypes.TEXT, allowNull: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} }
  }, { timestamps: true });
  return AchievementEvent;
};
