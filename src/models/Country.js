'use strict';

module.exports = (sequelize, DataTypes) => sequelize.define('Country', {
  isoCode: {
    type: DataTypes.CHAR(2),
    primaryKey: true,
    allowNull: false,
    validate: { is: /^[A-Z]{2}$/ }
  },
  iso3Code: {
    type: DataTypes.CHAR(3),
    allowNull: false,
    unique: true,
    validate: { is: /^[A-Z]{3}$/ }
  },
  name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  currencyCode: { type: DataTypes.CHAR(3), allowNull: false },
  timezone: { type: DataTypes.STRING(80), allowNull: false },
  languages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  region: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Africa' },
  isSupported: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
}, {
  tableName: 'Countries',
  timestamps: true,
  indexes: [{ fields: ['region', 'isSupported'] }]
});
