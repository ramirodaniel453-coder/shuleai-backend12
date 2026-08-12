const fs = require('fs');
const path = require('path');

// Route wiring is a module-load audit, not a database integration test.
process.env.SKIP_DB_AUTH_ON_IMPORT = 'true';

const routesDir = path.join(__dirname, '..', 'src', 'routes');
let failures = 0;
for (const file of fs.readdirSync(routesDir).filter(f => f.endsWith('.js'))) {
  const full = path.join(routesDir, file);
  try { require(full); }
  catch (error) { failures++; console.error(`[route-wiring] ${file}: ${error.message}`); }
}
if (failures) process.exit(1);
console.log(`[route-wiring] OK: ${fs.readdirSync(routesDir).filter(f => f.endsWith('.js')).length} route files loaded`);
