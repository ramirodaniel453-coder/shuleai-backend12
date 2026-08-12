const REQUIRED_PRODUCTION = [
  'JWT_SECRET',
  'JWT_EXPIRE',
  'SUPER_ADMIN_SECRET',
  'PAYMENT_VAULT_KEY',
  'DATABASE_URL',
  'PUBLIC_API_BASE_URL',
  'JWT_REFRESH_SECRET'
];

const RECOMMENDED_PRODUCTION = [
  'JWT_REFRESH_EXPIRE',
  'CORS_ORIGINS'
];

// Optional paid/extra infrastructure. These must never block the no-extra-cost rollout.
const OPTIONAL_INFRASTRUCTURE = ['CLOUDINARY_*', 'SENTRY_DSN', 'REDIS_URL'];

function assertRequiredEnv() {
  const missing = REQUIRED_PRODUCTION.filter(key => !process.env[key]);
  const missingRecommended = RECOMMENDED_PRODUCTION.filter(key => !process.env[key]);
  if (process.env.NODE_ENV === 'production' && missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  if (missing.length) {
    console.warn(`[env-check] Missing required production environment variables: ${missing.join(', ')}. Production will refuse to boot without them.`);
  }
  if (missingRecommended.length) {
    console.warn(`[env-check] Missing recommended production environment variables: ${missingRecommended.join(', ')}.`);
  }
  if (process.env.NODE_ENV === 'production' && /^SUPER_SECRET_2024_CHANGE_THIS$/i.test(String(process.env.SUPER_ADMIN_SECRET || ''))) {
    throw new Error('SUPER_ADMIN_SECRET must be changed from the default placeholder in production.');
  }
  if (process.env.NODE_ENV === 'production' && String(process.env.JWT_SECRET || '').length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }
  if (process.env.NODE_ENV === 'production' && String(process.env.JWT_REFRESH_SECRET || '').length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters in production.');
  }
  if (process.env.NODE_ENV === 'production' && process.env.JWT_REFRESH_SECRET === process.env.JWT_SECRET) {
    throw new Error('JWT_REFRESH_SECRET must be distinct from JWT_SECRET in production.');
  }
  if (process.env.NODE_ENV === 'production' && (process.env.REQUIRE_OBJECT_STORAGE === 'true' || process.env.CLOUDINARY_REQUIRED === 'true')) {
    const cloudinaryMissing = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].filter(key => !process.env[key]);
    if (cloudinaryMissing.length) throw new Error(`Cloudinary object storage is required but missing: ${cloudinaryMissing.join(', ')}`);
  }
  const publicBase = process.env.PUBLIC_API_BASE_URL || '';
  if (process.env.NODE_ENV === 'production' && !publicBase) {
    throw new Error('PUBLIC_API_BASE_URL is required in production for payment callback/IPN URLs. Do not rely on Render fallback domains.');
  }
  if (publicBase && !/^https:\/\//i.test(publicBase)) {
    throw new Error('PUBLIC_API_BASE_URL must be a public HTTPS URL in production.');
  }
  if (/shuleaibackend-32h1\.onrender\.com/i.test(publicBase)) {
    throw new Error('PUBLIC_API_BASE_URL must use https://api.shuleai.live, not the old Render domain.');
  }
}

module.exports = { assertRequiredEnv, OPTIONAL_INFRASTRUCTURE };
