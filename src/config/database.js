const { Sequelize } = require('sequelize');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const shouldUseSsl = process.env.DB_SSL === 'false' ? false : true;

function intEnv(name, fallback) {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

const pool = {
  // Keep this modest for Render starter/small Postgres plans. Too many connections
  // slows the database down instead of speeding it up. Tune with DB_POOL_MAX only
  // after checking your database plan connection limit.
  max: intEnv('DB_POOL_MAX', isProduction ? 10 : 10),
  min: intEnv('DB_POOL_MIN', 0),
  acquire: intEnv('DB_POOL_ACQUIRE_MS', 30000),
  idle: intEnv('DB_POOL_IDLE_MS', 10000),
  evict: intEnv('DB_POOL_EVICT_MS', 10000)
};

const slowQueryMs = intEnv('DB_SLOW_QUERY_MS', 500);
const logAllQueries = process.env.DB_LOGGING === 'true';
const logSlowQueries = process.env.DB_SLOW_QUERY_LOGGING !== 'false';

function databaseLogger(sql, timingMs) {
  if (logAllQueries) {
    console.log(timingMs ? `[SQL ${timingMs}ms] ${sql}` : sql);
    return;
  }
  if (logSlowQueries && Number(timingMs) >= slowQueryMs) {
    console.warn(`[SLOW QUERY ${timingMs}ms] ${sql}`);
  }
}

const commonOptions = {
  dialect: 'postgres',
  logging: (logAllQueries || logSlowQueries) ? databaseLogger : false,
  pool,
  benchmark: logAllQueries || logSlowQueries || process.env.DB_BENCHMARK === 'true',
  retry: {
    max: intEnv('DB_RETRY_MAX', 3),
    match: [/SequelizeConnectionError/, /SequelizeConnectionRefusedError/, /SequelizeHostNotFoundError/, /SequelizeHostNotReachableError/, /SequelizeInvalidConnectionError/, /SequelizeConnectionTimedOutError/, /TimeoutError/, /Connection terminated unexpectedly/i, /Connection terminated/i, /Connection reset/i, /ECONNRESET/i, /Client has encountered a connection error/i]
  },
  dialectOptions: shouldUseSsl ? {
    ssl: {
      require: true,
      // Render/Heroku-style Postgres often requires this. Set DB_SSL_REJECT_UNAUTHORIZED=true
      // if your provider gives you a trusted CA chain and you want strict TLS verification.
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
    },
    keepAlive: true,
    statement_timeout: intEnv('DB_STATEMENT_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: intEnv('DB_CONNECTION_TIMEOUT_MS', 10000),
    idle_in_transaction_session_timeout: intEnv('DB_IDLE_TX_TIMEOUT_MS', 60000)
  } : {
    keepAlive: true,
    statement_timeout: intEnv('DB_STATEMENT_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: intEnv('DB_CONNECTION_TIMEOUT_MS', 10000),
    idle_in_transaction_session_timeout: intEnv('DB_IDLE_TX_TIMEOUT_MS', 60000)
  }
};

let sequelize;
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, commonOptions);
} else {
  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    ...commonOptions,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432
  });
}

// Connection lifecycle is owned by server startup; importing this module performs no network I/O.

module.exports = sequelize;
