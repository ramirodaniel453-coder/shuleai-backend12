const BUILT_IN_ALLOWED_ORIGINS = Object.freeze([
  'https://shuleai.live',
  'https://www.shuleai.live',
  'https://lumumbaian22-stack.github.io',
  'https://shuleaiinfo-cmd.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:19006',
  'http://localhost:8081',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:19006',
  'http://127.0.0.1:8081'
]);

function allowedOrigins() {
  return Array.from(new Set([
    ...BUILT_IN_ALLOWED_ORIGINS,
    ...(process.env.CORS_ORIGINS || '').split(','),
    ...(process.env.FRONTEND_URL || '').split(',')
  ].map(value => String(value || '').trim()).filter(Boolean)));
}

function isAllowedOrigin(origin) {
  return !origin || allowedOrigins().includes(String(origin));
}

module.exports = { BUILT_IN_ALLOWED_ORIGINS, allowedOrigins, isAllowedOrigin };
