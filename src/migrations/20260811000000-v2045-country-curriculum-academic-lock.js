'use strict';

const crypto = require('crypto');
const { COUNTRIES, CURRICULUM_PACKS, LEGACY_SYSTEM_PACK_IDS } = require('../data/v2045CurriculumSeed');

const MIGRATION_KEY = '20260811000000-v2045-country-curriculum-academic-lock';
const PROTECTED_TABLES = [
  'Schools','Users','Students','Classes','Parents','StudentParents','StudentEnrollments',
  'Attendances','Fees','FeeInvoices','Payments','AcademicRecords'
];

const q = value => `"${String(value).replace(/"/g, '""')}"`;

async function tableExists(queryInterface, table) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT to_regclass(:name) AS regclass',
    { replacements:{ name:`public."${String(table).replace(/"/g, '""')}"` } }
  );
  return Boolean(rows?.[0]?.regclass);
}

async function columnExists(queryInterface, table, column) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema=current_schema() AND table_name=:table AND column_name=:column
     LIMIT 1
  `, { replacements:{ table,column } });
  return rows.length > 0;
}

async function counts(queryInterface) {
  const result = {};
  for (const table of PROTECTED_TABLES) {
    if (!(await tableExists(queryInterface, table))) continue;
    const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*)::bigint::text AS count FROM ${q(table)}`);
    result[table] = String(rows?.[0]?.count || '0');
  }
  return result;
}

async function academicLegacyDigest(queryInterface) {
  if (!(await tableExists(queryInterface, 'AcademicRecords'))) return null;
  const [rows] = await queryInterface.sequelize.query(`
    SELECT md5(COALESCE(string_agg(
      md5(concat_ws('|',id::text,"studentId"::text,"schoolCode",term,year::text,subject,
        "assessmentType",COALESCE("assessmentName",''),COALESCE(score::text,''),COALESCE(grade,''),
        COALESCE(remarks,''),"teacherId"::text,COALESCE("classId"::text,''),COALESCE(curriculum,''),
        COALESCE("gradingScale"::text,''),COALESCE(status::text,''),COALESCE("isPublished"::text,''),
        COALESCE("auditTrail"::text,''))), '' ORDER BY id), '')) AS digest
      FROM "AcademicRecords"
  `);
  return rows?.[0]?.digest || null;
}

async function constraintExists(queryInterface, name) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT 1 FROM pg_constraint WHERE conname=:name LIMIT 1',
    { replacements:{ name } }
  );
  return rows.length > 0;
}

async function indexExists(queryInterface, name, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname=:name LIMIT 1',
    { replacements:{ name }, transaction }
  );
  return rows.length > 0;
}

async function addIndexIfMissing(queryInterface, table, fields, options) {
  if (!(await indexExists(queryInterface, options.name, options.transaction))) {
    await queryInterface.addIndex(table,fields,options);
  }
}

