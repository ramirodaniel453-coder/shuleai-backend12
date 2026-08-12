module.exports = (sequelize, DataTypes) => {
  const Timetable = sequelize.define('Timetable', {
    schoolId: { type: DataTypes.STRING, allowNull: false },
    weekStartDate: { type: DataTypes.DATEONLY, allowNull: false },
    term: { type: DataTypes.STRING, allowNull: true },
    year: { type: DataTypes.INTEGER, allowNull: true },
    scope: { type: DataTypes.ENUM('term','year','week'), defaultValue: 'term' },
    slots: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    classes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    warnings: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    isPublished: { type: DataTypes.BOOLEAN, defaultValue:false },
    status: { type:DataTypes.STRING(24), allowNull:false, defaultValue:'draft' },
    version: { type:DataTypes.INTEGER, allowNull:false, defaultValue:1 },
    publishedAt: { type:DataTypes.DATE, allowNull:true },
    publishedBy: { type:DataTypes.INTEGER, allowNull:true },
    supersedesId: { type:DataTypes.INTEGER, allowNull:true, references: { model: 'Timetables', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' }
  }, { timestamps: true });
  return Timetable;
};
