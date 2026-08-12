'use strict';
const { sequelize } = require('../models');

async function findBadLinks() {
  const rows = await sequelize.query(`
    SELECT sp."studentId", sp."parentId", sp."createdAt", sp."updatedAt",
           s."id" AS "realStudentId", p."id" AS "realParentId",
           su."schoolCode" AS "studentSchoolCode", pu."schoolCode" AS "parentSchoolCode",
           CASE
             WHEN s."id" IS NULL THEN 'missing_student'
             WHEN p."id" IS NULL THEN 'missing_parent'
             WHEN su."schoolCode" IS DISTINCT FROM pu."schoolCode" THEN 'cross_school_link'
             ELSE NULL
           END AS reason
      FROM "StudentParents" sp
      LEFT JOIN "Students" s ON s."id" = sp."studentId"
      LEFT JOIN "Parents" p ON p."id" = sp."parentId"
      LEFT JOIN "Users" su ON su."id" = s."userId"
      LEFT JOIN "Users" pu ON pu."id" = p."userId"
     WHERE s."id" IS NULL OR p."id" IS NULL OR su."schoolCode" IS DISTINCT FROM pu."schoolCode"
     ORDER BY sp."updatedAt" DESC NULLS LAST`, { type: sequelize.QueryTypes.SELECT }).catch(() => []);
  return rows;
}
async function cleanupBadLinks({ dryRun = true } = {}) {
  const bad = await findBadLinks();
  if (!dryRun && bad.length) {
    await sequelize.transaction(async (transaction) => {
      for (const row of bad) {
        await sequelize.query('DELETE FROM "StudentParents" WHERE "studentId" = :studentId AND "parentId" = :parentId', { replacements:{ studentId:row.studentId, parentId:row.parentId }, transaction });
      }
    });
  }
  return { dryRun, count: bad.length, rows: bad };
}
module.exports = { findBadLinks, cleanupBadLinks };
