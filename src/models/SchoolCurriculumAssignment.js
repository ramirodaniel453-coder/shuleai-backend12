'use strict';

module.exports = (sequelize, DataTypes) => sequelize.define('SchoolCurriculumAssignment', {
  id: { type: DataTypes.UUID, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
  schoolCode: {
    type: DataTypes.STRING,
    allowNull: false,
    references: { model: 'Schools', key: 'schoolId' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  },
  countryIsoCode: {
    type: DataTypes.CHAR(2),
    allowNull: false,
    references: { model: 'Countries', key: 'isoCode' },
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
  previousAssignmentId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'SchoolCurriculumAssignments', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT'
  },
  assignmentVersion: { type: DataTypes.INTEGER, allowNull: false },
  selectedStageCodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  enabledLevelCodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  selectedSubjectCodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  selectedPathwayCodes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  gradingProfileCode: { type: DataTypes.STRING(80), allowNull: false },
  customGradingProfileId: { type: DataTypes.UUID, allowNull: true },
  classGenerationConfig: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  status: { type: DataTypes.ENUM('active', 'superseded'), allowNull: false, defaultValue: 'active' },
  effectiveFrom: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  effectiveTo: { type: DataTypes.DATE, allowNull: true },
  changeReason: { type: DataTypes.TEXT, allowNull: false },
  changedBy: { type: DataTypes.INTEGER, allowNull: true },
  source: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'admin_workflow' },
  snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
}, {
  tableName: 'SchoolCurriculumAssignments',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['schoolCode', 'assignmentVersion'], name: 'uq_school_curriculum_assignment_version' },
    { fields: ['schoolCode', 'status'], name: 'idx_school_curriculum_assignment_status' }
  ]
});
