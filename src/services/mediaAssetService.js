const crypto = require('crypto');
const fs = require('fs');
const { MediaAsset } = require('../models');
const { uploadPersistentObject } = require('./objectStorageService');

function normalizeMime(file, fallback = 'application/octet-stream') {
  return String(file?.mimetype || file?.type || fallback).toLowerCase();
}

function detectMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return 'application/octet-stream';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const head6 = buffer.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'AVI ') return 'video/x-msvideo';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return 'video/webm';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03,0x05,0x07].includes(buffer[2]) && [0x04,0x06,0x08].includes(buffer[3])) return 'application/zip';
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').trimStart().toLowerCase();
  if (sample.startsWith('<svg') || sample.startsWith('<?xml') && sample.includes('<svg')) return 'image/svg+xml';
  if (sample.startsWith('<!doctype html') || sample.startsWith('<html') || sample.startsWith('<script')) return 'text/html';
  if (!buffer.includes(0) && !sample.includes('\ufffd') && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(sample)) {
    const firstLine = sample.split(/\r?\n/, 1)[0];
    if (firstLine.includes(',')) return 'text/csv';
    if (sample.startsWith('{') || sample.startsWith('[')) {
      try { JSON.parse(buffer.toString('utf8')); return 'application/json'; } catch (_) {}
    }
    return 'text/plain';
  }
  return 'application/octet-stream';
}

async function readUploadBuffer(file) {
  if (!file) throw Object.assign(new Error('No file uploaded.'), { status: 400 });
  if (file.data && Buffer.isBuffer(file.data) && file.data.length) return Buffer.from(file.data);
  if (file.buffer && Buffer.isBuffer(file.buffer) && file.buffer.length) return Buffer.from(file.buffer);
  const p = file.tempFilePath || file.path;
  if (p) return fs.promises.readFile(p);
  throw Object.assign(new Error('Unsupported upload object.'), { status: 400 });
}

function validateImageMime(mime) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) {
    throw Object.assign(new Error('Only verified PNG, JPG, WEBP and GIF images are allowed. SVG is not accepted.'), { status: 400 });
  }
}

function validateGenericMime(mime, { allowedMimePrefixes = null, allowedMimeTypes = null } = {}) {
  if (Array.isArray(allowedMimeTypes) && allowedMimeTypes.length && !allowedMimeTypes.includes(mime)) {
    throw Object.assign(new Error('This file type is not allowed.'), { status: 400 });
  }
  if (Array.isArray(allowedMimePrefixes) && allowedMimePrefixes.length && !allowedMimePrefixes.some(prefix => mime.startsWith(prefix))) {
    throw Object.assign(new Error('This file type is not allowed.'), { status: 400 });
  }
}

