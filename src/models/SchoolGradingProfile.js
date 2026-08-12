'use strict';

module.exports = (sequelize, DataTypes) => sequelize.define('SchoolGradingProfile', {
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
  schoolCode: {
    type: DataTypes.STRING,
    allowNull: false,
    references: { model: 'Schools', key: 'schoolId' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  },
  curriculumPackId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'CurriculumPacks', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  },
  code: { type: DataTypes.STRING(80), allowNull: false },
  name: { type: DataTypes.STRING(160), allowNull: false },
  version: { type: DataTypes.INTEGER, allowNull: false },
  profile: { type: DataTypes.JSONB, allowNull: false },
  checksum: { type: DataTypes.STRING(128), allowNull: false },
  status: { type: DataTypes.ENUM('draft', 'active', 'retired'), allowNull: false, defaultValue: 'draft' },
  supersedesId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'SchoolGradingProfiles', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  },
  changeReason: { type: DataTypes.TEXT, allowNull: false },
  createdBy: { type: DataTypes.INTEGER, allowNull: false },
  activatedBy: { type: DataTypes.INTEGER, allowNull: true },
  activatedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'SchoolGradingProfiles',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['schoolCode', 'code', 'version'], name: 'uq_school_grading_profile_version' },
    { fields: ['schoolCode', 'status'], name: 'idx_school_grading_profile_status' }
  ]
});
