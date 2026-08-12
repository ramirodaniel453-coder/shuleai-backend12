module.exports = (sequelize, DataTypes) => {
  const ConductLog = sequelize.define('ConductLog', {
    studentId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    teacherId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Teachers', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    type: { type: DataTypes.STRING(50), allowNull: false },
    description: DataTypes.TEXT,
    date: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW }
  }, { timestamps: true });
  return ConductLog;
};
