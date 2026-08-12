'use strict';

module.exports = (sequelize, DataTypes) => sequelize.define('CurriculumPack', {
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
  countryIsoCode: {
    type: DataTypes.CHAR(2),
    allowNull: false,
    references: { model: 'Countries', key: 'isoCode' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  },
  authorityName: { type: DataTypes.STRING(180), allowNull: false },
  authorityUrl: { type: DataTypes.TEXT, allowNull: false },
  name: { type: DataTypes.STRING(180), allowNull: false },
  officialCode: { type: DataTypes.STRING(80), allowNull: false },
  legacySystemCode: { type: DataTypes.STRING(30), allowNull: true },
  version: { type: DataTypes.STRING(80), allowNull: false },
  effectiveFrom: { type: DataTypes.DATEONLY, allowNull: true },
  effectiveTo: { type: DataTypes.DATEONLY, allowNull: true },
  educationStages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  levels: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  subjectStructure: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  requiredSubjects: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  optionalSubjects: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  classNamingRules: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  streamGenerationRules: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  assessmentTypes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  gradingProfiles: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  academicPathways: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  sourceReferences: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  sourceChecksum: { type: DataTypes.STRING(128), allowNull: true },
  reviewStatus: {
    type: DataTypes.ENUM('draft', 'pending_review', 'reviewed', 'rejected', 'legacy_active'),
    allowNull: false,
    defaultValue: 'draft'
  },
  activationStatus: {
    type: DataTypes.ENUM('inactive', 'active', 'retired'),
    allowNull: false,
    defaultValue: 'inactive'
  },
  reviewedBy: { type: DataTypes.INTEGER, allowNull: true },
  reviewedAt: { type: DataTypes.DATE, allowNull: true },
  activatedBy: { type: DataTypes.INTEGER, allowNull: true },
  activatedAt: { type: DataTypes.DATE, allowNull: true },
  reviewNotes: { type: DataTypes.TEXT, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
}, {
  tableName: 'CurriculumPacks',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['countryIsoCode', 'officialCode', 'version'], name: 'uq_curriculum_pack_country_code_version' },
    { fields: ['countryIsoCode', 'activationStatus', 'reviewStatus'], name: 'idx_curriculum_pack_country_status' }
  ]
});
