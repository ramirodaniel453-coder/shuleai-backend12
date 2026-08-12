const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

// v2044: migrations are the only schema mutation authority. This guard is read-only.
function runtimeSchemaRepairAllowed() {
  return false;
}

async function columnExists(tableName, columnName) {
  const rows = await sequelize.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = :tableName AND column_name = :columnName
    ) AS exists`,
    { replacements: { tableName, columnName }, type: QueryTypes.SELECT }
  );
  return Boolean(rows?.[0]?.exists);
}

async function tableExists(tableName) {
  const rows = await sequelize.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = :tableName
    ) AS exists`,
    { replacements: { tableName }, type: QueryTypes.SELECT }
  );
  return Boolean(rows?.[0]?.exists);
}

async function verifySchoolAccessSchema() {
  const required = {
    Schools: ['trialAccessEnabled', 'trialEndsAt', 'subscriptionPlan', 'subscriptionStatus', 'accessMode', 'accessStatus', 'schoolStructure', 'enabledLevels'],
    Classes: ['curriculum', 'levelCode', 'levelLabel', 'curriculumLevel']
  };
  const missing = [];
  for (const [table, columns] of Object.entries(required)) {
    if (!(await tableExists(table))) {
      missing.push(`${table} table`);
      continue;
    }
    for (const column of columns) {
      if (!(await columnExists(table, column))) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length) {
    const err = new Error(`Schema is not ready. Missing: ${missing.join(', ')}. Run npm run migrate before starting traffic.`);
    err.status = 503;
    throw err;
  }
  return true;
}

async function ensureSchoolAccessSchema() {
  return verifySchoolAccessSchema();
}

async function accessSchemaMiddleware(req, res, next) {
  try {
    await verifySchoolAccessSchema();
    return next();
  } catch (error) {
    console.error('[access-schema-guard] schema not ready:', error.message);
    return res.status(error.status || 503).json({
      success: false,
      message: 'School access schema is not ready. Run npm run migrate before traffic.',
      detail: error.message
    });
  }
}

module.exports = { ensureSchoolAccessSchema, accessSchemaMiddleware, verifySchoolAccessSchema, runtimeSchemaRepairAllowed };
