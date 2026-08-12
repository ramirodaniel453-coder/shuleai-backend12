const { captureFrontendError, getMonitoringHealth } = require('../services/errorMonitorService');

exports.frontendError = async (req, res) => {
  const ok = captureFrontendError(req.body || {});
  res.status(202).json({ success: true, accepted: true, forwarded: ok });
};

exports.health = async (req, res) => {
  res.json({ success: true, data: getMonitoringHealth() });
};
