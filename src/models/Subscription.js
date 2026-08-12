module.exports = (sequelize, DataTypes) => {
  const Subscription = sequelize.define('Subscription', {
    ownerType: { type: DataTypes.ENUM('school', 'child'), allowNull: false },
    schoolId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' } },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    parentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Parents', key: 'id' } },
    studentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' } },
    planId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'SubscriptionPlans', key: 'id' } },
    planCode: { type: DataTypes.STRING, allowNull: false },
    planName: { type: DataTypes.STRING, allowNull: false },
    billingCycle: { type: DataTypes.ENUM('monthly', 'termly', 'yearly', 'custom'), defaultValue: 'monthly' },
    status: { type: DataTypes.ENUM('active', 'expired', 'cancelled', 'pending', 'paused', 'trial'), defaultValue: 'pending' },
    startDate: { type: DataTypes.DATE, allowNull: true },
    endDate: { type: DataTypes.DATE, allowNull: true },
    autoRenew: { type: DataTypes.BOOLEAN, defaultValue: false },
    lastPaymentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    features: { type: DataTypes.JSONB, defaultValue: [] },
    limits: { type: DataTypes.JSONB, defaultValue: {} },
    auditTrail: { type: DataTypes.JSONB, defaultValue: [] },
    enforcementEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    nextDueDate: { type: DataTypes.DATE, allowNull: true },
    graceEndsAt: { type: DataTypes.DATE, allowNull: true },
    billingState: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'not_enforced' },
    billingAnchorDate: { type: DataTypes.DATE, allowNull: true },
    periodKey: { type: DataTypes.STRING(160), allowNull: true },
    academicPeriod: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    reminderState: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    lastReminderAt: { type: DataTypes.DATE, allowNull: true },
    overdueSince: { type: DataTypes.DATE, allowNull: true }
  }, { timestamps: true, indexes: [{ fields: ['ownerType'] }, { fields: ['schoolCode'] }, { fields: ['studentId'] }, { fields: ['ownerType','enforcementEnabled','nextDueDate'] }, { fields: ['schoolCode','periodKey'] }] });
  Subscription.prototype.isActiveNow = function(){ return this.status === 'active' && this.endDate && new Date(this.endDate) > new Date(); };
  Subscription.prototype.daysRemaining = function(){ if (!this.endDate || this.status !== 'active') return 0; return Math.max(0, Math.ceil((new Date(this.endDate) - new Date()) / 86400000)); };
  return Subscription;
};
