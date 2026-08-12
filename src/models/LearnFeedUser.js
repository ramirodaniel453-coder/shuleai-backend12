const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { yearlyBusinessId } = require('../utils/businessIds');
const { assertStrongPassword } = require('../utils/passwordPolicy');

function generateLearnFeedId() {
  return yearlyBusinessId('LF', 12);
}

module.exports = (sequelize, DataTypes) => {
  const LearnFeedUser = sequelize.define('LearnFeedUser', {
    learnFeedId: { type: DataTypes.STRING(40), allowNull: false, unique: true, defaultValue: generateLearnFeedId },
    email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
    password: { type: DataTypes.STRING, allowNull: false },
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    role: { type: DataTypes.ENUM('student', 'teacher'), allowNull: false, defaultValue: 'student' },
    requestedRole: { type: DataTypes.ENUM('student','teacher'), allowNull: false, defaultValue:'student' },
    verificationStatus: { type: DataTypes.ENUM('unverified','pending','verified','rejected'), allowNull:false, defaultValue:'unverified' },
    verifiedAt: { type: DataTypes.DATE, allowNull:true },
    verifiedBy: { type: DataTypes.INTEGER, allowNull:true, references:{ model:'Users', key:'id' } },
    verificationProof: { type: DataTypes.JSONB, allowNull:false, defaultValue:{} },
    displayName: { type: DataTypes.STRING(120), allowNull: false },
    handle: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    avatar: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '🎓' },
    bio: { type: DataTypes.TEXT, allowNull: true },
    linkedPlatformUserId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' } },
    linkedStudentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' } },
    linkedSchoolCode: { type: DataTypes.STRING, allowNull: true },
    linkedElimuId: { type: DataTypes.STRING, allowNull: true, references: { model: 'Students', key: 'elimuid' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    linkStatus: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'standalone' },
    linkSource: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'learnfeed_signup' },
    linkedAt: { type: DataTypes.DATE, allowNull: true },
    subscriptionStatus: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'free' },
    subscriptionPlanCode: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'free' },
    subscriptionSource: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'learnfeed' },
    subscriptionEndsAt: { type: DataTypes.DATE, allowNull: true },
    lastSubscriptionPaymentReference: { type: DataTypes.STRING(120), allowNull: true },
    walletBalanceCents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    lastLogin: { type: DataTypes.DATE, allowNull: true },
    preferences: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'LearnFeedUsers',
    timestamps: true,
    defaultScope: { attributes: { exclude: ['password'] } },
    scopes: { withPassword: {} },
    hooks: {
      beforeValidate(user) {
        if (!user.learnFeedId) user.learnFeedId = generateLearnFeedId();
        if (!user.handle && user.email) user.handle = '@' + String(user.email).split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase();
        if (user.handle && !String(user.handle).startsWith('@')) user.handle = '@' + String(user.handle).replace(/^@+/, '');
        if (!user.displayName && user.email) user.displayName = String(user.email).split('@')[0];
        user.requestedRole = ['teacher','student'].includes(String(user.requestedRole || user.role || '').toLowerCase()) ? String(user.requestedRole || user.role).toLowerCase() : 'student';
        if (user.verificationStatus !== 'verified' || !user.verifiedAt) user.role = 'student';
        else user.role = user.requestedRole === 'teacher' ? 'teacher' : 'student';
      },
      beforeSave: async (user) => {
        if (user.changed('password')) {
          assertStrongPassword(user.password, [user.displayName, user.email, user.handle]);
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      }
    },
    indexes: [
      { unique: true, fields: ['learnFeedId'] },
      { unique: true, fields: ['email'] },
      { unique: true, fields: ['handle'] },
      { unique: true, fields: ['linkedStudentId'] },
      { fields: ['role', 'isActive'] },
      { fields: ['linkStatus', 'subscriptionStatus'] },
      { fields: ['linkedSchoolCode'] }
    ]
  });

  LearnFeedUser.prototype.comparePassword = async function comparePassword(candidatePassword) {
    if (!this.password) throw new Error('Password comparison requires the withPassword model scope.');
    return bcrypt.compare(candidatePassword, this.password);
  };

  LearnFeedUser.prototype.generateAuthToken = function generateAuthToken() {
    return jwt.sign({ id: this.id, learnFeedUserId: this.id, learnFeedId: this.learnFeedId, role: 'learnfeed_user', learnFeedRole: (this.verificationStatus === 'verified' && this.verifiedAt && this.requestedRole === 'teacher') ? 'teacher' : 'student', accountScope: 'individual', accessType: 'public', isSchoolLinked: this.linkStatus === 'linked', tokenVersion: Number(this.tokenVersion || 0) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
  };

  LearnFeedUser.prototype.toJSON = function toJSON() {
    const values = { ...this.get({ plain: true }) };
    delete values.password;
    delete values.tokenVersion;
    delete values.verificationProof;
    return values;
  };

  LearnFeedUser.prototype.hasActiveLearnFeedAccess = function hasActiveLearnFeedAccess() {
    if (this.subscriptionStatus === 'active' && (!this.subscriptionEndsAt || new Date(this.subscriptionEndsAt) > new Date())) return true;
    if (this.subscriptionStatus === 'inherited_active' && (!this.subscriptionEndsAt || new Date(this.subscriptionEndsAt) > new Date())) return true;
    return false;
  };

  LearnFeedUser.prototype.getPublicProfile = function getPublicProfile() {
    const linked = this.linkStatus === 'linked';
    return {
      id: this.id,
      learnFeedId: this.learnFeedId,
      role: (this.verificationStatus === 'verified' && this.verifiedAt && this.requestedRole === 'teacher') ? 'teacher' : 'student',
      requestedRole: this.requestedRole || 'student',
      verificationStatus: this.verificationStatus || 'unverified',
      verified: Boolean(this.verificationStatus === 'verified' && this.verifiedAt),
      verifiedAt: this.verifiedAt || null,
      email: this.email,
      displayName: this.displayName,
      name: this.displayName,
      handle: this.handle,
      avatar: this.avatar,
      bio: this.bio || '',
      accountScope: linked ? 'school_linked' : 'individual',
      accessType: 'public',
      isSchoolLinked: linked,
      linkedStudentId: this.linkedStudentId,
      linkedSchoolCode: this.linkedSchoolCode,
      linkedElimuId: this.linkedElimuId,
      paymentScope: linked ? 'existing_school_subscription' : 'user',
      subscriptionStatus: this.subscriptionStatus || 'free',
      subscriptionPlanCode: this.subscriptionPlanCode || 'free',
      subscriptionSource: this.subscriptionSource || 'learnfeed',
      subscriptionEndsAt: this.subscriptionEndsAt,
      accessActive: this.hasActiveLearnFeedAccess(),
      walletBalanceCents: this.walletBalanceCents || 0
    };
  };

  return LearnFeedUser;
};
