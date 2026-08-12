const { yearlyBusinessId } = require('../utils/businessIds');
function calculateStudentAge(dateOfBirth, now = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth); if (Number.isNaN(dob.getTime()) || dob > now) return null;
  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  let days = now.getDate() - dob.getDate();
  if (days < 0) { const previousMonth = new Date(now.getFullYear(), now.getMonth(), 0); days += previousMonth.getDate(); months -= 1; }
  if (months < 0) { months += 12; years -= 1; }
  const compactDays = Math.floor((now - new Date(now.getFullYear() - years, dob.getMonth(), dob.getDate())) / 86400000);
  return { years, months, days, compactDays:Math.max(0,compactDays), full:`${years} year${years===1?'':'s'}, ${months} month${months===1?'':'s'}, ${days} day${days===1?'':'s'} old`, compact:`${years} year${years===1?'':'s'}, ${Math.max(0,compactDays)} day${compactDays===1?'':'s'} old` };
}
module.exports = (sequelize, DataTypes) => {
  const Student = sequelize.define('Student', {
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' } },
    schoolCode: { type: DataTypes.STRING, allowNull: true , references: { model: 'Schools', key: 'schoolId' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'},
    elimuid: { type: DataTypes.STRING, allowNull: false, unique: true, defaultValue: () => yearlyBusinessId('ELI') },
    grade: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Not Assigned' },
    classId: { type: DataTypes.INTEGER, allowNull: true },
    curriculum: { type: DataTypes.STRING, allowNull: true, defaultValue: 'cbc' },
    admissionNumber: { type: DataTypes.STRING, allowNull: true },
    dateOfBirth: DataTypes.DATE,
    dateOfBirthVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    birthdayPrivacy: { type: DataTypes.JSONB, allowNull: false, defaultValue: { enabled:true, notifyParent:true, notifyTeacher:true, notifyStudent:true, announceToClass:false } },
    age: { type: DataTypes.VIRTUAL, get() { return calculateStudentAge(this.getDataValue('dateOfBirth')); } },
    ageDisplay: { type: DataTypes.VIRTUAL, get() { return calculateStudentAge(this.getDataValue('dateOfBirth'))?.compact || null; } },
    gender: DataTypes.ENUM('male', 'female', 'other'),
    enrollmentDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    status: { type: DataTypes.ENUM('active', 'inactive', 'graduated', 'transferred'), defaultValue: 'active' },
    academicStatus: { type: DataTypes.ENUM('excelling', 'average', 'struggling', 'critical'), defaultValue: 'average' },
    points: { type: DataTypes.INTEGER, defaultValue: 0 },
    assessmentNumber: { type: DataTypes.STRING, allowNull: true },
    nemisNumber: { type: DataTypes.STRING, allowNull: true },
    location: { type: DataTypes.STRING, allowNull: true },
    parentName: { type: DataTypes.STRING, allowNull: true },
    parentEmail: { type: DataTypes.STRING, allowNull: true },
    parentPhone: { type: DataTypes.STRING, allowNull: true },
    parentRelationship: { type: DataTypes.STRING, allowNull: true, defaultValue: 'guardian' },
    isPrefect: { type: DataTypes.BOOLEAN, defaultValue: false },
    paymentStatus: { type: DataTypes.JSONB, defaultValue: { plan: 'basic', paid: 0, status: 'inactive' } },
    subscriptionPlan: { type: DataTypes.ENUM('basic', 'premium', 'ultimate'), defaultValue: 'basic' },
    subscriptionStatus: { type: DataTypes.ENUM('active', 'inactive', 'expired', 'pending'), defaultValue: 'inactive' },
    subscriptionStartDate: { type: DataTypes.DATE, allowNull: true },
    subscriptionExpiry: { type: DataTypes.DATE, allowNull: true },
    preferences: { type: DataTypes.JSONB, defaultValue: { theme: 'light', notifications: true } },
    approvalStatus: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), defaultValue: 'approved' },
    approvedBy: DataTypes.INTEGER,
    activeEnrollmentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'StudentEnrollments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' }
  }, {
    timestamps: true,
    hooks: {
      beforeCreate: async (student) => {
        if (!student.elimuid || !student.elimuid.startsWith('ELI-')) {
          student.elimuid = yearlyBusinessId('ELI');
        }
      },
      beforeSave: async (student) => {
        if (student.changed('subscriptionPlan') || student.changed('subscriptionStatus')) {
          student.paymentStatus = { ...student.paymentStatus, plan: student.subscriptionPlan, status: student.subscriptionStatus, startDate: student.subscriptionStartDate, expiryDate: student.subscriptionExpiry };
        }
      }
    }
  });
  Student.prototype.hasActiveSubscription = function() { return this.subscriptionStatus === 'active' && this.subscriptionExpiry && new Date(this.subscriptionExpiry) > new Date(); };
  Student.prototype.getRemainingSubscriptionDays = function() { if (!this.subscriptionExpiry || this.subscriptionStatus !== 'active') return 0; const diff = new Date(this.subscriptionExpiry) - new Date(); return Math.max(0, Math.ceil(diff / 86400000)); };
  Student.prototype.upgradeSubscription = async function(newPlan, paymentAmount) { this.subscriptionPlan = newPlan; this.subscriptionStatus = 'active'; this.subscriptionStartDate = new Date(); this.subscriptionExpiry = new Date(Date.now() + 30*86400000); this.paymentStatus = { ...this.paymentStatus, plan: newPlan, status: 'active', startDate: this.subscriptionStartDate, expiryDate: this.subscriptionExpiry, lastPayment: paymentAmount, lastPaymentDate: new Date() }; await this.save(); return this; };
  return Student;
};
