const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

// v2044: retained as a compatibility export for old callers, but deliberately read-only.
// Versioned migrations are the sole schema mutation authority.
async function ensureRuntimeSchema() {
  const rows = await sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'SequelizeMeta'
     ) AS migrations_present`,
    { type: QueryTypes.SELECT }
  );
  if (!rows?.[0]?.migrations_present) {
    const error = new Error('Database schema is not initialized. Run npm run migrate before starting ShuleAI.');
    error.status = 503;
    throw error;
  }
  return true;
}

module.exports = { ensureRuntimeSchema };
