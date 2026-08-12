'use strict';

/*
 * v2044 integrated audit repair.
 * This migration is intentionally forward-only because it adds integrity
 * constraints and security/audit state that must not be silently discarded.
 */

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function tableExists(queryInterface, table) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT to_regclass(:name) AS regclass`,
    { replacements: { name: `public."${String(table).replace(/"/g, '""')}"` } }
  );
  return Boolean(rows?.[0]?.regclass);
}

async function columnExists(queryInterface, table, column) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name=:table AND column_name=:column
     LIMIT 1
  `, { replacements: { table, column } });
  return rows.length > 0;
}

async function addColumnIfMissing(queryInterface, table, column, definition) {
  if (await tableExists(queryInterface, table) && !(await columnExists(queryInterface, table, column))) {
    await queryInterface.addColumn(table, column, definition);
  }
}

async function addFkIfClean(queryInterface, table, column, targetTable, targetColumn, options = {}) {
  if (!(await tableExists(queryInterface, table)) || !(await tableExists(queryInterface, targetTable))) return;
  if (!(await columnExists(queryInterface, table, column)) || !(await columnExists(queryInterface, targetTable, targetColumn))) return;

  const safeName = `fk_v2044_${table}_${column}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 58);
  const [existing] = await queryInterface.sequelize.query(`
    SELECT c.convalidated FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname=:table AND c.conname=:name
    LIMIT 1
  `, { replacements: { table, name: safeName } });
  const [bad] = await queryInterface.sequelize.query(`
    SELECT COUNT(*)::int AS n
      FROM ${q(table)} s
      LEFT JOIN ${q(targetTable)} t ON t.${q(targetColumn)} = s.${q(column)}
     WHERE s.${q(column)} IS NOT NULL AND t.${q(targetColumn)} IS NULL
  `);
  const orphanCount = Number(bad?.[0]?.n || 0);
  if (orphanCount !== 0) {
    if (await tableExists(queryInterface, 'SchemaRepairQuarantine')) {
      const sourceId = await columnExists(queryInterface, table, 'id') ? `s.${q('id')}::text` : 's.ctid::text';
      await queryInterface.sequelize.query(`
        INSERT INTO "SchemaRepairQuarantine"
          ("sourceTable","sourceId","fieldName","legacyValue",reason,"quarantinedAt")
        SELECT :sourceTable, ${sourceId}, :fieldName, s.${q(column)}::text,
               :reason, NOW()
          FROM ${q(table)} s
          LEFT JOIN ${q(targetTable)} t ON t.${q(targetColumn)} = s.${q(column)}
         WHERE s.${q(column)} IS NOT NULL
           AND t.${q(targetColumn)} IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM "SchemaRepairQuarantine" quarantine
              WHERE quarantine."sourceTable"=:sourceTable
                AND quarantine."sourceId"=${sourceId}
                AND quarantine."fieldName"=:fieldName
                AND quarantine."legacyValue"=s.${q(column)}::text
           )
      `, {
        replacements: {
          sourceTable: table,
          fieldName: column,
          reason: `Orphaned relation ${table}.${column} -> ${targetTable}.${targetColumn}; source row retained for data-steward review`
        }
      });
    }
    if (!existing.length) {
      await queryInterface.sequelize.query(`
        ALTER TABLE ${q(table)}
          ADD CONSTRAINT ${q(safeName)} FOREIGN KEY (${q(column)})
          REFERENCES ${q(targetTable)} (${q(targetColumn)})
          ON UPDATE ${options.onUpdate || 'CASCADE'}
          ON DELETE ${options.onDelete || 'RESTRICT'}
          NOT VALID
      `);
    }
    console.warn(`[v2044] FK ${table}.${column} -> ${targetTable}.${targetColumn} protects new writes but validation is deferred: ${orphanCount} retained orphan rows were quarantined for review.`);
    return;
  }

  if (!existing.length) {
    await queryInterface.sequelize.query(`
      ALTER TABLE ${q(table)}
        ADD CONSTRAINT ${q(safeName)} FOREIGN KEY (${q(column)})
        REFERENCES ${q(targetTable)} (${q(targetColumn)})
        ON UPDATE ${options.onUpdate || 'CASCADE'}
        ON DELETE ${options.onDelete || 'RESTRICT'}
        NOT VALID
    `);
  }
  await queryInterface.sequelize.query(`ALTER TABLE ${q(table)} VALIDATE CONSTRAINT ${q(safeName)}`);
}

