const { Op } = require('sequelize');
const { sequelize, BackgroundJob } = require('../models');

const instanceId = String(process.env.INSTANCE_ID || process.env.RENDER_INSTANCE_ID || `worker-${process.pid}`);

async function enqueueJob(type, payload = {}, user = null) {
  if (!user?.schoolCode && user?.role !== 'super_admin') throw new Error('A school-scoped user is required to queue work.');
  const schoolCode = user?.role === 'super_admin' && payload.platformJob === true ? null : (user?.schoolCode || payload.schoolCode);
  if (!schoolCode && !(user?.role === 'super_admin' && payload.platformJob === true)) throw new Error('schoolCode is required.');
  return BackgroundJob.create({
    type,
    status: 'queued',
    payload,
    createdBy: user?.id || null,
    schoolCode,
    progress: 0,
    logs: ['Job queued']
  });
}

async function getJob(id) {
  return BackgroundJob.findByPk(id);
}

async function listJobs({ schoolCode, limit = 50 } = {}) {
  const where = schoolCode ? { schoolCode } : {};
  return BackgroundJob.findAll({ where, order: [['createdAt', 'DESC']], limit: Math.min(Math.max(Number(limit) || 50, 1), 500) });
}

async function appendProgress(job, progress, log) {
  await job.reload();
  const logs = [...(Array.isArray(job.logs) ? job.logs : []), String(log || '')].filter(Boolean).slice(-100);
  await job.update({ progress: Math.min(Math.max(Number(progress) || 0, 0), 100), logs });
}

async function claimNextJob() {
  return sequelize.transaction(async transaction => {
    const job = await BackgroundJob.findOne({
      where: { status: 'queued', attempts: { [Op.lt]: sequelize.col('maxAttempts') } },
      order: [['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true
    });
    if (!job) return null;
    await job.update({
      status: 'processing',
      attempts: Number(job.attempts || 0) + 1,
      progress: 5,
      lockedBy: instanceId,
      lockedAt: new Date(),
      startedAt: job.startedAt || new Date(),
      error: null,
      logs: [...(Array.isArray(job.logs) ? job.logs : []), 'Job claimed by worker'].slice(-100)
    }, { transaction });
    return job;
  });
}

async function processNextJob(handlerMap = {}) {
  const job = await claimNextJob();
  if (!job) return null;
  const handler = handlerMap[job.type];
  if (!handler) {
    await job.update({ status: 'failed', progress: 100, failedAt: new Date(), error: `No worker registered for ${job.type}` });
    return job.reload();
  }
  try {
    const result = await handler(job, (progress, log) => appendProgress(job, progress, log));
    await job.update({
      status: 'completed',
      progress: 100,
      completedAt: new Date(),
      result: result || {},
      lockedBy: null,
      lockedAt: null,
      logs: [...(Array.isArray(job.logs) ? job.logs : []), 'Job completed'].slice(-100)
    });
  } catch (error) {
    const retry = Number(job.attempts || 0) < Number(job.maxAttempts || 3);
    await job.update({
      status: retry ? 'queued' : 'failed',
      progress: retry ? 0 : 100,
      failedAt: retry ? null : new Date(),
      error: error.message,
      lockedBy: null,
      lockedAt: null,
      logs: [...(Array.isArray(job.logs) ? job.logs : []), `${retry ? 'Retry scheduled' : 'Failed'}: ${error.message}`].slice(-100)
    });
  }
  return job.reload();
}

function startInlineWorker(handlerMap = {}, intervalMs = 5000) {
  if (global.__shuleJobWorkerTimer) return global.__shuleJobWorkerTimer;
  global.__shuleJobWorkerTimer = setInterval(() => processNextJob(handlerMap).catch(error => console.error('[job-worker]', error.message)), intervalMs);
  global.__shuleJobWorkerTimer.unref?.();
  return global.__shuleJobWorkerTimer;
}

module.exports = { enqueueJob, getJob, listJobs, processNextJob, startInlineWorker };