async function saveBufferAsset({
  buffer,
  mimeType,
  originalName,
  schoolCode,
  ownerUserId = null,
  kind,
  metadata = {},
  maxBytes = 5 * 1024 * 1024,
  allowAnyMime = false,
  allowedMimePrefixes = null,
  allowedMimeTypes = null,
  deactivatePrevious = true
}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('Uploaded file is empty.'), { status: 400 });
  if (buffer.length > maxBytes) throw Object.assign(new Error(`File is too large. Maximum size is ${Math.floor(maxBytes / 1024 / 1024)}MB.`), { status: 400 });
  const detectedMime = detectMimeFromBuffer(buffer);
  if (detectedMime === 'image/svg+xml') throw Object.assign(new Error('SVG uploads are disabled for security.'), { status: 400 });
  if (allowAnyMime) {
    if (['application/octet-stream', 'text/html'].includes(detectedMime)) {
      throw Object.assign(new Error('File content could not be verified as an allowed safe type.'), { status: 400 });
    }
    mimeType = detectedMime;
    validateGenericMime(mimeType, { allowedMimePrefixes, allowedMimeTypes });
  } else {
    mimeType = detectedMime;
    validateImageMime(mimeType);
  }

  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  if (deactivatePrevious && ownerUserId) {
    await MediaAsset.update({ isActive: false }, { where: { ownerUserId, kind, isActive: true } }).catch(() => {});
  }

  const storage = await uploadPersistentObject({ buffer, mimeType, originalName, schoolCode, kind, checksum });
  const storageProvider = storage.provider || 'database';
  const externalUrl = storage.externalUrl || null;
  const shouldKeepDatabaseCopy = storageProvider === 'database' || process.env.MEDIA_KEEP_DB_COPY === 'true';
  const assetData = shouldKeepDatabaseCopy ? buffer : Buffer.alloc(0);
  const mergedMetadata = {
    ...(metadata || {}),
    storageProvider,
    externalUrl,
    cloudinary: storage.provider === 'cloudinary' ? {
      publicId: storage.publicId,
      resourceType: storage.resourceType,
      format: storage.format,
      bytes: storage.bytes,
      raw: storage.raw
    } : undefined,
    storageWarning: storage.warning || undefined
  };

  const asset = await MediaAsset.create({
    schoolCode: schoolCode || null,
    ownerUserId: ownerUserId || null,
    kind,
    mimeType,
    originalName: String(originalName || `${kind}.asset`).slice(0, 255),
    byteSize: buffer.length,
    checksum,
    data: assetData,
    storageProvider,
    externalUrl,
    metadata: mergedMetadata,
    isActive: true
  });

  return {
    asset,
    url: externalUrl || `/api/media/${asset.token}`,
    token: asset.token,
    checksum,
    byteSize: buffer.length,
    mimeType,
    storageProvider,
    externalUrl,
    durable: true
  };
}

async function saveUploadAsset(options) {
  const buffer = await readUploadBuffer(options.file);
  const mimeType = normalizeMime(options.file);
  try {
    return await saveBufferAsset({
      ...options,
      buffer,
      mimeType,
      originalName: options.originalName || options.file?.name || options.file?.originalname
    });
  } finally {
    const temp = options.file?.tempFilePath || options.file?.path;
    if (temp) fs.promises.unlink(temp).catch(() => {});
  }
}

async function validateCsvUpload(file, { maxBytes = 20 * 1024 * 1024 } = {}) {
  const buffer = await readUploadBuffer(file);
  if (!buffer.length) throw Object.assign(new Error('CSV file is empty.'), { status: 400 });
  if (buffer.length > maxBytes) throw Object.assign(new Error(`CSV file exceeds ${Math.floor(maxBytes / 1024 / 1024)}MB.`), { status: 400 });
  const detectedMime = detectMimeFromBuffer(buffer);
  if (detectedMime !== 'text/csv') {
    throw Object.assign(new Error('Uploaded content is not a verified comma-separated text file.'), { status: 400 });
  }
  let text = buffer.toString('utf8').replace(/^\ufeff/, '');
  if (text.includes('\ufffd') || text.includes('\0')) {
    throw Object.assign(new Error('CSV must be valid UTF-8 text without binary bytes.'), { status: 400 });
  }
  const firstLine = text.split(/\r?\n/, 1)[0];
  const headers = firstLine.split(',').map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean);
  if (headers.length < 2) throw Object.assign(new Error('CSV must contain at least two comma-separated header columns.'), { status: 400 });
  return { buffer, text, headers, detectedMime, byteSize: buffer.length, rowEstimate: Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1) };
}

async function saveDataUrlAsset({ dataUrl, ...options }) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m) throw Object.assign(new Error('Invalid image data.'), { status: 400 });
  return saveBufferAsset({
    ...options,
    buffer: Buffer.from(m[2], 'base64'),
    mimeType: m[1].toLowerCase(),
    originalName: options.originalName || `${options.kind}.png`
  });
}

module.exports = { readUploadBuffer, detectMimeFromBuffer, validateCsvUpload, saveBufferAsset, saveUploadAsset, saveDataUrlAsset };