async function addConstraintIfMissing(queryInterface, table, options) {
  if (!(await constraintExists(queryInterface, options.name))) {
    await queryInterface.addConstraint(table, options);
  }
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function createCanonicalTables(queryInterface, Sequelize, transaction) {
  if (!(await tableExists(queryInterface, 'Countries'))) {
    await queryInterface.createTable('Countries', {
      isoCode:{type:Sequelize.CHAR(2),primaryKey:true,allowNull:false},
      iso3Code:{type:Sequelize.CHAR(3),allowNull:false,unique:true},
      name:{type:Sequelize.STRING(100),allowNull:false,unique:true},
      currencyCode:{type:Sequelize.CHAR(3),allowNull:false},
      timezone:{type:Sequelize.STRING(80),allowNull:false},
      languages:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]},
      region:{type:Sequelize.STRING(80),allowNull:false,defaultValue:'Africa'},
      isSupported:{type:Sequelize.BOOLEAN,allowNull:false,defaultValue:true},
      metadata:{type:Sequelize.JSONB,allowNull:false,defaultValue:{}},
      createdAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')},
      updatedAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')}
    }, { transaction });
  }

  if (!(await tableExists(queryInterface, 'CurriculumPacks'))) {
    await queryInterface.createTable('CurriculumPacks', {
      id:{type:Sequelize.UUID,primaryKey:true,allowNull:false},
      countryIsoCode:{type:Sequelize.CHAR(2),allowNull:false,references:{model:'Countries',key:'isoCode'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      authorityName:{type:Sequelize.STRING(180),allowNull:false}, authorityUrl:{type:Sequelize.TEXT,allowNull:false},
      name:{type:Sequelize.STRING(180),allowNull:false}, officialCode:{type:Sequelize.STRING(80),allowNull:false},
      legacySystemCode:{type:Sequelize.STRING(30),allowNull:true}, version:{type:Sequelize.STRING(80),allowNull:false},
      effectiveFrom:{type:Sequelize.DATEONLY,allowNull:true}, effectiveTo:{type:Sequelize.DATEONLY,allowNull:true},
      educationStages:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]}, levels:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]},
      subjectStructure:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]}, requiredSubjects:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]},
      optionalSubjects:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]}, classNamingRules:{type:Sequelize.JSONB,allowNull:false,defaultValue:{}},
      streamGenerationRules:{type:Sequelize.JSONB,allowNull:false,defaultValue:{}}, assessmentTypes:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]},
      gradingProfiles:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]}, academicPathways:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]},
      sourceReferences:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]}, sourceChecksum:{type:Sequelize.STRING(128),allowNull:true},
      reviewStatus:{type:Sequelize.ENUM('draft','pending_review','reviewed','rejected','legacy_active'),allowNull:false,defaultValue:'draft'},
      activationStatus:{type:Sequelize.ENUM('inactive','active','retired'),allowNull:false,defaultValue:'inactive'},
      reviewedBy:{type:Sequelize.INTEGER,allowNull:true},reviewedAt:{type:Sequelize.DATE,allowNull:true},
      activatedBy:{type:Sequelize.INTEGER,allowNull:true},activatedAt:{type:Sequelize.DATE,allowNull:true},
      reviewNotes:{type:Sequelize.TEXT,allowNull:true},metadata:{type:Sequelize.JSONB,allowNull:false,defaultValue:{}},
      createdAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')},
      updatedAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')}
    }, { transaction });
  }
  await addIndexIfMissing(queryInterface,'CurriculumPacks',['countryIsoCode','officialCode','version'],{unique:true,name:'uq_curriculum_pack_country_code_version',transaction});
  await addIndexIfMissing(queryInterface,'CurriculumPacks',['countryIsoCode','activationStatus','reviewStatus'],{name:'idx_curriculum_pack_country_status',transaction});

  if (!(await tableExists(queryInterface, 'SchoolGradingProfiles'))) {
    await queryInterface.createTable('SchoolGradingProfiles', {
      id:{type:Sequelize.UUID,primaryKey:true,allowNull:false},
      schoolCode:{type:Sequelize.STRING,allowNull:false,references:{model:'Schools',key:'schoolId'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      curriculumPackId:{type:Sequelize.UUID,allowNull:false,references:{model:'CurriculumPacks',key:'id'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      code:{type:Sequelize.STRING(80),allowNull:false},name:{type:Sequelize.STRING(160),allowNull:false},version:{type:Sequelize.INTEGER,allowNull:false},
      profile:{type:Sequelize.JSONB,allowNull:false},checksum:{type:Sequelize.STRING(128),allowNull:false},
      status:{type:Sequelize.ENUM('draft','active','retired'),allowNull:false,defaultValue:'draft'},
      supersedesId:{type:Sequelize.UUID,allowNull:true,references:{model:'SchoolGradingProfiles',key:'id'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      changeReason:{type:Sequelize.TEXT,allowNull:false},createdBy:{type:Sequelize.INTEGER,allowNull:false},
      activatedBy:{type:Sequelize.INTEGER,allowNull:true},activatedAt:{type:Sequelize.DATE,allowNull:true},
      createdAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')},
      updatedAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')}
    }, { transaction });
  }
  await addIndexIfMissing(queryInterface,'SchoolGradingProfiles',['schoolCode','code','version'],{unique:true,name:'uq_school_grading_profile_version',transaction});
  await addIndexIfMissing(queryInterface,'SchoolGradingProfiles',['schoolCode','status'],{name:'idx_school_grading_profile_status',transaction});

  if (!(await tableExists(queryInterface, 'SchoolCurriculumAssignments'))) {
    await queryInterface.createTable('SchoolCurriculumAssignments', {
      id:{type:Sequelize.UUID,primaryKey:true,allowNull:false},
      schoolCode:{type:Sequelize.STRING,allowNull:false,references:{model:'Schools',key:'schoolId'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      countryIsoCode:{type:Sequelize.CHAR(2),allowNull:false,references:{model:'Countries',key:'isoCode'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      curriculumPackId:{type:Sequelize.UUID,allowNull:false,references:{model:'CurriculumPacks',key:'id'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      previousAssignmentId:{type:Sequelize.UUID,allowNull:true,references:{model:'SchoolCurriculumAssignments',key:'id'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      assignmentVersion:{type:Sequelize.INTEGER,allowNull:false}, selectedStageCodes:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]},
      enabledLevelCodes:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]}, selectedSubjectCodes:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]},
      selectedPathwayCodes:{type:Sequelize.JSONB,allowNull:false,defaultValue:[]}, gradingProfileCode:{type:Sequelize.STRING(80),allowNull:false},
      customGradingProfileId:{type:Sequelize.UUID,allowNull:true,references:{model:'SchoolGradingProfiles',key:'id'},onUpdate:'CASCADE',onDelete:'RESTRICT'},
      classGenerationConfig:{type:Sequelize.JSONB,allowNull:false,defaultValue:{}},
      status:{type:Sequelize.ENUM('active','superseded'),allowNull:false,defaultValue:'active'},
      effectiveFrom:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')},effectiveTo:{type:Sequelize.DATE,allowNull:true},
      changeReason:{type:Sequelize.TEXT,allowNull:false},changedBy:{type:Sequelize.INTEGER,allowNull:true},source:{type:Sequelize.STRING(80),allowNull:false,defaultValue:'admin_workflow'},
      snapshot:{type:Sequelize.JSONB,allowNull:false,defaultValue:{}},
      createdAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')},
      updatedAt:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.literal('CURRENT_TIMESTAMP')}
    }, { transaction });
  }
  await addIndexIfMissing(queryInterface,'SchoolCurriculumAssignments',['schoolCode','assignmentVersion'],{unique:true,name:'uq_school_curriculum_assignment_version',transaction});
  await addIndexIfMissing(queryInterface,'SchoolCurriculumAssignments',['schoolCode','status'],{name:'idx_school_curriculum_assignment_status',transaction});
  await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_school_curriculum_one_active ON "SchoolCurriculumAssignments" ("schoolCode") WHERE status='active'`,{transaction});
}

async function addCanonicalColumns(queryInterface, Sequelize, transaction) {
  const add = async (table,column,definition) => {
    if (await tableExists(queryInterface,table) && !(await columnExists(queryInterface,table,column))) {
      await queryInterface.addColumn(table,column,definition,{transaction});
    }
  };
  await add('Schools','countryIsoCode',{type:Sequelize.CHAR(2),allowNull:true});
  await add('Schools','activeCurriculumPackId',{type:Sequelize.UUID,allowNull:true});
  await add('Schools','activeCurriculumAssignmentId',{type:Sequelize.UUID,allowNull:true});
  await add('Classes','curriculumPackId',{type:Sequelize.UUID,allowNull:true});
  await add('Classes','curriculumPackVersion',{type:Sequelize.STRING(80),allowNull:true});
  for (const [column,definition] of Object.entries({
    curriculumPackId:{type:Sequelize.UUID,allowNull:true}, curriculumPackVersion:{type:Sequelize.STRING(80),allowNull:true},
    curriculumOfficialCode:{type:Sequelize.STRING(80),allowNull:true}, countryIsoCode:{type:Sequelize.CHAR(2),allowNull:true},
    gradingProfileCode:{type:Sequelize.STRING(80),allowNull:true},gradingProfileVersion:{type:Sequelize.STRING(80),allowNull:true},
    curriculumSnapshot:{type:Sequelize.JSONB,allowNull:true},gradingSnapshot:{type:Sequelize.JSONB,allowNull:true},competencyEvidence:{type:Sequelize.JSONB,allowNull:true}
  })) await add('AcademicRecords',column,definition);
  await add('Payments','completionAuthority',{type:Sequelize.STRING(80),allowNull:true});
  await add('Payments','completionEvidence',{type:Sequelize.JSONB,allowNull:true});
  await add('Payments','completionCertifiedAt',{type:Sequelize.DATE,allowNull:true});
}

async function seedRegistry(queryInterface, transaction) {
  const db = queryInterface.sequelize;
  for (const country of COUNTRIES) {
    await db.query(`
      INSERT INTO "Countries" ("isoCode","iso3Code",name,"currencyCode",timezone,languages,region,"isSupported",metadata,"createdAt","updatedAt")
      VALUES (:isoCode,:iso3Code,:name,:currencyCode,:timezone,CAST(:languages AS jsonb),:region,:isSupported,CAST(:metadata AS jsonb),NOW(),NOW())
      ON CONFLICT ("isoCode") DO NOTHING
    `,{replacements:{...country,languages:JSON.stringify(country.languages),metadata:JSON.stringify(country.metadata)},transaction});
  }
  const jsonFields = ['educationStages','levels','subjectStructure','requiredSubjects','optionalSubjects','classNamingRules','streamGenerationRules','assessmentTypes','gradingProfiles','academicPathways','sourceReferences','metadata'];
  for (const source of CURRICULUM_PACKS) {
    const pack={...source,sourceChecksum:checksum(source)};
    const replacements={...pack};
    for (const field of jsonFields) replacements[field]=JSON.stringify(pack[field] ?? (field.endsWith('Rules')||field==='metadata'?{}:[]));
    await db.query(`
      INSERT INTO "CurriculumPacks"
        (id,"countryIsoCode","authorityName","authorityUrl",name,"officialCode","legacySystemCode",version,"effectiveFrom","effectiveTo",
         "educationStages",levels,"subjectStructure","requiredSubjects","optionalSubjects","classNamingRules","streamGenerationRules",
         "assessmentTypes","gradingProfiles","academicPathways","sourceReferences","sourceChecksum","reviewStatus","activationStatus","reviewNotes",metadata,"createdAt","updatedAt")
      VALUES
        (:id,:countryIsoCode,:authorityName,:authorityUrl,:name,:officialCode,:legacySystemCode,:version,:effectiveFrom,:effectiveTo,
         CAST(:educationStages AS jsonb),CAST(:levels AS jsonb),CAST(:subjectStructure AS jsonb),CAST(:requiredSubjects AS jsonb),CAST(:optionalSubjects AS jsonb),
         CAST(:classNamingRules AS jsonb),CAST(:streamGenerationRules AS jsonb),CAST(:assessmentTypes AS jsonb),CAST(:gradingProfiles AS jsonb),
         CAST(:academicPathways AS jsonb),CAST(:sourceReferences AS jsonb),:sourceChecksum,:reviewStatus,:activationStatus,:reviewNotes,CAST(:metadata AS jsonb),NOW(),NOW())
      ON CONFLICT (id) DO NOTHING
    `,{replacements,transaction});
  }
}

async function kenyaBackfill(queryInterface, transaction) {
  const db=queryInterface.sequelize;
  if (await tableExists(queryInterface,'SchemaRepairQuarantine')) {
    await db.query(`
      INSERT INTO "SchemaRepairQuarantine" ("sourceTable","sourceId","fieldName","legacyValue",reason,"quarantinedAt")
      SELECT 'Schools',s."schoolId",'system',NULL,
             'Legacy curriculum was null; v2045 retained the School model historical 8-4-4 default for the additive curriculum assignment',NOW()
        FROM "Schools" s
       WHERE s.system IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM "SchemaRepairQuarantine" q
            WHERE q."sourceTable"='Schools' AND q."sourceId"=s."schoolId" AND q."fieldName"='system'
         )
    `,{transaction});
  }
  await db.query(`UPDATE "Schools" SET "countryIsoCode"='KE' WHERE "countryIsoCode" IS NULL`,{transaction});
  const cases=Object.entries(LEGACY_SYSTEM_PACK_IDS).filter(([key])=>['cbc','844','british','american'].includes(key));
  const caseSql=cases.map(([key])=>`WHEN system::text=${db.escape(key)} THEN ${db.escape(LEGACY_SYSTEM_PACK_IDS[key])}::uuid`).join(' ');
  await db.query(`
    UPDATE "Schools"
       SET "activeCurriculumPackId"=CASE ${caseSql} ELSE ${db.escape(LEGACY_SYSTEM_PACK_IDS['844'])}::uuid END,
           "curriculumVersion"=COALESCE("curriculumVersion",'v2045-legacy-backfill-1')
     WHERE "activeCurriculumPackId" IS NULL
  `,{transaction});
  await db.query(`
    INSERT INTO "SchoolCurriculumAssignments"
      (id,"schoolCode","countryIsoCode","curriculumPackId","assignmentVersion","selectedStageCodes","enabledLevelCodes","selectedSubjectCodes",
       "selectedPathwayCodes","gradingProfileCode","classGenerationConfig",status,"effectiveFrom","changeReason",source,snapshot,"createdAt","updatedAt")
    SELECT (substr(md5('v2045-curriculum-'||s."schoolId"),1,8)||'-'||substr(md5('v2045-curriculum-'||s."schoolId"),9,4)||'-4'||
            substr(md5('v2045-curriculum-'||s."schoolId"),14,3)||'-8'||substr(md5('v2045-curriculum-'||s."schoolId"),18,3)||'-'||
            substr(md5('v2045-curriculum-'||s."schoolId"),21,12))::uuid,
           s."schoolId",s."countryIsoCode",s."activeCurriculumPackId",1,
           CASE WHEN jsonb_array_length(COALESCE(s.settings#>'{curriculumEngine,enabledLevelGroups}','[]'::jsonb))>0
                THEN s.settings#>'{curriculumEngine,enabledLevelGroups}'
                ELSE COALESCE((SELECT jsonb_agg(stage->>'code') FROM jsonb_array_elements(p."educationStages") stage),'[]'::jsonb) END,
           CASE WHEN jsonb_array_length(COALESCE(s."enabledLevels",'[]'::jsonb))>0
                THEN s."enabledLevels"
                ELSE COALESCE((SELECT jsonb_agg(level->>'code') FROM jsonb_array_elements(p.levels) level),'[]'::jsonb) END,
           CASE WHEN jsonb_array_length(COALESCE(s.settings#>'{curriculumEngine,schoolSubjects}','[]'::jsonb))>0
                THEN COALESCE((SELECT jsonb_agg(x->>'subjectId') FROM jsonb_array_elements(s.settings#>'{curriculumEngine,schoolSubjects}') x WHERE x->>'subjectId' IS NOT NULL),'[]'::jsonb)
                ELSE COALESCE((SELECT jsonb_agg(subject->>'id') FROM jsonb_array_elements(p."subjectStructure") subject WHERE subject->>'id' IS NOT NULL),'[]'::jsonb) END,
           '[]'::jsonb,
           CASE s.system::text WHEN 'cbc' THEN 'ke_cbc_competency_legacy' WHEN 'british' THEN 'cambridge_qualification_legacy' WHEN 'american' THEN 'american_gpa_legacy' ELSE 'ke_844_marks_legacy' END,
           COALESCE(s.settings->'classGeneration','{}'::jsonb),'active',NOW(),'Zero-data-loss v2045 Kenya/current-curriculum backfill','v2045_kenya_backfill',
           jsonb_build_object('legacySystem',s.system::text,'legacyCurriculumVersion',s."curriculumVersion",'backfilledAt',NOW()),NOW(),NOW()
      FROM "Schools" s
      JOIN "CurriculumPacks" p ON p.id=s."activeCurriculumPackId"
     WHERE NOT EXISTS (SELECT 1 FROM "SchoolCurriculumAssignments" a WHERE a."schoolCode"=s."schoolId" AND a.status='active')
  `,{transaction});
  await db.query(`
    UPDATE "Schools" s
       SET "activeCurriculumAssignmentId"=a.id
      FROM "SchoolCurriculumAssignments" a
     WHERE a."schoolCode"=s."schoolId" AND a.status='active' AND s."activeCurriculumAssignmentId" IS NULL
  `,{transaction});
  await db.query(`
    UPDATE "Classes" c
       SET "curriculumPackId"=s."activeCurriculumPackId",
           "curriculumPackVersion"=p.version
      FROM "Schools" s
      JOIN "CurriculumPacks" p ON p.id=s."activeCurriculumPackId"
     WHERE c."schoolCode"=s."schoolId"
       AND (c."curriculumPackId" IS NULL OR c."curriculumPackVersion" IS NULL)
  `,{transaction});
  await db.query(`
    WITH matches AS (
      SELECT c.id,matched.code,matched.label
        FROM "Classes" c
        JOIN "Schools" s ON c."schoolCode"=s."schoolId"
        JOIN "CurriculumPacks" p ON p.id=s."activeCurriculumPackId"
        CROSS JOIN LATERAL (
          SELECT level->>'code' AS code,level->>'label' AS label
            FROM jsonb_array_elements(p.levels) level
           WHERE lower(trim(level->>'label')) IN (lower(trim(c.grade)),lower(trim(c.name)))
              OR lower(trim(level->>'code')) IN (lower(trim(c.grade)),lower(trim(c.name)))
           ORDER BY CASE WHEN lower(trim(level->>'label'))=lower(trim(c.grade)) THEN 0 ELSE 1 END
           LIMIT 1
        ) matched
       WHERE c."levelCode" IS NULL
    )
    UPDATE "Classes" c
       SET "levelCode"=matches.code,"levelLabel"=COALESCE(c."levelLabel",matches.label)
      FROM matches
     WHERE c.id=matches.id
  `,{transaction});
}

async function addAndValidateRelations(queryInterface, transaction) {
  const definitions=[
    ['Schools','countryIsoCode','Countries','isoCode','fk_v2045_schools_country'],
    ['Schools','activeCurriculumPackId','CurriculumPacks','id','fk_v2045_schools_curriculum_pack'],
    ['Schools','activeCurriculumAssignmentId','SchoolCurriculumAssignments','id','fk_v2045_schools_curriculum_assignment'],
    ['Classes','curriculumPackId','CurriculumPacks','id','fk_v2045_classes_curriculum_pack'],
    ['AcademicRecords','curriculumPackId','CurriculumPacks','id','fk_v2045_academic_curriculum_pack']
  ];
  for (const [table,column,target,targetColumn,name] of definitions) {
    await addConstraintIfMissing(queryInterface,table,{fields:[column],type:'foreign key',name,references:{table:target,field:targetColumn},onUpdate:'CASCADE',onDelete:'RESTRICT',transaction});
  }
}

async function recordIntegrity(queryInterface,before,after,digestBefore,digestAfter,transaction) {
  const mismatches=Object.keys(before).filter(table=>before[table]!==after[table]);
  if (digestBefore!==digestAfter) mismatches.push('AcademicRecords:legacy_digest');
  if (await tableExists(queryInterface,'MigrationIntegrityChecks')) {
    await queryInterface.sequelize.query(`
      INSERT INTO "MigrationIntegrityChecks" ("migrationKey",status,"countsBefore","countsAfter","mismatchTables","verifiedAt")
      VALUES (:key,:status,CAST(:before AS jsonb),CAST(:after AS jsonb),CAST(:mismatches AS jsonb),NOW())
      ON CONFLICT ("migrationKey") DO UPDATE SET status=EXCLUDED.status,"countsBefore"=EXCLUDED."countsBefore","countsAfter"=EXCLUDED."countsAfter","mismatchTables"=EXCLUDED."mismatchTables","verifiedAt"=EXCLUDED."verifiedAt"
    `,{replacements:{key:MIGRATION_KEY,status:mismatches.length?'failed':'verified',before:JSON.stringify(before),after:JSON.stringify(after),mismatches:JSON.stringify(mismatches)},transaction});
  }
  if (mismatches.length) throw new Error(`v2045 zero-data-loss gate failed: ${mismatches.join(', ')}`);
}

async function up(queryInterface,Sequelize) {
  const before=await counts(queryInterface);
  const digestBefore=await academicLegacyDigest(queryInterface);
  await queryInterface.sequelize.transaction(async transaction=>{
    await createCanonicalTables(queryInterface,Sequelize,transaction);
    await addCanonicalColumns(queryInterface,Sequelize,transaction);
    await seedRegistry(queryInterface,transaction);
    await kenyaBackfill(queryInterface,transaction);
    await addAndValidateRelations(queryInterface,transaction);
    const after=await counts(queryInterface);
    const digestAfter=await academicLegacyDigest(queryInterface);
    await recordIntegrity(queryInterface,before,after,digestBefore,digestAfter,transaction);
  });
}

async function down(queryInterface) {
  const db=queryInterface.sequelize;
  if (await tableExists(queryInterface,'SchoolCurriculumAssignments')) {
    const [rows]=await db.query(`SELECT COUNT(*)::int AS count FROM "SchoolCurriculumAssignments" WHERE source<>'v2045_kenya_backfill'`);
    if (Number(rows?.[0]?.count||0)>0) throw new Error('Unsafe rollback refused: curriculum assignments created after the v2045 backfill exist. Apply a reviewed forward-repair or restore the verified pre-v2045 backup.');
  }
  if (await tableExists(queryInterface,'AcademicRecords') && await columnExists(queryInterface,'AcademicRecords','curriculumSnapshot')) {
    const [rows]=await db.query(`SELECT COUNT(*)::int AS count FROM "AcademicRecords" WHERE "curriculumSnapshot" IS NOT NULL OR "gradingSnapshot" IS NOT NULL`);
    if (Number(rows?.[0]?.count||0)>0) throw new Error('Unsafe rollback refused: v2045 assessment snapshots exist. Restore the verified pre-v2045 backup or apply a forward-repair.');
  }
  if (await tableExists(queryInterface,'Payments') && await columnExists(queryInterface,'Payments','completionCertifiedAt')) {
    const [rows]=await queryInterface.sequelize.query(`SELECT COUNT(*)::int AS count FROM "Payments" WHERE "completionCertifiedAt" IS NOT NULL`);
    if (Number(rows?.[0]?.count||0)>0) throw new Error('Unsafe rollback refused: v2045 certified payment completions exist. Restore the verified pre-v2045 backup or apply a forward-repair.');
  }
  for (const [table,column] of [
    ['AcademicRecords','competencyEvidence'],['AcademicRecords','gradingSnapshot'],['AcademicRecords','curriculumSnapshot'],
    ['AcademicRecords','gradingProfileVersion'],['AcademicRecords','gradingProfileCode'],['AcademicRecords','countryIsoCode'],
    ['AcademicRecords','curriculumOfficialCode'],['AcademicRecords','curriculumPackVersion'],['AcademicRecords','curriculumPackId'],
    ['Classes','curriculumPackVersion'],['Classes','curriculumPackId'],['Schools','activeCurriculumAssignmentId'],
    ['Schools','activeCurriculumPackId'],['Schools','countryIsoCode']
  ]) if (await columnExists(queryInterface,table,column)) await queryInterface.removeColumn(table,column);
  for (const column of ['completionCertifiedAt','completionEvidence','completionAuthority']) if (await columnExists(queryInterface,'Payments',column)) await queryInterface.removeColumn('Payments',column);
  for (const table of ['SchoolCurriculumAssignments','SchoolGradingProfiles','CurriculumPacks','Countries']) if (await tableExists(queryInterface,table)) await queryInterface.dropTable(table);
  for (const type of ['enum_SchoolCurriculumAssignments_status','enum_SchoolGradingProfiles_status','enum_CurriculumPacks_activationStatus','enum_CurriculumPacks_reviewStatus']) await db.query(`DROP TYPE IF EXISTS ${q(type)}`);
}

module.exports={up,down,forwardRepair:up,MIGRATION_KEY};
