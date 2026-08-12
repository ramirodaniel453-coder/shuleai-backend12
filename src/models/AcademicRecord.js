module.exports = (sequelize, DataTypes) => {
  const AcademicRecord = sequelize.define('AcademicRecord', {
    studentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Students', key: 'id' }
    },
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: false
    , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    term: {
      type: DataTypes.ENUM('Term 1', 'Term 2', 'Term 3'),
      allowNull: false
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false
    },
    assessmentType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'test'
    },
    assessmentKey: { type: DataTypes.STRING, allowNull: true },
    assessmentCategory: { type: DataTypes.STRING, allowNull: true },
    assessmentName: DataTypes.STRING,
    maxScore: { type: DataTypes.FLOAT, allowNull: true },
    assessmentWeight: { type: DataTypes.FLOAT, allowNull: true },
    showOnReport: { type: DataTypes.BOOLEAN, defaultValue: true },
    countInFinal: { type: DataTypes.BOOLEAN, defaultValue: true },
    displayOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
    score: {
      type: DataTypes.INTEGER,
      validate: { min: 0, max: 100 }
    },
    grade: DataTypes.STRING,
    remarks: DataTypes.TEXT,
    teacherId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'Teachers', key: 'id' }
    },
    gradingScale: {
      type: DataTypes.JSONB,
      defaultValue: null
    },
    curriculumPackId: { type: DataTypes.UUID, allowNull: true, references: { model: 'CurriculumPacks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    curriculumPackVersion: { type: DataTypes.STRING(80), allowNull: true },
    curriculumOfficialCode: { type: DataTypes.STRING(80), allowNull: true },
    countryIsoCode: { type: DataTypes.CHAR(2), allowNull: true },
    gradingProfileCode: { type: DataTypes.STRING(80), allowNull: true },
    gradingProfileVersion: { type: DataTypes.STRING(80), allowNull: true },
    curriculumSnapshot: { type: DataTypes.JSONB, allowNull: true },
    gradingSnapshot: { type: DataTypes.JSONB, allowNull: true },
    competencyEvidence: { type: DataTypes.JSONB, allowNull: true },
    date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    classId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Classes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    curriculum: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM('draft', 'reviewed', 'published', 'locked'), defaultValue: 'draft' },
    isPublished: { type: DataTypes.BOOLEAN, defaultValue: false },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    publishedBy: { type: DataTypes.INTEGER, allowNull: true },
    lockedAt: { type: DataTypes.DATE, allowNull: true },
    unlockedBy: { type: DataTypes.INTEGER, allowNull: true },
    unlockReason: { type: DataTypes.TEXT, allowNull: true },
    version: { type: DataTypes.INTEGER, defaultValue: 1 },
    auditTrail: { type: DataTypes.JSONB, defaultValue: [] }
  }, {
    defaultScope: { attributes: { exclude: ['classId'] } },
    timestamps: true,
    indexes: [
      { fields: ['schoolCode', 'curriculumPackId'] },
      { fields: ['studentId', 'assessmentKey', 'term', 'year'] }
    ]
  });

  const immutableSnapshotFields=[
    'curriculumPackId','curriculumPackVersion','curriculumOfficialCode','countryIsoCode',
    'gradingProfileCode','gradingProfileVersion','curriculumSnapshot','gradingSnapshot'
  ];
  AcademicRecord.addHook('beforeUpdate',record=>{
    for(const field of immutableSnapshotFields){
      if(record.previous(field)!=null&&record.changed(field))throw new Error(`Historical assessment field ${field} is immutable`);
    }
  });
  AcademicRecord.addHook('beforeBulkUpdate',options=>{
    const attempted=immutableSnapshotFields.filter(field=>Object.prototype.hasOwnProperty.call(options.attributes||{},field));
    if(attempted.length)throw new Error(`Bulk historical assessment snapshot update refused: ${attempted.join(', ')}`);
  });

  return AcademicRecord;
};
