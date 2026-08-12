'use strict';

const quote = value => `"${String(value).replace(/"/g, '""')}"`;

async function tableExists(queryInterface, table) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT to_regclass(:name) AS regclass',
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

async function counts(queryInterface, tables) {
  const result = {};
  for (const table of tables) {
    if (!(await tableExists(queryInterface, table))) continue;
    const [rows] = await queryInterface.sequelize.query(
      `SELECT COUNT(*)::bigint::text AS count FROM ${quote(table)}`
    );
    result[table] = String(rows?.[0]?.count || '0');
  }
  return result;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const protectedTables = [
      'Schools', 'Users', 'Students', 'Classes', 'Parents', 'StudentParents',
      'Attendances', 'Fees', 'FeeInvoices', 'Payments', 'AcademicRecords'
    ];
    const before = await counts(queryInterface, protectedTables);

    // Forward-repair installations that recorded the first v2044 migration
    // before its quoted-table lookup was corrected. The canonical repair is
    // idempotent and now applies the tenant/entity constraints it originally
    // intended without deleting any source rows.
    const canonicalRepair = require('./20260807000000-v2044-integrated-audit-repair');
    await canonicalRepair.up(queryInterface, Sequelize);

    if (await tableExists(queryInterface, 'PlatformBackups')
        && !(await columnExists(queryInterface, 'PlatformBackups', 'failedAt'))) {
      await queryInterface.addColumn('PlatformBackups', 'failedAt', { type: Sequelize.DATE, allowNull: true });
    }

    if (await tableExists(queryInterface, 'AbsenceReports')) {
      if (!(await columnExists(queryInterface, 'AbsenceReports', 'reviewedBy'))) {
        await queryInterface.addColumn('AbsenceReports', 'reviewedBy', { type: Sequelize.INTEGER, allowNull: true });
      }
      if (await columnExists(queryInterface, 'AbsenceReports', 'reviewedByUserId')) {
        await queryInterface.sequelize.query(`
          UPDATE "AbsenceReports"
             SET "reviewedBy"=COALESCE("reviewedBy","reviewedByUserId")
           WHERE "reviewedBy" IS NULL AND "reviewedByUserId" IS NOT NULL
        `);
      }

      const [orphans] = await queryInterface.sequelize.query(`
        SELECT COUNT(*)::int AS count
          FROM "AbsenceReports" report
          LEFT JOIN "Users" reviewer ON reviewer.id=report."reviewedBy"
         WHERE report."reviewedBy" IS NOT NULL AND reviewer.id IS NULL
      `);
      const orphanCount = Number(orphans?.[0]?.count || 0);
      if (orphanCount && await tableExists(queryInterface, 'SchemaRepairQuarantine')) {
        await queryInterface.sequelize.query(`
          INSERT INTO "SchemaRepairQuarantine"
            ("sourceTable","sourceId","fieldName","legacyValue",reason,"quarantinedAt")
          SELECT 'AbsenceReports',report.id::text,'reviewedBy',report."reviewedBy"::text,
                 'Orphaned absence-review user retained for data-steward review',NOW()
            FROM "AbsenceReports" report
            LEFT JOIN "Users" reviewer ON reviewer.id=report."reviewedBy"
           WHERE report."reviewedBy" IS NOT NULL AND reviewer.id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM "SchemaRepairQuarantine" quarantine
                WHERE quarantine."sourceTable"='AbsenceReports'
                  AND quarantine."sourceId"=report.id::text
                  AND quarantine."fieldName"='reviewedBy'
                  AND quarantine."legacyValue"=report."reviewedBy"::text
             )
        `);
      }

      const [constraint] = await queryInterface.sequelize.query(`
        SELECT convalidated
          FROM pg_constraint
         WHERE conname='fk_v2044_absence_reports_reviewed_by'
         LIMIT 1
      `);
      if (!constraint.length) {
        await queryInterface.sequelize.query(`
          ALTER TABLE "AbsenceReports"
          ADD CONSTRAINT "fk_v2044_absence_reports_reviewed_by"
          FOREIGN KEY ("reviewedBy") REFERENCES "Users"(id)
          ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID
        `);
      }
      if (!orphanCount) {
        await queryInterface.sequelize.query(`
          ALTER TABLE "AbsenceReports"
          VALIDATE CONSTRAINT "fk_v2044_absence_reports_reviewed_by"
        `);
      } else {
        console.warn(`[v2044] AbsenceReports.reviewedBy has ${orphanCount} retained orphan rows; new writes are protected and validation is deferred.`);
      }
    }

    const after = await counts(queryInterface, protectedTables);
    const mismatches = Object.keys(before).filter(table => before[table] !== after[table]);
    if (await tableExists(queryInterface, 'MigrationIntegrityChecks')) {
      await queryInterface.sequelize.query(`
        INSERT INTO "MigrationIntegrityChecks"
          ("migrationKey",status,"countsBefore","countsAfter","mismatchTables","verifiedAt")
        VALUES (:key,:status,CAST(:before AS jsonb),CAST(:after AS jsonb),CAST(:mismatches AS jsonb),NOW())
        ON CONFLICT ("migrationKey") DO UPDATE SET
          status=EXCLUDED.status,
          "countsBefore"=EXCLUDED."countsBefore",
          "countsAfter"=EXCLUDED."countsAfter",
          "mismatchTables"=EXCLUDED."mismatchTables",
          "verifiedAt"=EXCLUDED."verifiedAt"
      `, {
        replacements: {
          key: '20260810000000-v2044-final-integrity-closure',
          status: mismatches.length ? 'failed' : 'verified',
          before: JSON.stringify(before),
          after: JSON.stringify(after),
          mismatches: JSON.stringify(mismatches)
        }
      });
    }
    if (mismatches.length) {
      throw new Error(`v2044 final zero-data-loss gate failed for: ${mismatches.join(', ')}`);
    }
  },

  async down() {
    throw new Error('This integrity closure is forward-only. Restore the verified pre-deployment backup or apply an explicitly reviewed forward-repair migration.');
  }
};
