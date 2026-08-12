module.exports = (sequelize, DataTypes) => {
  const MoodCheckin = sequelize.define('MoodCheckin', {
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    mood: { type: DataTypes.STRING(20), allowNull: false },
    note: DataTypes.TEXT
  }, { timestamps: true });
  return MoodCheckin;
};
