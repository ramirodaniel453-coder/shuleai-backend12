'use strict';

/**
 * Read-only post-migration certification for a protected v2045 staging clone.
 * The migration owns before/after capture. This script verifies the recorded
 * evidence and the canonical state after backend deployment/restart.
 */
const assert = require('node:assert/strict');
const sequelize = require('../src/config/database');

const MIGRATION_KEY = '20260811000000-v2045-country-curriculum-academic-lock';
const EXPECTED_COUNTRIES = ['BI','CD','KE','NG','RW','SO','SS','TZ','UG'];

async function scalar(sql, replacements = {}) {
  const [rows] = await sequelize.query(sql, { replacements });
  return rows[0];
}

async function main() {
  assert.ok(process.env.DATABASE_URL || (process.env.DB_NAME && process.env.DB_USER), 'A staging PostgreSQL connection is required');
  assert.notEqual(process.env.NODE_ENV, 'production', 'This certification command is staging-only and refuses NODE_ENV=production');
  await sequelize.authenticate();

  const integrity = await scalar(`
    SELECT status,"countsBefore","countsAfter","mismatchTables","verifiedAt"
      FROM "MigrationIntegrityChecks"
     WHERE "migrationKey"=:key
  `, { key:MIGRATION_KEY });
  assert.ok(integrity, 'v2045 MigrationIntegrityChecks evidence is missing');
  assert.equal(integrity.status, 'verified');
  assert.deepEqual(integrity.countsBefore, integrity.countsAfter, 'Protected production record counts changed');
  assert.deepEqual(integrity.mismatchTables || [], [], 'Migration recorded count or academic-history mismatches');

  const [countries] = await sequelize.query(`SELECT "isoCode" FROM "Countries" WHERE "isSupported"=TRUE ORDER BY "isoCode"`);
  assert.deepEqual(countries.map(row => row.isoCode), EXPECTED_COUNTRIES);

  const schoolState = await scalar(`
    SELECT COUNT(*) FILTER (WHERE "countryIsoCode" IS NULL)::int AS "missingCountry",
           COUNT(*) FILTER (WHERE "activeCurriculumPackId" IS NULL)::int AS "missingPack",
           COUNT(*) FILTER (WHERE "activeCurriculumAssignmentId" IS NULL)::int AS "missingAssignment"
      FROM "Schools"
  `);
  assert.deepEqual(schoolState, { missingCountry:0, missingPack:0, missingAssignment:0 });

  const badAssignment = await scalar(`
    SELECT COUNT(*)::int AS count
      FROM "SchoolCurriculumAssignments" a
      JOIN "CurriculumPacks" p ON p.id=a."curriculumPackId"
     WHERE a.status='active' AND (a."countryIsoCode"<>p."countryIsoCode" OR p."activationStatus"<>'active' OR p."reviewStatus" NOT IN ('reviewed','legacy_active'))
  `);
  assert.equal(badAssignment.count, 0, 'An active school assignment uses a wrong-country or unreviewed pack');

  const activeCardinality = await scalar(`
    SELECT COUNT(*)::int AS count FROM (
      SELECT s."schoolId"
        FROM "Schools" s
        LEFT JOIN "SchoolCurriculumAssignments" a ON a."schoolCode"=s."schoolId" AND a.status='active'
       GROUP BY s."schoolId"
      HAVING COUNT(a.id)<>1
    ) invalid
  `);
  assert.equal(activeCardinality.count, 0, 'A school does not have exactly one active curriculum assignment');

  const newRecordsWithoutSnapshots = await scalar(`
    SELECT COUNT(*)::int AS count
      FROM "AcademicRecords"
     WHERE "createdAt">:verifiedAt
       AND ("curriculumPackId" IS NULL OR "curriculumSnapshot" IS NULL OR "gradingSnapshot" IS NULL OR grade IS NULL)
  `, { verifiedAt:integrity.verifiedAt });
  assert.equal(newRecordsWithoutSnapshots.count, 0, 'A post-v2045 academic record lacks its immutable curriculum/grading snapshot');

  const uncertifiedCompletions = await scalar(`
    SELECT COUNT(*)::int AS count
      FROM "Payments"
     WHERE status='completed' AND "completedAt">:verifiedAt
       AND ("completionAuthority" IS NULL OR "completionEvidence" IS NULL OR "completionCertifiedAt" IS NULL)
  `, { verifiedAt:integrity.verifiedAt });
  assert.equal(uncertifiedCompletions.count, 0, 'A post-v2045 payment completion lacks backend certification evidence');

  process.stdout.write(`${JSON.stringify({
    gate:'v2045_database_certification',
    status:'pass',
    migrationKey:MIGRATION_KEY,
    protectedCounts:integrity.countsAfter,
    countries:EXPECTED_COUNTRIES,
    verifiedAt:new Date().toISOString()
  }, null, 2)}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`[v2045-database-certification] FAIL: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
