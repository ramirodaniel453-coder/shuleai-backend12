const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { normalizeRole, TRUSTED_ROLES } = require('../services/roleAccessService');
const { assertStrongPassword } = require('../utils/passwordPolicy');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { len: [2, 100] }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      validate: { isEmail: true }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('super_admin', 'admin', 'finance_officer', 'teacher', 'parent', 'student'),
      allowNull: false
    },
    phone: DataTypes.STRING,
    schoolCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    profileImage: DataTypes.TEXT,
    profilePicture: DataTypes.TEXT,
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastLogin: DataTypes.DATE,
    firstLogin: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    mustChangePassword: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    passwordIssuedAt: DataTypes.DATE,
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    preferences: {
      type: DataTypes.JSONB,
      defaultValue: {
        notifications: { email: true, sms: false, push: true },
        theme: 'light'
      }
    }
  }, {
    timestamps: true,
    defaultScope: { attributes: { exclude: ['password'] } },
    scopes: { withPassword: {} },
    hooks: {
      beforeSave: async (user) => {
        if (user.changed('password')) {
          assertStrongPassword(user.password, [user.name, user.email, user.phone]);
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      }
    }
  });

  User.prototype.comparePassword = async function(candidatePassword) {
    if (!this.password) throw new Error('Password comparison requires the withPassword model scope.');
    return bcrypt.compare(candidatePassword, this.password);
  };

  User.prototype.toJSON = function toJSON() {
    const values = { ...this.get({ plain: true }) };
    delete values.password;
    delete values.tokenVersion;
    delete values.passwordIssuedAt;
    return values;
  };

  User.prototype.generateAuthToken = function(effectiveRole = null) {
    const primaryRole = normalizeRole(this.role);
    let role = normalizeRole(effectiveRole || this.role);
    if (!TRUSTED_ROLES.has(role)) role = primaryRole;
    if (role === 'super_admin' && primaryRole !== 'super_admin') role = primaryRole;
    return jwt.sign(
      { id: this.id, role, effectiveRole: role, primaryRole, schoolCode: this.schoolCode, tokenVersion: Number(this.tokenVersion || 0) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
  };

  User.prototype.getPublicProfile = function(effectiveRole = null) {
    const primaryRole = this.getDataValue('primaryRole') || this.role;
    const role = effectiveRole || this.role;
    return {
      id: this.id,
      name: this.name,
      email: this.email,
      role,
      primaryRole,
      phone: this.phone,
      profileImage: this.preferences?.profileImageUrl || this.profileImage || this.profilePicture || this.preferences?.profileImageDataUrl,
      profilePicture: this.preferences?.profileImageUrl || this.profilePicture || this.profileImage || this.preferences?.profileImageDataUrl,
      preferences: this.preferences || {},
      signature: this.preferences?.signatureUrl || this.preferences?.signatureAbsoluteUrl || this.preferences?.signatureDataUrl || null,
      signatureUrl: this.preferences?.signatureUrl || this.preferences?.signatureAbsoluteUrl || this.preferences?.signatureDataUrl || null,
      schoolCode: this.schoolCode,
      isActive: this.isActive,
      firstLogin: this.firstLogin,
      mustChangePassword: this.mustChangePassword
    };
  };

  return User;
};
