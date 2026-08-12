const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { normalizeRole, canUseEffectiveRole, loadSafeAdditionalRoles } = require('../services/roleAccessService');

module.exports = async function socketAuthMiddleware(socket, next) {
  try {
    const authHeader = socket.handshake.headers?.authorization || '';
    const token = socket.handshake.auth?.token || authHeader.replace(/^Bearer\s+/i, '') || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication error: No token provided'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id, { attributes: ['id','name','role','schoolCode','isActive','preferences'] });
    if (!user || !user.isActive) return next(new Error('Authentication error: Invalid user'));
    await loadSafeAdditionalRoles(user);const financeMeta=user.getDataValue?.('financeAssignment')||user.financeAssignment||null;const requestedEffectiveRole=normalizeRole(decoded.effectiveRole||decoded.role||user.role);const effectiveRole=canUseEffectiveRole(user,requestedEffectiveRole)?requestedEffectiveRole:normalizeRole(user.role);socket.user={...user.toJSON(),role:effectiveRole,primaryRole:normalizeRole(user.role),safeAdditionalRoles:user.getDataValue?.('safeAdditionalRoles')||user.safeAdditionalRoles||[],financeTitle:financeMeta?.title||null,financePermissions:Array.isArray(financeMeta?.permissions)?financeMeta.permissions:[]};socket.userId=user.id;socket.userRole=effectiveRole;
    socket.schoolCode = user.schoolCode;
    next();
  } catch (_) {
    next(new Error('Authentication error: Invalid token'));
  }
};
