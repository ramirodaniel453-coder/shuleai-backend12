const { Sequelize } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');
const { sequelize } = require('./src/models');

function createSafeQueryInterface(queryInterface) {
  const safe = Object.create(queryInterface);
  safe.sequelize = queryInterface.sequelize;
  safe.queryGenerator = queryInterface.queryGenerator;

  const tableKey = tableName => typeof tableName === 'string' ? tableName : tableName?.tableName;
  const tableExists = async tableName => {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table LIMIT 1`,
      { replacements: { table: tableKey(tableName) } }
    );
    return rows.length > 0;
  };
  const columnExists = async (tableName, columnName) => {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column LIMIT 1`,
      { replacements: { table: tableKey(tableName), column: columnName } }
    );
    return rows.length > 0;
  };
  const indexExists = async name => {
    if (!name) return false;
    const [rows] = await queryInterface.sequelize.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name LIMIT 1`,
      { replacements: { name } }
    );
    return rows.length > 0;
  };

  safe.addColumn = async function(tableName, columnName, attributes, options) {
    try {
      if (await columnExists(tableName, columnName)) {
        console.log(`[migration-safe] ${tableName}.${columnName} already exists; skipping addColumn`);
        return;
      }
    } catch (err) {
      console.warn(`[migration-safe] Could not describe ${tableName} before addColumn ${columnName}:`, err.message);
    }

    try {
      return await queryInterface.addColumn(tableName, columnName, attributes, options);
    } catch (err) {
      const code = err?.parent?.code || err?.original?.code;
      const msg = err?.message || '';
      if (code === '42701' || msg.includes('already exists')) {
        console.log(`[migration-safe] Duplicate column ${tableName}.${columnName}; continuing`);
        return;
      }
      throw err;
    }
  };

  safe.removeColumn = async function(tableName, columnName, options) {
    try {
      if (!(await columnExists(tableName, columnName))) {
        console.log(`[migration-safe] ${tableName}.${columnName} missing; skipping removeColumn`);
        return;
      }
    } catch (err) {
      console.warn(`[migration-safe] Could not describe ${tableName} before removeColumn ${columnName}:`, err.message);
    }

    try {
      return await queryInterface.removeColumn(tableName, columnName, options);
    } catch (err) {
      const code = err?.parent?.code || err?.original?.code;
      const msg = err?.message || '';
      if (code === '42703' || msg.includes('does not exist')) {
        console.log(`[migration-safe] Missing column ${tableName}.${columnName}; continuing`);
        return;
      }
      throw err;
    }
  };

  safe.addIndex = async function(tableName, attributes, options = {}) {
    if (await indexExists(options.name)) {
      console.log(`[migration-safe] Index ${options.name} already exists; skipping addIndex`);
      return;
    }
    try {
      return await queryInterface.addIndex(tableName, attributes, options);
    } catch (err) {
      const code = err?.parent?.code || err?.original?.code;
      const msg = err?.message || '';
      if (code === '42P07' || msg.includes('already exists')) {
        console.log(`[migration-safe] Duplicate index on ${tableName}; continuing`);
        return;
      }
      throw err;
    }
  };

  safe.createTable = async function(tableName, attributes, options) {
    if (await tableExists(tableName)) {
      console.log(`[migration-safe] Table ${tableKey(tableName)} already exists; skipping createTable`);
      return;
    }
    try {
      return await queryInterface.createTable(tableName, attributes, options);
    } catch (err) {
      const code = err?.parent?.code || err?.original?.code;
      const msg = err?.message || '';
      if (code === '42P07' || msg.includes('already exists')) {
        console.log(`[migration-safe] Table ${tableName} already exists; continuing`);
        return;
      }
      throw err;
    }
  };

  return safe;
}

async function runMigrations() {
  try {
    console.log('🔧 Database Config Debug:');
    console.log('📊 NODE_ENV:', process.env.NODE_ENV);
    console.log('📊 DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('📊 isProduction:', process.env.NODE_ENV === 'production');
    if (process.env.DATABASE_URL) console.log('📊 Using configured DATABASE_URL (value hidden)');

    await sequelize.authenticate();
    console.log('✅ Database connection test SUCCESSFUL');

    // Migrations can legitimately wait for a short-lived application lock. The
    // normal request timeout is too small for production DDL, so use explicit
    // migration-session limits without disabling lock protection entirely.
    await sequelize.query(`SET statement_timeout = '10min'`);
    await sequelize.query(`SET lock_timeout = '90s'`);

    const queryInterface = sequelize.getQueryInterface();
    const safeQueryInterface = createSafeQueryInterface(queryInterface);

    const umzug = new Umzug({
      migrations: {
        glob: 'src/migrations/*.js',
        resolve: ({ name, path }) => {
          const migration = require(path);
          return {
            name,
            up: async () => migration.up(safeQueryInterface, Sequelize),
            down: async () => {
              if (typeof migration.down === 'function') {
                return migration.down(safeQueryInterface, Sequelize);
              }
            }
          };
        }
      },
      context: safeQueryInterface,
      storage: new SequelizeStorage({ sequelize }),
      logger: console,
    });

    const pending = await umzug.pending();
    console.log(`📦 Pending migrations: ${pending.length}`);
    pending.forEach(m => console.log(`  - ${m.name}`));

    await umzug.up();

    console.log('✅ All migrations completed successfully');
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    try { await sequelize.close(); } catch (_) {}
    process.exit(1);
  }
}

runMigrations();
