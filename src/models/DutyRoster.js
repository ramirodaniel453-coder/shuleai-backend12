module.exports = (sequelize, DataTypes) => {
  const DutyRoster = sequelize.define('DutyRoster', {
    schoolId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    duties: {
      type: DataTypes.JSONB,
      defaultValue: []
    },
    createdBy: DataTypes.INTEGER,
    publishedAt: DataTypes.DATE,
    publishedTo: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    metadata: DataTypes.JSONB
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['schoolId', 'date'] }
    ]
  });

  return DutyRoster;
};