module.exports = (sequelize, DataTypes) => {
  const ReportSnapshot = sequelize.define('ReportSnapshot', {
    schoolCode: { type: DataTypes.STRING, allowNull: false , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    studentId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' } },
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    term: { type: DataTypes.STRING, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    curriculum: { type: DataTypes.STRING, allowNull: true },
    reportType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'academic' },
    status: { type: DataTypes.ENUM('draft', 'published', 'archived'), defaultValue: 'draft' },
    generatedBy: { type: DataTypes.INTEGER, allowNull: true },
    publishedBy: { type: DataTypes.INTEGER, allowNull: true },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    sourceRecordIds: { type: DataTypes.ARRAY(DataTypes.INTEGER), defaultValue: [] },
    checksum: { type: DataTypes.STRING, allowNull: true },
    metadata: { type: DataTypes.JSONB, defaultValue: {} },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    assessmentKey: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'term' },
    supersedesId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'ReportSnapshots', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    correctionReason: { type: DataTypes.TEXT, allowNull: true },
    isCurrent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    formatVersion: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'v143' }
  }, {
    timestamps: true,
    indexes: [
      { unique: true, fields: ['schoolCode', 'studentId', 'term', 'year', 'reportType', 'assessmentKey', 'version'] },
      { fields: ['schoolCode', 'term', 'year'] },
      { fields: ['studentId'] }
    ]
  });
  return ReportSnapshot;
};
