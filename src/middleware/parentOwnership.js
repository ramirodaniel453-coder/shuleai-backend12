'use strict';

const ownership = require('../services/parentOwnershipService');

function studentIdFrom(req, fieldNames = ['studentId', 'childId', 'id']) {
  for (const key of fieldNames) {
    const value = req.params?.[key] ?? req.body?.[key] ?? req.query?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function requireParentOwnsStudent(options = {}) {
  const fields = options.fields || ['studentId', 'childId', 'id'];
  return async function parentOwnershipMiddleware(req, res, next) {
    try {
      const role = String(req.user?.role || '').toLowerCase();
      if (!['parent', 'guardian'].includes(role)) return next();
      const studentId = studentIdFrom(req, fields);
      if (!studentId) return res.status(400).json({ success: false, message: 'Missing studentId' });
      const result = await ownership.assertParentOwnsStudent({
        parentUserId: req.user.id,
        studentId,
        schoolCode: req.user.schoolCode
      });
      req.parentOwnership = result;
      req.ownedStudent = result.student;
      req.parentProfile = result.parent;
      return next();
    } catch (error) {
      return res.status(error.status || 403).json({ success: false, message: error.message || 'Not your child' });
    }
  };
}

module.exports = { requireParentOwnsStudent };