async function protectedCounts(queryInterface, tables) {
  const counts = {};
  for (const table of tables) {
    if (!(await tableExists(queryInterface, table))) continue;
    const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*)::bigint::text AS count FROM ${q(table)}`);
    counts[table] = String(rows?.[0]?.count || '0');
  }
  return counts;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    const protectedTables = [
      'Schools', 'Users', 'Students', 'Classes', 'Parents', 'StudentParents',
      'Attendances', 'Fees', 'FeeInvoices', 'Payments', 'AcademicRecords'
    ];
    const countsBefore = await protectedCounts(queryInterface, protectedTables);

    // Canonical platform control state (CR-01).
    if (!(await tableExists(queryInterface, 'PlatformSettings'))) {
      await queryInterface.createTable('PlatformSettings', {
        id: { type: Sequelize.INTEGER, primaryKey: true, allowNull: false },
        platformName: { type: Sequelize.STRING(120), allowNull: false, defaultValue: 'ShuleAI' },
        defaultCurriculum: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'cbc' },
        nameChangeFee: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 50 },
        maintenanceMode: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        allowNewRegistrations: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        contactEmail: { type: Sequelize.STRING(254), allowNull: false, defaultValue: 'support@shuleai.com' },
        supportPhone: { type: Sequelize.STRING(40), allowNull: true },
        updatedBy: { type: Sequelize.INTEGER, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }
    await db.query(`
      INSERT INTO "PlatformSettings" (id,"platformName","defaultCurriculum","nameChangeFee","maintenanceMode","allowNewRegistrations","createdAt","updatedAt")
      VALUES (1,'ShuleAI','cbc',50,false,true,NOW(),NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // Real backup job state (CR-02).
    if (!(await tableExists(queryInterface, 'PlatformBackups'))) {
      await queryInterface.createTable('PlatformBackups', {
        id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
        status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'queued' },
        requestedBy: { type: Sequelize.INTEGER, allowNull: false },
        jobId: { type: Sequelize.UUID, allowNull: true },
        filename: { type: Sequelize.STRING(255), allowNull: true },
        storageProvider: { type: Sequelize.STRING(50), allowNull: true },
        storageUrl: { type: Sequelize.TEXT, allowNull: true },
        checksum: { type: Sequelize.STRING(128), allowNull: true },
        byteSize: { type: Sequelize.BIGINT, allowNull: true },
        archiveVerifiedAt: { type: Sequelize.DATE, allowNull: true },
        restoreVerifiedAt: { type: Sequelize.DATE, allowNull: true },
        verificationDetails: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        error: { type: Sequelize.TEXT, allowNull: true },
        startedAt: { type: Sequelize.DATE, allowNull: true },
        completedAt: { type: Sequelize.DATE, allowNull: true },
        failedAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('PlatformBackups', ['status', 'createdAt'], { name: 'idx_platform_backups_status_created' });
    }
    await addColumnIfMissing(queryInterface, 'PlatformBackups', 'restoreVerifiedAt', {
      type: Sequelize.DATE, allowNull: true
    });
    await addColumnIfMissing(queryInterface, 'PlatformBackups', 'failedAt', {
      type: Sequelize.DATE, allowNull: true
    });

    // Parent absence reports no longer mutate Attendance directly (CR-05).
    if (!(await tableExists(queryInterface, 'AbsenceReports'))) {
      await queryInterface.createTable('AbsenceReports', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        schoolCode: { type: Sequelize.STRING, allowNull: false },
        studentId: { type: Sequelize.INTEGER, allowNull: false },
        parentId: { type: Sequelize.INTEGER, allowNull: false },
        classId: { type: Sequelize.INTEGER, allowNull: true },
        startDate: { type: Sequelize.DATEONLY, allowNull: false },
        endDate: { type: Sequelize.DATEONLY, allowNull: false },
        reason: { type: Sequelize.TEXT, allowNull: false },
        status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'reported' },
        reportedByUserId: { type: Sequelize.INTEGER, allowNull: false },
        reviewedBy: { type: Sequelize.INTEGER, allowNull: true },
        reviewedAt: { type: Sequelize.DATE, allowNull: true },
        reviewNote: { type: Sequelize.TEXT, allowNull: true },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('AbsenceReports', ['schoolCode', 'status', 'createdAt'], { name: 'idx_absence_reports_school_status' });
      await queryInterface.addIndex('AbsenceReports', ['studentId', 'startDate', 'endDate'], { name: 'idx_absence_reports_student_dates' });
    }

    // Revocable access/refresh sessions (MO-03).
    await addColumnIfMissing(queryInterface, 'Users', 'tokenVersion', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 0
    });

    // Auditable LearnFeed verification (CR-06).
    await addColumnIfMissing(queryInterface, 'LearnFeedUsers', 'requestedRole', {
      type: Sequelize.STRING(30), allowNull: false, defaultValue: 'student'
    });
    await addColumnIfMissing(queryInterface, 'LearnFeedUsers', 'verificationStatus', {
      type: Sequelize.STRING(30), allowNull: false, defaultValue: 'unverified'
    });
    await addColumnIfMissing(queryInterface, 'LearnFeedUsers', 'verifiedAt', {
      type: Sequelize.DATE, allowNull: true
    });
    await addColumnIfMissing(queryInterface, 'LearnFeedUsers', 'verifiedBy', {
      type: Sequelize.INTEGER, allowNull: true
    });
    await addColumnIfMissing(queryInterface, 'LearnFeedUsers', 'verificationProof', {
      type: Sequelize.JSONB, allowNull: false, defaultValue: {}
    });
    await addColumnIfMissing(queryInterface, 'LearnFeedUsers', 'tokenVersion', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 0
    });
    if (await tableExists(queryInterface, 'LearnFeedUsers')) {
      await db.query(`
        UPDATE "LearnFeedUsers"
           SET "requestedRole"='teacher',
               "verificationStatus"='pending',
               "verifiedAt"=NULL,
               "verifiedBy"=NULL,
               role='student',
               "updatedAt"=NOW()
         WHERE role='teacher'
           AND COALESCE("verificationStatus",'unverified') <> 'verified'
      `);
    }

    // Platform logs/jobs may legitimately have no tenant.
    if (await columnExists(queryInterface, 'AuditLogs', 'schoolCode')) {
      await queryInterface.changeColumn('AuditLogs', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    }
    if (await columnExists(queryInterface, 'BackgroundJobs', 'schoolCode')) {
      await queryInterface.changeColumn('BackgroundJobs', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    }

    // FeeStructure association type repair (MO-05), preserving invalid legacy values for review.
    if (!(await tableExists(queryInterface, 'SchemaRepairQuarantine'))) {
      await queryInterface.createTable('SchemaRepairQuarantine', {
        id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
        sourceTable: { type: Sequelize.STRING(100), allowNull: false },
        sourceId: { type: Sequelize.STRING(120), allowNull: true },
        fieldName: { type: Sequelize.STRING(100), allowNull: false },
        legacyValue: { type: Sequelize.TEXT, allowNull: true },
        reason: { type: Sequelize.TEXT, allowNull: false },
        quarantinedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }
    for (const table of ['Fees', 'Payments', 'FeeInvoices']) {
      if (!(await tableExists(queryInterface, table)) || !(await columnExists(queryInterface, table, 'feeStructureId'))) continue;
      await db.query(`
        INSERT INTO "SchemaRepairQuarantine" ("sourceTable","sourceId","fieldName","legacyValue",reason,"quarantinedAt")
        SELECT :table, id::text, 'feeStructureId', "feeStructureId"::text,
               'Not a valid numeric FeeStructures.id', NOW()
          FROM ${q(table)}
         WHERE "feeStructureId" IS NOT NULL
           AND ("feeStructureId"::text !~ '^[0-9]+$'
                OR NOT EXISTS (SELECT 1 FROM "FeeStructures" fs WHERE fs.id::text = ${q(table)}."feeStructureId"::text))
      `, { replacements: { table } });
      await db.query(`
        UPDATE ${q(table)}
           SET "feeStructureId"=NULL
         WHERE "feeStructureId" IS NOT NULL
           AND ("feeStructureId"::text !~ '^[0-9]+$'
                OR NOT EXISTS (SELECT 1 FROM "FeeStructures" fs WHERE fs.id::text = ${q(table)}."feeStructureId"::text))
      `);
      await db.query(`
        ALTER TABLE ${q(table)}
        ALTER COLUMN "feeStructureId" TYPE INTEGER
        USING CASE WHEN "feeStructureId" IS NULL THEN NULL ELSE "feeStructureId"::integer END
      `);
    }

    // Database-enforced tenant boundary (MO-06). Only validate/add when current data is clean;
    // dirty rows are never deleted or silently rewritten by this migration.
    const [tenantTables] = await db.query(`
      SELECT table_name
        FROM information_schema.columns
       WHERE table_schema='public'
         AND column_name='schoolCode'
         AND table_name <> 'Schools'
       ORDER BY table_name
    `);
    for (const row of tenantTables) {
      await addFkIfClean(queryInterface, row.table_name, 'schoolCode', 'Schools', 'schoolId', { onDelete: 'RESTRICT' });
    }

    // High-confidence local relations from the audit (MO-07). Ambiguous/polymorphic identifiers
    // are deliberately not guessed; their model fields are documented separately in source.
    const relations = [
      ['Students','activeEnrollmentId','StudentEnrollments','id'],
      ['AcademicRecords','classId','Classes','id'],
      ['Attendances','classId','Classes','id'],
      ['Fees','classId','Classes','id'],
      ['FeeStructures','classId','Classes','id'],
      ['Fees','feeStructureId','FeeStructures','id'],
      ['Payments','feeStructureId','FeeStructures','id'],
      ['FeeInvoices','feeStructureId','FeeStructures','id'],
      ['Payments','subscriptionPaymentId','SubscriptionPayments','id'],
      ['Payments','subscriptionId','Subscriptions','id'],
      ['Alerts','targetUserId','Users','id'],
      ['Alerts','studentId','Students','id'],
      ['Alerts','classId','Classes','id'],
      ['HomeTasks','createdByUserId','Users','id'],
      ['HomeTasks','classId','Classes','id'],
      ['HomeTasks','studyThreadId','ClassroomThreads','id'],
      ['HomeTaskAssignments','classId','Classes','id'],
      ['SchoolCalendars','classId','Classes','id'],
      ['SchoolCalendars','createdByUserId','Users','id'],
      ['ConductLogs','studentId','Students','id'],
      ['ConductLogs','teacherId','Teachers','id'],
      ['ResourceViews','userId','Users','id'],
      ['MoodCheckins','userId','Users','id'],
      ['Timetables','supersedesId','Timetables','id'],
      ['Departments','headTeacherId','Teachers','id'],
      ['TutorMessages','userId','Users','id'],
      ['TutorUsages','subscriptionId','Subscriptions','id'],
      ['AuditLogs','actorUserId','Users','id'],
      ['ReportSnapshots','classId','Classes','id'],
      ['ReportSnapshots','supersedesId','ReportSnapshots','id'],
      ['Subscriptions','lastPaymentId','Payments','id'],
      ['AttendanceCorrections','studentId','Students','id'],
      ['StudentEnrollments','movementRequestId','ClassTransferRequests','id'],
      ['StudentEnrollments','previousEnrollmentId','StudentEnrollments','id'],
      ['PromotionDecisions','currentEnrollmentId','StudentEnrollments','id'],
      ['PromotionDecisions','fromClassId','Classes','id'],
      ['PromotionDecisions','toClassId','Classes','id'],
      ['PromotionDecisions','appliedEnrollmentId','StudentEnrollments','id'],
      ['ReportShares','recipientUserId','Users','id'],
      ['MediaAssets','ownerUserId','Users','id'],
      ['FeeInvoices','parentId','Parents','id'],
      ['FeeInvoiceItems','studentId','Students','id'],
      ['PaymentTransactions','parentId','Parents','id'],
      ['ProviderCredentialsAudits','actorUserId','Users','id'],
      ['PaymentReconciliations','legacyPaymentId','Payments','id'],
      ['PaymentRefunds','legacyPaymentId','Payments','id'],
      ['LearnFeedUsers','verifiedBy','Users','id'],
      ['LearnFeedUsers','linkedElimuId','Students','elimuid'],
      ['LearnFeedSubscriptionPayments','learnFeedId','LearnFeedUsers','learnFeedId'],
      ['AbsenceReports','schoolCode','Schools','schoolId'],
      ['AbsenceReports','studentId','Students','id'],
      ['AbsenceReports','parentId','Parents','id'],
      ['AbsenceReports','classId','Classes','id'],
      ['AbsenceReports','reportedByUserId','Users','id'],
      ['AbsenceReports','reviewedBy','Users','id'],
      ['PlatformSettings','updatedBy','Users','id'],
      ['PlatformBackups','requestedBy','Users','id'],
      ['PlatformBackups','jobId','BackgroundJobs','id']
    ];
    for (const rel of relations) {
      await addFkIfClean(queryInterface, rel[0], rel[1], rel[2], rel[3], { onDelete: 'RESTRICT' });
    }

    // Zero-data-loss gate. Schema work may backfill or quarantine values, but it
    // must never add or remove production entity rows from the locked tables.
    const countsAfter = await protectedCounts(queryInterface, protectedTables);
    const mismatches = Object.keys(countsBefore).filter(table => countsBefore[table] !== countsAfter[table]);
    if (!(await tableExists(queryInterface, 'MigrationIntegrityChecks'))) {
      await queryInterface.createTable('MigrationIntegrityChecks', {
        migrationKey: { type: Sequelize.STRING(120), primaryKey: true, allowNull: false },
        status: { type: Sequelize.STRING(30), allowNull: false },
        countsBefore: { type: Sequelize.JSONB, allowNull: false },
        countsAfter: { type: Sequelize.JSONB, allowNull: false },
        mismatchTables: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        verifiedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }
    await db.query(`
      INSERT INTO "MigrationIntegrityChecks"
        ("migrationKey",status,"countsBefore","countsAfter","mismatchTables","verifiedAt")
      VALUES (:migrationKey,:status,CAST(:countsBefore AS jsonb),CAST(:countsAfter AS jsonb),CAST(:mismatches AS jsonb),NOW())
      ON CONFLICT ("migrationKey") DO UPDATE SET
        status=EXCLUDED.status,
        "countsBefore"=EXCLUDED."countsBefore",
        "countsAfter"=EXCLUDED."countsAfter",
        "mismatchTables"=EXCLUDED."mismatchTables",
        "verifiedAt"=EXCLUDED."verifiedAt"
    `, {
      replacements: {
        migrationKey: '20260807000000-v2044-integrated-audit-repair',
        status: mismatches.length ? 'failed' : 'verified',
        countsBefore: JSON.stringify(countsBefore),
        countsAfter: JSON.stringify(countsAfter),
        mismatches: JSON.stringify(mismatches)
      }
    });
    if (mismatches.length) {
      throw new Error(`v2044 zero-data-loss gate failed for row counts: ${mismatches.join(', ')}`);
    }
  },

  async down() {
    throw new Error('v2044 integrated audit repair is intentionally irreversible. Restore a verified pre-v2044 database backup or apply a reviewed forward-fix migration.');
  }
};
