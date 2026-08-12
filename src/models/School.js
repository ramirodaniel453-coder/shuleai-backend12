const QRCode = require('qrcode');
const { yearlyBusinessId, randomCode } = require('../utils/businessIds');

module.exports = (sequelize, DataTypes) => {
  const School = sequelize.define('School', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    schoolId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      defaultValue: () => yearlyBusinessId('SCH')
    },
    shortCode: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      defaultValue: () => `SHL-${randomCode(8)}`
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    lookupCodes: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    qrCode: DataTypes.TEXT,
    qrCodeData: DataTypes.JSONB,
    system: {
      type: DataTypes.ENUM('844', 'cbc', 'british', 'american'),
      defaultValue: '844'
    },
    countryIsoCode: {
      type: DataTypes.CHAR(2),
      allowNull: true,
      references: { model: 'Countries', key: 'isoCode' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    activeCurriculumPackId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'CurriculumPacks', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    activeCurriculumAssignmentId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'SchoolCurriculumAssignments', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },
    address: DataTypes.JSONB,
    contact: DataTypes.JSONB,
    status: {
      type: DataTypes.ENUM('pending', 'active', 'suspended', 'rejected'),
      defaultValue: 'pending'
    },
    approvedBy: DataTypes.INTEGER,
    approvedAt: DataTypes.DATE,
    rejectionReason: DataTypes.TEXT,
    
    // Suspension fields
    suspendedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    suspendedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    },
    suspensionReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    reactivatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    reactivatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    },
    reactivationReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    settings: {
      type: DataTypes.JSONB,
      defaultValue: {
        allowTeacherSignup: true,
        requireApproval: true,
        autoApproveDomains: [],
        schoolLevel: 'secondary',
        dutyManagement: {
          enabled: true,
          reminderHours: 24,
          maxTeachersPerDay: 3,
          checkInWindow: 15
        }
      }
    },
    feeStructure: {
      type: DataTypes.JSONB,
      defaultValue: { term1: 0, term2: 0, term3: 0, registration: 0 }
    },
    bankDetails: {
      type: DataTypes.JSONB,
      defaultValue: {
        bankName: '',
        accountName: '',
        accountNumber: '',
        branch: '',
        paybill: '',
        till: '',
        active: false
      }
    },
    stats: {
      type: DataTypes.JSONB,
      defaultValue: { students: 0, teachers: 0, parents: 0, classes: 0, pendingApprovals: 0 }
    },
    createdBy: DataTypes.INTEGER,
    pilotFullAccessEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    pilotStartedAt: DataTypes.DATE,
    pilotEndsAt: DataTypes.DATE,
    pilotEnabledBy: DataTypes.INTEGER,
    trialAccessEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    trialStartedAt: DataTypes.DATE,
    trialEndsAt: DataTypes.DATE,
    manualPaymentConfirmed: { type: DataTypes.BOOLEAN, defaultValue: false },
    manualPaymentAmount: DataTypes.INTEGER,
    manualPaymentReference: DataTypes.STRING,
    manualPaymentConfirmedBy: DataTypes.INTEGER,
    manualPaymentConfirmedAt: DataTypes.DATE,
    subscriptionPlan: { type: DataTypes.STRING, defaultValue: 'free' },
    subscriptionStatus: { type: DataTypes.STRING, defaultValue: 'inactive' },
    subscriptionStartedAt: DataTypes.DATE,
    subscriptionEndsAt: DataTypes.DATE,
    accessMode: { type: DataTypes.STRING, defaultValue: 'default' },
    accessStatus: { type: DataTypes.STRING, defaultValue: 'limited' },
    schoolStructure: { type: DataTypes.STRING, defaultValue: 'mixed' },
    enabledLevels: { type: DataTypes.JSONB, defaultValue: [] },
    curriculumVersion: DataTypes.STRING,
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    timestamps: true,
    hooks: {
      beforeCreate: async (school) => {
        try {
          // Generate QR code
          const qrData = {
            schoolId: school.schoolId,
            shortCode: school.shortCode,
            name: school.name,
            createdAt: new Date()
          };
          school.qrCode = await QRCode.toDataURL(JSON.stringify(qrData));
          school.qrCodeData = {
            generated: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            active: true
          };
          console.log('QR code generated for school:', school.schoolId);
        } catch (error) {
          console.error('Error generating QR code:', error);
        }
      }
    }
  });

  return School;
};
