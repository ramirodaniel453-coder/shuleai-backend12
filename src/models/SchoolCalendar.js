module.exports = (sequelize, DataTypes) => {
  const SchoolCalendar = sequelize.define('SchoolCalendar', {
    schoolId: { type: DataTypes.STRING, allowNull: false },
    // STRING is intentional: older Render DBs used ENUMs and broke when new calendar types were added.
    // Keeping this flexible avoids production crashes when schools add sports/activity/custom events.
    eventType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'other' },
    eventName: { type: DataTypes.STRING, allowNull: false },
    term: { type: DataTypes.STRING, allowNull: true },
    year: { type: DataTypes.INTEGER, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    startDate: { type: DataTypes.DATEONLY, allowNull: false },
    endDate: { type: DataTypes.DATEONLY, allowNull: true },
    time: { type: DataTypes.STRING, allowNull: true },
    location: { type: DataTypes.STRING, allowNull: true },
    audience: { type: DataTypes.STRING, allowNull: false, defaultValue: 'whole_school' },
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    createdByUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
    isPublic: { type: DataTypes.BOOLEAN, defaultValue: true }
  }, {
    timestamps: true,
    indexes: [
      { fields: ['schoolId', 'startDate'] },
      { fields: ['schoolId', 'year', 'term'] },
      { fields: ['schoolId', 'createdByUserId'] }
    ]
  });
  return SchoolCalendar;
};
