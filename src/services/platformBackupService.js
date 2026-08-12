'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { uploadPersistentObject } = require('./objectStorageService');

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve({ out: stdout, err: stderr });
      return reject(new Error(`${command} failed (${code}): ${stderr.slice(-2000)}`));
    });
  });
}

function verificationTarget() {
  const productionUrl = String(process.env.DATABASE_URL || '').trim();
  const verificationUrl = String(process.env.BACKUP_VERIFY_DATABASE_URL || '').trim();
  const expectedName = String(process.env.BACKUP_VERIFY_DATABASE_NAME || '').trim();
  if (!productionUrl) throw new Error('DATABASE_URL is required for platform backup.');
  if (!verificationUrl || !expectedName) {
    throw new Error('BACKUP_VERIFY_DATABASE_URL and BACKUP_VERIFY_DATABASE_NAME are required for real restore verification.');
  }

  let production;
  let verification;
  try {
    production = new URL(productionUrl);
    verification = new URL(verificationUrl);
  } catch (_) {
    throw new Error('Backup database URLs must be valid PostgreSQL URLs.');
  }
  if (!/^postgres(?:ql)?:$/.test(production.protocol) || !/^postgres(?:ql)?:$/.test(verification.protocol)) {
    throw new Error('Backup database URLs must use postgresql:// or postgres://.');
  }
  const productionName = decodeURIComponent(production.pathname.replace(/^\//, ''));
  const verificationName = decodeURIComponent(verification.pathname.replace(/^\//, ''));
  if (!verificationName || verificationName !== expectedName) {
    throw new Error('BACKUP_VERIFY_DATABASE_NAME must exactly match the verification URL database name.');
  }
  if (['postgres', 'template0', 'template1'].includes(verificationName.toLowerCase())) {
    throw new Error('A PostgreSQL maintenance/template database cannot be used for backup verification.');
  }
  if (!/(?:backup|restore)[_-]?(?:verify|verification)|(?:verify|verification)[_-]?(?:backup|restore)/i.test(verificationName)) {
    throw new Error('The disposable verification database name must clearly contain backup/restore and verify/verification.');
  }
  if (production.hostname === verification.hostname
      && (production.port || '5432') === (verification.port || '5432')
      && productionName === verificationName) {
    throw new Error('Backup verification database must be distinct from the production database.');
  }
  return { productionUrl, verificationUrl, verificationName };
}

async function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function restoreAndVerifyArchive(file, target) {
  await run(process.env.PG_RESTORE_BIN || 'pg_restore', [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    '--single-transaction',
    file
  ], { PGDATABASE: target.verificationUrl });
  const tableCheck = await run(process.env.PSQL_BIN || 'psql', [
    '--no-psqlrc',
    '--tuples-only',
    '--no-align',
    '--set', 'ON_ERROR_STOP=1',
    '--command', "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'"
  ], { PGDATABASE: target.verificationUrl });
  const restoredTableCount = Number(String(tableCheck.out || '').trim());
  if (!Number.isInteger(restoredTableCount) || restoredTableCount < 1) {
    throw new Error('Restore verification completed without any public tables.');
  }
  return { restoredTableCount, verificationDatabase: target.verificationName };
}

async function createVerifiedPlatformBackup({ backupId, progress = async () => {} }) {
  const target = verificationTarget();
  const { PlatformBackup } = require('../models');
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shuleai-backup-'));
  const filename = `shuleai-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
  const file = path.join(temporaryDirectory, filename);

  try {
    await PlatformBackup.update({ status: 'processing', startedAt: new Date() }, { where: { id: backupId } });
    await progress(10, 'Creating PostgreSQL custom-format dump');
    await run(process.env.PG_DUMP_BIN || 'pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file', file
    ], { PGDATABASE: target.productionUrl });

    const stat = await fs.promises.stat(file);
    if (!stat.size) throw new Error('Backup artifact is empty.');
    await progress(40, 'Computing streaming SHA-256 checksum');
    const checksum = await sha256File(file);

    await progress(55, 'Validating PostgreSQL archive directory');
    const archiveList = await run(process.env.PG_RESTORE_BIN || 'pg_restore', ['--list', file]);
    if (!/TABLE|SCHEMA|DATABASE|SEQUENCE/i.test(archiveList.out)) {
      throw new Error('pg_restore archive verification returned no database objects.');
    }

    await progress(68, 'Restoring into the dedicated verification database');
    const restore = await restoreAndVerifyArchive(file, target);
    const restoreVerifiedAt = new Date();

    await progress(82, 'Uploading verified backup to durable object storage');
    const buffer = await fs.promises.readFile(file);
    const stored = await uploadPersistentObject({
      buffer,
      mimeType: 'application/octet-stream',
      originalName: filename,
      schoolCode: 'platform',
      kind: 'database-backup',
      checksum,
      requireExternal: true
    });

    const verificationDetails = {
      archiveListVerified: true,
      restoreVerified: true,
      objectCount: archiveList.out.split('\n').filter(Boolean).length,
      restoredTableCount: restore.restoredTableCount,
      verificationDatabase: restore.verificationDatabase,
      verifiedWith: ['pg_restore --list', 'pg_restore --single-transaction', 'psql table check']
    };
    await PlatformBackup.update({
      status: 'completed',
      filename,
      storageProvider: stored.provider,
      storageUrl: stored.externalUrl,
      checksum,
      byteSize: stat.size,
      archiveVerifiedAt: restoreVerifiedAt,
      restoreVerifiedAt,
      verificationDetails,
      completedAt: new Date(),
      error: null
    }, { where: { id: backupId } });

    await progress(100, 'Backup, checksum, durable upload, and restore verification completed');
    return {
      backupId,
      filename,
      checksum,
      byteSize: stat.size,
      storageProvider: stored.provider,
      storageUrl: stored.externalUrl,
      archiveVerified: true,
      restoreVerified: true,
      verificationDetails
    };
  } catch (error) {
    await PlatformBackup.update({ status: 'failed', failedAt: new Date(), error: error.message }, { where: { id: backupId } }).catch(() => null);
    throw error;
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => null);
  }
}

module.exports = { createVerifiedPlatformBackup, verificationTarget, restoreAndVerifyArchive };
