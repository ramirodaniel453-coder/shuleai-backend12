const { yearlyBusinessId } = require('../utils/businessIds');
module.exports = (sequelize, DataTypes) => {
  const Parent = sequelize.define('Parent', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Users', key: 'id' }
    },
    parentId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      defaultValue: () => yearlyBusinessId('PAR')
    },
    occupation: DataTypes.STRING,
    relationship: {
      type: DataTypes.ENUM('father', 'mother', 'guardian', 'other'),
      defaultValue: 'guardian'
    },
    emergencyContact: DataTypes.STRING,
    preferences: {
      type: DataTypes.JSONB,
      defaultValue: {
        notifications: { email: true, sms: false, push: true },
        guidanceTips: true
      }
    }
  }, {
    timestamps: true,
    hooks: {
      beforeCreate: async (parent) => {
        if (!parent.parentId || parent.parentId.startsWith('PAR-') === false) {
          parent.parentId = yearlyBusinessId('PAR');
          console.log('Generated parentId:', parent.parentId);
        }
      }
    }
  });

  return Parent;
};
