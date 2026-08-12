const crypto = require('crypto');

function configuredProvider() {
  const explicit = String(process.env.FILE_STORAGE_PROVIDER || process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) return 'cloudinary';
  return 'database';
}

function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function sanitizePart(value, fallback = 'asset') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 140);
  return cleaned || fallback;
}

function signCloudinaryParams(params, apiSecret) {
  const payload = Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(payload + apiSecret).digest('hex');
}

async function uploadToCloudinary({ buffer, mimeType, originalName, schoolCode, kind, checksum }) {
  if (!isCloudinaryConfigured()) throw new Error('Cloudinary storage is not configured.');
  if (typeof fetch !== 'function' || typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('Cloudinary upload requires Node 18+ fetch/FormData/Blob support.');
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folderBase = sanitizePart(process.env.CLOUDINARY_FOLDER || 'shuleai');
  const folder = `${folderBase}/${sanitizePart(schoolCode || 'platform')}/${sanitizePart(kind || 'asset')}`;
  const publicId = `${crypto.randomUUID()}-${String(checksum || crypto.randomUUID()).slice(0, 18)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id: publicId, timestamp };
  const signature = signCloudinaryParams(params, apiSecret);

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), originalName || `${kind || 'asset'}`);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`;
  const response = await fetch(url, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || data?.message || `Cloudinary upload failed with ${response.status}`;
    throw new Error(msg);
  }
  return {
    provider: 'cloudinary',
    externalUrl: data.secure_url || data.url,
    publicId: data.public_id,
    resourceType: data.resource_type,
    format: data.format,
    bytes: data.bytes,
    raw: {
      asset_id: data.asset_id,
      version: data.version,
      width: data.width,
      height: data.height,
      resource_type: data.resource_type,
      format: data.format
    }
  };
}

async function uploadPersistentObject(options = {}) {
  const provider = configuredProvider();
  if (options.requireExternal === true && provider !== 'cloudinary') throw new Error('Durable external object storage is required for this operation. Configure Cloudinary.');
  if (provider === 'cloudinary') {
    try {
      return await uploadToCloudinary(options);
    } catch (error) {
      if (options.requireExternal === true || process.env.CLOUDINARY_REQUIRED === 'true' || process.env.REQUIRE_OBJECT_STORAGE === 'true') throw error;
      console.warn(`[storage] Cloudinary unavailable, falling back to database-backed storage: ${error.message}`);
      return { provider: 'database', externalUrl: null, warning: error.message };
    }
  }
  if (provider !== 'database') {
    console.warn(`[storage] Unsupported FILE_STORAGE_PROVIDER=${provider}; using database-backed storage.`);
  }
  return { provider: 'database', externalUrl: null };
}

function getStorageHealth() {
  const provider = configuredProvider();
  return {
    provider,
    durable: provider === 'cloudinary' ? isCloudinaryConfigured() : provider === 'database',
    cloudinaryConfigured: isCloudinaryConfigured(),
    requireObjectStorage: process.env.REQUIRE_OBJECT_STORAGE === 'true' || process.env.CLOUDINARY_REQUIRED === 'true'
  };
}

module.exports = { uploadPersistentObject, getStorageHealth, configuredProvider, isCloudinaryConfigured };
