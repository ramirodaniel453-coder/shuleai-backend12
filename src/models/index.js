const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

const UserConsent = require('./UserConsent')(sequelize, DataTypes);
const ParentChildConsent = require('./ParentChildConsent')(sequelize, DataTypes);
const SchoolDPA = require('./SchoolDPA')(sequelize, DataTypes);

// Import all models
const User = require('./User')(sequelize, DataTypes);
const UserRoleAssignment = require('./UserRoleAssignment')(sequelize, DataTypes);
const School = require('./School')(sequelize, DataTypes);
const Country = require('./Country')(sequelize, DataTypes);
const CurriculumPack = require('./CurriculumPack')(sequelize, DataTypes);
const SchoolCurriculumAssignment = require('./SchoolCurriculumAssignment')(sequelize, DataTypes);
const SchoolGradingProfile = require('./SchoolGradingProfile')(sequelize, DataTypes);
const Student = require('./Student')(sequelize, DataTypes);
const Teacher = require('./Teacher')(sequelize, DataTypes);
const Parent = require('./Parent')(sequelize, DataTypes);
const Admin = require('./Admin')(sequelize, DataTypes);
const AcademicRecord = require('./AcademicRecord')(sequelize, DataTypes);
const Attendance = require('./Attendance')(sequelize, DataTypes);
const Fee = require('./Fee')(sequelize, DataTypes);
const FeeStructure = require('./FeeStructure')(sequelize, DataTypes);
const Payment = require('./Payment')(sequelize, DataTypes);
const PaymentEvent = require('./PaymentEvent')(sequelize, DataTypes);
const Message = require('./Message')(sequelize, DataTypes);
const Alert = require('./Alert')(sequelize, DataTypes);
const ApprovalRequest = require('./ApprovalRequest')(sequelize, DataTypes);
const DutyRoster = require('./DutyRoster')(sequelize, DataTypes);
const UploadLog = require('./UploadLog')(sequelize, DataTypes);
const SchoolNameRequest = require('./SchoolNameRequest')(sequelize, DataTypes);
const Class = require('./Class')(sequelize, DataTypes);
const Settings = require('./Settings')(sequelize, DataTypes);
const TeacherSubjectAssignment = require('./TeacherSubjectAssignment')(sequelize);
const Task = require('./Task')(sequelize, DataTypes);
const Competency = require('./Competency')(sequelize, DataTypes);
const LearningOutcome = require('./LearningOutcome')(sequelize, DataTypes);
const StudentCompetencyProgress = require('./StudentCompetencyProgress')(sequelize, DataTypes);
const HomeTaskAssignment = require('./HomeTaskAssignment')(sequelize, DataTypes);
const HomeTask = require('./HomeTask')(sequelize, DataTypes);
const Badge = require('./Badge')(sequelize, DataTypes);
const StudentBadge = require('./StudentBadge')(sequelize, DataTypes);
const Reward = require('./Reward')(sequelize, DataTypes);
const StudentReward = require('./StudentReward')(sequelize, DataTypes);
const SubscriptionPlan = require('./SubscriptionPlan')(sequelize, DataTypes);
const SchoolCalendar = require('./SchoolCalendar')(sequelize, DataTypes);
const Timetable = require('./Timetable')(sequelize, DataTypes);
const ConductLog = require('./ConductLog')(sequelize, DataTypes);
const ResourceViews = require('./ResourceViews')(sequelize, DataTypes);
const MoodCheckin = require('./MoodCheckin')(sequelize, DataTypes);
const Department = require('./Department')(sequelize, DataTypes);
const DepartmentMember = require('./DepartmentMember')(sequelize, DataTypes);
const ChatGroup = require('./ChatGroup')(sequelize, DataTypes);
const ChatGroupMember = require('./ChatGroupMember')(sequelize, DataTypes);
const ChatMessage = require('./ChatMessage')(sequelize, DataTypes);
const ClassroomThread = require('./ClassroomThread')(sequelize, DataTypes);
const ThreadReply = require('./ThreadReply')(sequelize, DataTypes);
const AchievementEvent = require('./AchievementEvent')(sequelize, DataTypes);
const TutorSession = require('./TutorSession')(sequelize, DataTypes);
const TutorMessage = require('./TutorMessage')(sequelize, DataTypes);
const TutorProgress = require('./TutorProgress')(sequelize, DataTypes);
const TutorUsage = require('./TutorUsage')(sequelize, DataTypes);
const AuditLog = require('./AuditLog')(sequelize, DataTypes);
const ReportSnapshot = require('./ReportSnapshot')(sequelize, DataTypes);
const SchoolPaymentSetting = require('./SchoolPaymentSetting')(sequelize, DataTypes);
const PlatformPaymentSetting = require('./PlatformPaymentSetting')(sequelize, DataTypes);
const PlatformSetting = require('./PlatformSetting')(sequelize, DataTypes);
const PlatformBackup = require('./PlatformBackup')(sequelize, DataTypes);
const Subscription = require('./Subscription')(sequelize, DataTypes);
const SubscriptionPayment = require('./SubscriptionPayment')(sequelize, DataTypes);
const FeatureLock = require('./FeatureLock')(sequelize, DataTypes);
const RealtimeEvent = require('./RealtimeEvent')(sequelize, DataTypes);
const AttendanceSession = require('./AttendanceSession')(sequelize, DataTypes);
const AttendanceCorrection = require('./AttendanceCorrection')(sequelize, DataTypes);
const AbsenceReport = require('./AbsenceReport')(sequelize, DataTypes);
const ClassRelease = require('./ClassRelease')(sequelize, DataTypes);
const StudentEnrollment = require('./StudentEnrollment')(sequelize, DataTypes);
const PromotionBatch = require('./PromotionBatch')(sequelize, DataTypes);
const PromotionDecision = require('./PromotionDecision')(sequelize, DataTypes);
const ClassTransferRequest = require('./ClassTransferRequest')(sequelize, DataTypes);
const ReportShare = require('./ReportShare')(sequelize, DataTypes);
const BirthdayEvent = require('./BirthdayEvent')(sequelize, DataTypes);
const MediaAsset = require('./MediaAsset')(sequelize, DataTypes);
const FinanceExpense = require('./FinanceExpense')(sequelize, DataTypes);
const FeeInvoice = require('./FeeInvoice')(sequelize, DataTypes);
const FeeInvoiceItem = require('./FeeInvoiceItem')(sequelize, DataTypes);
const StudentFeeAccount = require('./StudentFeeAccount')(sequelize, DataTypes);
const PaymentTransaction = require('./PaymentTransaction')(sequelize, DataTypes);
const PaymentReconciliation = require('./PaymentReconciliation')(sequelize, DataTypes);
const ProviderCredentialsAudit = require('./ProviderCredentialsAudit')(sequelize, DataTypes);
const PaymentRefund = require('./PaymentRefund')(sequelize, DataTypes);
const PlatformSubscription = require('./PlatformSubscription')(sequelize, DataTypes);
const LearnFeedUser = require('./LearnFeedUser')(sequelize, DataTypes);
const LearnFeedVideo = require('./LearnFeedVideo')(sequelize, DataTypes);
const LearnFeedInteraction = require('./LearnFeedInteraction')(sequelize, DataTypes);
const LearnFeedFollow = require('./LearnFeedFollow')(sequelize, DataTypes);
const LearnFeedComment = require('./LearnFeedComment')(sequelize, DataTypes);
const LearnFeedLiveRoom = require('./LearnFeedLiveRoom')(sequelize, DataTypes);
const LearnFeedMessage = require('./LearnFeedMessage')(sequelize, DataTypes);
const LearnFeedSubscriptionPayment = require('./LearnFeedSubscriptionPayment')(sequelize, DataTypes);
const BackgroundJob = require('./BackgroundJob')(sequelize, DataTypes);
const LearnFeedWalletTransaction = require('./LearnFeedWalletTransaction')(sequelize, DataTypes);

// LearnFeed public app associations
LearnFeedUser.hasMany(LearnFeedVideo, { foreignKey: 'creatorId', as: 'videos' });
LearnFeedVideo.belongsTo(LearnFeedUser, { foreignKey: 'creatorId', as: 'Creator' });
LearnFeedUser.hasMany(LearnFeedInteraction, { foreignKey: 'userId' });
LearnFeedInteraction.belongsTo(LearnFeedUser, { foreignKey: 'userId' });
LearnFeedVideo.hasMany(LearnFeedInteraction, { foreignKey: 'videoId' });
LearnFeedInteraction.belongsTo(LearnFeedVideo, { foreignKey: 'videoId' });
LearnFeedUser.hasMany(LearnFeedComment, { foreignKey: 'userId' });
LearnFeedComment.belongsTo(LearnFeedUser, { foreignKey: 'userId', as: 'User' });
LearnFeedVideo.hasMany(LearnFeedComment, { foreignKey: 'videoId' });
LearnFeedComment.belongsTo(LearnFeedVideo, { foreignKey: 'videoId' });
LearnFeedUser.hasMany(LearnFeedFollow, { foreignKey: 'followerId', as: 'followingCreators' });
LearnFeedUser.hasMany(LearnFeedFollow, { foreignKey: 'creatorId', as: 'followers' });
LearnFeedFollow.belongsTo(LearnFeedUser, { foreignKey: 'followerId', as: 'Follower' });
LearnFeedFollow.belongsTo(LearnFeedUser, { foreignKey: 'creatorId', as: 'Creator' });
LearnFeedUser.hasMany(LearnFeedLiveRoom, { foreignKey: 'hostUserId', as: 'liveRooms' });
LearnFeedLiveRoom.belongsTo(LearnFeedUser, { foreignKey: 'hostUserId', as: 'Host' });
LearnFeedUser.hasMany(LearnFeedMessage, { foreignKey: 'fromUserId', as: 'sentLearnFeedMessages' });
LearnFeedUser.hasMany(LearnFeedMessage, { foreignKey: 'toUserId', as: 'receivedLearnFeedMessages' });
LearnFeedUser.hasMany(LearnFeedSubscriptionPayment, { foreignKey: 'userId', as: 'learnFeedSubscriptionPayments' });
LearnFeedSubscriptionPayment.belongsTo(LearnFeedUser, { foreignKey: 'userId' });
User.hasMany(BackgroundJob, { foreignKey: 'createdBy', as: 'backgroundJobs' });
BackgroundJob.belongsTo(User, { foreignKey: 'createdBy', as: 'Creator' });
LearnFeedUser.hasMany(LearnFeedWalletTransaction, { foreignKey: 'userId', as: 'walletTransactions' });
LearnFeedWalletTransaction.belongsTo(LearnFeedUser, { foreignKey: 'userId', as: 'WalletUser' });
LearnFeedWalletTransaction.belongsTo(LearnFeedUser, { foreignKey: 'counterpartyUserId', as: 'Counterparty' });

// v2045 canonical country/curriculum graph.
Country.hasMany(CurriculumPack, { foreignKey: 'countryIsoCode', sourceKey: 'isoCode', as: 'curriculumPacks' });
CurriculumPack.belongsTo(Country, { foreignKey: 'countryIsoCode', targetKey: 'isoCode', as: 'country' });
Country.hasMany(School, { foreignKey: 'countryIsoCode', sourceKey: 'isoCode', as: 'schools' });
School.belongsTo(Country, { foreignKey: 'countryIsoCode', targetKey: 'isoCode', as: 'country' });
CurriculumPack.hasMany(School, { foreignKey: 'activeCurriculumPackId', as: 'activeSchools' });
School.belongsTo(CurriculumPack, { foreignKey: 'activeCurriculumPackId', as: 'activeCurriculumPack' });
School.hasMany(SchoolCurriculumAssignment, { foreignKey: 'schoolCode', sourceKey: 'schoolId', as: 'curriculumAssignments' });
SchoolCurriculumAssignment.belongsTo(School, { foreignKey: 'schoolCode', targetKey: 'schoolId', as: 'school' });
CurriculumPack.hasMany(SchoolCurriculumAssignment, { foreignKey: 'curriculumPackId', as: 'schoolAssignments' });
SchoolCurriculumAssignment.belongsTo(CurriculumPack, { foreignKey: 'curriculumPackId', as: 'curriculumPack' });
SchoolCurriculumAssignment.belongsTo(SchoolCurriculumAssignment, { foreignKey: 'previousAssignmentId', as: 'previousAssignment' });
School.belongsTo(SchoolCurriculumAssignment, { foreignKey: 'activeCurriculumAssignmentId', as: 'activeCurriculumAssignment' });
School.hasMany(SchoolGradingProfile, { foreignKey: 'schoolCode', sourceKey: 'schoolId', as: 'gradingProfiles' });
SchoolGradingProfile.belongsTo(School, { foreignKey: 'schoolCode', targetKey: 'schoolId', as: 'school' });
SchoolGradingProfile.belongsTo(CurriculumPack, { foreignKey: 'curriculumPackId', as: 'curriculumPack' });
SchoolGradingProfile.belongsTo(SchoolGradingProfile, { foreignKey: 'supersedesId', as: 'supersedes' });
CurriculumPack.hasMany(AcademicRecord, { foreignKey: 'curriculumPackId', as: 'academicRecords' });
AcademicRecord.belongsTo(CurriculumPack, { foreignKey: 'curriculumPackId', as: 'curriculumPack' });
CurriculumPack.hasMany(Class, { foreignKey: 'curriculumPackId', as: 'classes' });
Class.belongsTo(CurriculumPack, { foreignKey: 'curriculumPackId', as: 'curriculumPack' });

// Add to associations: School.hasMany(SchoolCalendar)

// --- Associations ---
Competency.hasMany(LearningOutcome, { foreignKey: 'competencyId' });
LearningOutcome.belongsTo(Competency, { foreignKey: 'competencyId' });

LearningOutcome.hasMany(StudentCompetencyProgress, { foreignKey: 'learningOutcomeId' });
StudentCompetencyProgress.belongsTo(LearningOutcome, { foreignKey: 'learningOutcomeId' });

Student.hasMany(StudentCompetencyProgress, { foreignKey: 'studentId' });
StudentCompetencyProgress.belongsTo(Student, { foreignKey: 'studentId' });

Student.hasMany(AbsenceReport,{foreignKey:'studentId',as:'absenceReports'});
AbsenceReport.belongsTo(Student,{foreignKey:'studentId'});
Parent.hasMany(AbsenceReport,{foreignKey:'parentId',as:'absenceReports'});
AbsenceReport.belongsTo(Parent,{foreignKey:'parentId'});
Class.hasMany(AbsenceReport,{foreignKey:'classId',as:'absenceReports'});
AbsenceReport.belongsTo(Class,{foreignKey:'classId'});

// User to role-specific profiles
User.hasOne(Student, { foreignKey: 'userId', onDelete: 'CASCADE' });
Student.belongsTo(User, { foreignKey: 'userId' });

User.hasOne(Teacher, { foreignKey: 'userId', onDelete: 'CASCADE' });
Teacher.belongsTo(User, { foreignKey: 'userId' });

User.hasOne(Parent, { foreignKey: 'userId', onDelete: 'CASCADE' });
Parent.belongsTo(User, { foreignKey: 'userId' });

User.hasOne(Admin, { foreignKey: 'userId', onDelete: 'CASCADE' });
Admin.belongsTo(User, { foreignKey: 'userId' });

// School <-> User associations
School.hasMany(User, {
    foreignKey: 'schoolCode',
    sourceKey: 'schoolId',
    as: 'users'
});

School.hasMany(User, {
    foreignKey: 'schoolCode',
    sourceKey: 'schoolId',
    as: 'admins',
    scope: { role: 'admin' }
});

School.hasMany(User, {
    foreignKey: 'schoolCode',
    sourceKey: 'schoolId',
    as: 'teachers',
    scope: { role: 'teacher' }
});

School.hasMany(User, {
    foreignKey: 'schoolCode',
    sourceKey: 'schoolId',
    as: 'parents',
    scope: { role: 'parent' }
});

School.hasMany(User, {
    foreignKey: 'schoolCode',
    sourceKey: 'schoolId',
    as: 'students',
    scope: { role: 'student' }
});

User.belongsTo(School, {
    foreignKey: 'schoolCode',
    targetKey: 'schoolId'
});

User.hasMany(UserRoleAssignment, { foreignKey: 'userId' });
UserRoleAssignment.belongsTo(User, { foreignKey: 'userId' });

// Student-Parent many-to-many
const StudentParent = sequelize.define('StudentParent', {
  studentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'Students', key: 'id' },
    onDelete: 'CASCADE'
  },
  parentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'Parents', key: 'id' },
    onDelete: 'CASCADE'
  },
  relationship: { type: DataTypes.STRING, allowNull: true, defaultValue: 'guardian' },
  linkedByElimuId: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
  linkedAt: { type: DataTypes.DATE, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: true, defaultValue: 'active' },
  source: { type: DataTypes.STRING, allowNull: true, defaultValue: 'manual' },
  verifiedAt: { type: DataTypes.DATE, allowNull: true },
  verifiedBy: { type: DataTypes.INTEGER, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: true, defaultValue: {} }
}, {
  tableName: 'StudentParents',
  timestamps: true,
  indexes: [{ unique: true, fields: ['studentId', 'parentId'] }]
});

Student.belongsToMany(Parent, {
  through: StudentParent,
  foreignKey: 'studentId',
  as: 'parents'
});

Parent.belongsToMany(Student, {
  through: StudentParent,
  foreignKey: 'parentId',
  as: 'students'
});

Student.hasMany(StudentParent, { foreignKey: 'studentId' });
StudentParent.belongsTo(Student, { foreignKey: 'studentId' });

Parent.hasMany(StudentParent, { foreignKey: 'parentId' });
StudentParent.belongsTo(Parent, { foreignKey: 'parentId' });

// Associations
Badge.hasMany(StudentBadge, { foreignKey: 'badgeId' });
StudentBadge.belongsTo(Badge, { foreignKey: 'badgeId' });
Student.hasMany(StudentBadge, { foreignKey: 'studentId' });
StudentBadge.belongsTo(Student, { foreignKey: 'studentId' });

Reward.hasMany(StudentReward, { foreignKey: 'rewardId' });
StudentReward.belongsTo(Reward, { foreignKey: 'rewardId' });
Student.hasMany(StudentReward, { foreignKey: 'studentId' });
StudentReward.belongsTo(Student, { foreignKey: 'studentId' });


// AcademicRecord
AcademicRecord.belongsTo(Student, { foreignKey: 'studentId' });
AcademicRecord.belongsTo(Teacher, { foreignKey: 'teacherId' });
Student.hasMany(AcademicRecord, { foreignKey: 'studentId' });
Teacher.hasMany(AcademicRecord, { foreignKey: 'teacherId' });

// Attendance
Attendance.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(Attendance, { foreignKey: 'studentId' });

// Fee Structure
FeeStructure.belongsTo(School, { foreignKey: 'schoolCode', targetKey: 'schoolId' });
School.hasMany(FeeStructure, { foreignKey: 'schoolCode', sourceKey: 'schoolId' });
FeeStructure.hasMany(Fee, { foreignKey: 'feeStructureId', sourceKey: 'id' });

// Fee
Fee.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(Fee, { foreignKey: 'studentId' });

// V200 financial-system lock associations
FeeInvoice.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(FeeInvoice, { foreignKey: 'studentId' });
FeeInvoice.belongsTo(Fee, { foreignKey: 'feeId' });
Fee.hasMany(FeeInvoice, { foreignKey: 'feeId' });
FeeInvoice.hasMany(FeeInvoiceItem, { foreignKey: 'invoiceId' });
FeeInvoiceItem.belongsTo(FeeInvoice, { foreignKey: 'invoiceId' });
StudentFeeAccount.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasOne(StudentFeeAccount, { foreignKey: 'studentId' });
PaymentTransaction.belongsTo(Payment, { foreignKey: 'legacyPaymentId' });
Payment.hasOne(PaymentTransaction, { foreignKey: 'legacyPaymentId' });
PaymentTransaction.belongsTo(FeeInvoice, { foreignKey: 'invoiceId' });
FeeInvoice.hasMany(PaymentTransaction, { foreignKey: 'invoiceId' });
PaymentTransaction.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(PaymentTransaction, { foreignKey: 'studentId' });
PaymentReconciliation.belongsTo(PaymentTransaction, { foreignKey: 'paymentTransactionId' });
PaymentTransaction.hasMany(PaymentReconciliation, { foreignKey: 'paymentTransactionId' });
PaymentRefund.belongsTo(PaymentTransaction, { foreignKey: 'paymentTransactionId' });
PaymentTransaction.hasMany(PaymentRefund, { foreignKey: 'paymentTransactionId' });
PlatformSubscription.belongsTo(PaymentTransaction, { foreignKey: 'lastPaymentTransactionId' });
PaymentTransaction.hasOne(PlatformSubscription, { foreignKey: 'lastPaymentTransactionId' });

// Payment
Payment.hasMany(PaymentEvent, { foreignKey: 'paymentId' });
PaymentEvent.belongsTo(Payment, { foreignKey: 'paymentId' });
Payment.belongsTo(Fee, { foreignKey: 'feeId' });
Fee.hasMany(Payment, { foreignKey: 'feeId' });
Payment.belongsTo(FeeStructure, { foreignKey: 'feeStructureId', targetKey: 'id', constraints: false });
FeeStructure.hasMany(Payment, { foreignKey: 'feeStructureId', sourceKey: 'id', constraints: false });
Payment.belongsTo(Student, { foreignKey: 'studentId' });
Payment.belongsTo(Parent, { foreignKey: 'parentId' });
Student.hasMany(Payment, { foreignKey: 'studentId' });
Parent.hasMany(Payment, { foreignKey: 'parentId' });

// Message
Message.belongsTo(User, { as: 'Sender', foreignKey: 'senderId' });
Message.belongsTo(User, { as: 'Receiver', foreignKey: 'receiverId' });
User.hasMany(Message, { as: 'SentMessages', foreignKey: 'senderId' });
User.hasMany(Message, { as: 'ReceivedMessages', foreignKey: 'receiverId' });

// Alert
Alert.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Alert, { foreignKey: 'userId' });

// ApprovalRequest
ApprovalRequest.belongsTo(User, { foreignKey: 'userId' });
ApprovalRequest.belongsTo(School, { foreignKey: 'schoolId', targetKey: 'schoolId' });
User.hasMany(ApprovalRequest, { foreignKey: 'userId' });
School.hasMany(ApprovalRequest, { foreignKey: 'schoolId', sourceKey: 'schoolId' });

// DutyRoster
DutyRoster.belongsTo(School, { foreignKey: 'schoolId', targetKey: 'schoolId' });
School.hasMany(DutyRoster, { foreignKey: 'schoolId', sourceKey: 'schoolId' });

// UploadLog
UploadLog.belongsTo(User, { foreignKey: 'uploadedBy' });
User.hasMany(UploadLog, { foreignKey: 'uploadedBy' });

// SchoolNameRequest
SchoolNameRequest.belongsTo(User, { foreignKey: 'requestedBy' });
SchoolNameRequest.belongsTo(School, { foreignKey: 'schoolCode', targetKey: 'schoolId' });
User.hasMany(SchoolNameRequest, { foreignKey: 'requestedBy' });
School.hasMany(SchoolNameRequest, { foreignKey: 'schoolCode', sourceKey: 'schoolId' });

// TeacherSubjectAssignment
TeacherSubjectAssignment.belongsTo(Teacher, { foreignKey: 'teacherId' });
TeacherSubjectAssignment.belongsTo(Class, { foreignKey: 'classId' });
Teacher.hasMany(TeacherSubjectAssignment, { foreignKey: 'teacherId' });
Class.hasMany(TeacherSubjectAssignment, { foreignKey: 'classId' });

// Task - CORRECTED: belongs to User, not Teacher
Task.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Task, { foreignKey: 'userId' });

// Class-Teacher
Teacher.belongsTo(Class, { foreignKey: 'classId' });
Class.hasOne(Teacher, { foreignKey: 'classId' });

Class.belongsTo(Teacher, { foreignKey: 'teacherId' });
Teacher.hasMany(Class, { foreignKey: 'teacherId' });

Class.belongsTo(School, { foreignKey: 'schoolCode', targetKey: 'schoolId' });
School.hasMany(Class, { foreignKey: 'schoolCode', sourceKey: 'schoolId' });

Student.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(Student, { foreignKey: 'classId' });

// HomeTask associations
HomeTask.belongsTo(Competency, { foreignKey: 'competencyId' });
HomeTask.belongsTo(LearningOutcome, { foreignKey: 'learningOutcomeId' });
HomeTask.belongsTo(Teacher, { foreignKey: 'createdBy' });
Teacher.hasMany(HomeTask, { foreignKey: 'createdBy' });
HomeTaskAssignment.belongsTo(Student, { foreignKey: 'studentId' });
HomeTaskAssignment.belongsTo(HomeTask, { foreignKey: 'taskId' });
Student.hasMany(HomeTaskAssignment, { foreignKey: 'studentId' });
HomeTask.hasMany(HomeTaskAssignment, { foreignKey: 'taskId' });


// V9 Chat, Department, Thread, Achievement associations
Department.belongsTo(School, { foreignKey: 'schoolCode', targetKey: 'schoolId' });
School.hasMany(Department, { foreignKey: 'schoolCode', sourceKey: 'schoolId' });
DepartmentMember.belongsTo(Department, { foreignKey: 'departmentId' });
Department.hasMany(DepartmentMember, { foreignKey: 'departmentId' });
DepartmentMember.belongsTo(Teacher, { foreignKey: 'teacherId' });
Teacher.hasMany(DepartmentMember, { foreignKey: 'teacherId' });

ChatGroup.belongsTo(School, { foreignKey: 'schoolCode', targetKey: 'schoolId' });
School.hasMany(ChatGroup, { foreignKey: 'schoolCode', sourceKey: 'schoolId' });
ChatGroup.belongsTo(Department, { foreignKey: 'departmentId' });
Department.hasMany(ChatGroup, { foreignKey: 'departmentId' });
ChatGroup.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(ChatGroup, { foreignKey: 'classId' });
ChatGroupMember.belongsTo(ChatGroup, { foreignKey: 'groupId' });
ChatGroup.hasMany(ChatGroupMember, { foreignKey: 'groupId' });
ChatGroupMember.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(ChatGroupMember, { foreignKey: 'userId' });

ChatMessage.belongsTo(User, { as: 'Sender', foreignKey: 'senderId' });
ChatMessage.belongsTo(User, { as: 'Receiver', foreignKey: 'receiverId' });
ChatMessage.belongsTo(ChatGroup, { foreignKey: 'groupId' });
User.hasMany(ChatMessage, { as: 'V9SentChatMessages', foreignKey: 'senderId' });
ChatGroup.hasMany(ChatMessage, { foreignKey: 'groupId' });

ClassroomThread.belongsTo(User, { as: 'Creator', foreignKey: 'createdBy' });
ClassroomThread.belongsTo(Teacher, { foreignKey: 'teacherId' });
ClassroomThread.belongsTo(Class, { foreignKey: 'classId' });
ClassroomThread.hasMany(ThreadReply, { foreignKey: 'threadId' });
ThreadReply.belongsTo(ClassroomThread, { foreignKey: 'threadId' });
ThreadReply.belongsTo(User, { as: 'Author', foreignKey: 'userId' });
ThreadReply.belongsTo(ThreadReply, { as: 'ParentReply', foreignKey: 'parentReplyId' });

AchievementEvent.belongsTo(User, { as: 'AwardedByUser', foreignKey: 'awardedBy' });
AchievementEvent.belongsTo(User, { as: 'RecipientUser', foreignKey: 'userId' });
AchievementEvent.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(AchievementEvent, { foreignKey: 'studentId' });

// Enhanced AI Tutor associations
Student.hasMany(TutorSession, { foreignKey: 'studentId' });
TutorSession.belongsTo(Student, { foreignKey: 'studentId' });
User.hasMany(TutorSession, { foreignKey: 'userId' });
TutorSession.belongsTo(User, { foreignKey: 'userId' });

TutorSession.hasMany(TutorMessage, { foreignKey: 'sessionId' });
TutorMessage.belongsTo(TutorSession, { foreignKey: 'sessionId' });
Student.hasMany(TutorMessage, { foreignKey: 'studentId' });
TutorMessage.belongsTo(Student, { foreignKey: 'studentId' });

Student.hasMany(TutorProgress, { foreignKey: 'studentId' });
TutorProgress.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(TutorUsage, { foreignKey: 'studentId' });
TutorUsage.belongsTo(Student, { foreignKey: 'studentId' });

Student.hasMany(ReportSnapshot, { foreignKey: 'studentId' });
ReportSnapshot.belongsTo(Student, { foreignKey: 'studentId' });
ReportSnapshot.hasMany(ReportShare, { foreignKey: 'reportSnapshotId' });
ReportShare.belongsTo(ReportSnapshot, { foreignKey: 'reportSnapshotId' });
Student.hasMany(ReportShare, { foreignKey: 'studentId' });
ReportShare.belongsTo(Student, { foreignKey: 'studentId' });

Class.hasMany(AttendanceSession, { foreignKey: 'classId' });
AttendanceSession.belongsTo(Class, { foreignKey: 'classId' });
AttendanceSession.hasMany(Attendance, { foreignKey: 'sessionId' });
Attendance.belongsTo(AttendanceSession, { foreignKey: 'sessionId' });
AttendanceSession.hasMany(AttendanceCorrection, { foreignKey: 'sessionId' });
AttendanceCorrection.belongsTo(AttendanceSession, { foreignKey: 'sessionId' });
AttendanceCorrection.belongsTo(Attendance, { foreignKey: 'attendanceId' });
Class.hasMany(ClassRelease, { foreignKey: 'classId' });
ClassRelease.belongsTo(Class, { foreignKey: 'classId' });

Student.hasMany(StudentEnrollment, { foreignKey: 'studentId' });
StudentEnrollment.belongsTo(Student, { foreignKey: 'studentId' });
Class.hasMany(StudentEnrollment, { foreignKey: 'classId' });
StudentEnrollment.belongsTo(Class, { foreignKey: 'classId' });
PromotionBatch.hasMany(PromotionDecision, { foreignKey: 'batchId' });
PromotionDecision.belongsTo(PromotionBatch, { foreignKey: 'batchId' });
Student.hasMany(PromotionDecision, { foreignKey: 'studentId' });
PromotionDecision.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(ClassTransferRequest, { foreignKey: 'studentId' });
ClassTransferRequest.belongsTo(Student, { foreignKey: 'studentId' });
ClassTransferRequest.belongsTo(Class, { as: 'FromClass', foreignKey: 'fromClassId' });
ClassTransferRequest.belongsTo(Class, { as: 'ToClass', foreignKey: 'toClassId' });
ClassTransferRequest.belongsTo(StudentEnrollment, { as: 'FromEnrollment', foreignKey: 'fromEnrollmentId' });
ClassTransferRequest.belongsTo(StudentEnrollment, { as: 'AppliedEnrollment', foreignKey: 'appliedEnrollmentId' });
Student.hasMany(BirthdayEvent, { foreignKey: 'studentId' });
BirthdayEvent.belongsTo(Student, { foreignKey: 'studentId' });

// Consent models associations
UserConsent.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(UserConsent, { foreignKey: 'userId' });

ParentChildConsent.belongsTo(User, { as: 'ParentUser', foreignKey: 'parentId' });
ParentChildConsent.belongsTo(Student, { foreignKey: 'studentId' });

SchoolDPA.belongsTo(School, { foreignKey: 'schoolId', targetKey: 'schoolId' });
SchoolDPA.belongsTo(User, { foreignKey: 'adminId' });


// Subscription & payment architecture
School.hasOne(SchoolPaymentSetting, { foreignKey: 'schoolId' });
SchoolPaymentSetting.belongsTo(School, { foreignKey: 'schoolId' });

School.hasMany(Subscription, { foreignKey: 'schoolId' });
Subscription.belongsTo(School, { foreignKey: 'schoolId' });
Parent.hasMany(Subscription, { foreignKey: 'parentId' });
Subscription.belongsTo(Parent, { foreignKey: 'parentId' });
Student.hasMany(Subscription, { foreignKey: 'studentId' });
Subscription.belongsTo(Student, { foreignKey: 'studentId' });
SubscriptionPlan.hasMany(Subscription, { foreignKey: 'planId' });
Subscription.belongsTo(SubscriptionPlan, { foreignKey: 'planId' });

Subscription.hasMany(SubscriptionPayment, { foreignKey: 'subscriptionId' });
SubscriptionPayment.belongsTo(Subscription, { foreignKey: 'subscriptionId' });
SubscriptionPlan.hasMany(SubscriptionPayment, { foreignKey: 'planId' });
SubscriptionPayment.belongsTo(SubscriptionPlan, { foreignKey: 'planId' });


// v2044 audited relationship graph: explicit ORM links for local identifier columns.
Student.belongsTo(StudentEnrollment, { as: 'ActiveEnrollment', foreignKey: 'activeEnrollmentId' });
StudentEnrollment.hasOne(Student, { as: 'ActiveStudent', foreignKey: 'activeEnrollmentId' });
Class.hasMany(AcademicRecord, { foreignKey: 'classId', as: 'academicRecords' });
AcademicRecord.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(Attendance, { foreignKey: 'classId', as: 'attendanceRecords' });
Attendance.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(Fee, { foreignKey: 'classId', as: 'classFees' });
Fee.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(FeeStructure, { foreignKey: 'classId', as: 'feeStructures' });
FeeStructure.belongsTo(Class, { foreignKey: 'classId' });
Payment.belongsTo(SubscriptionPayment, { foreignKey: 'subscriptionPaymentId', as: 'SubscriptionPayment' });
SubscriptionPayment.hasMany(Payment, { foreignKey: 'subscriptionPaymentId', as: 'legacyPayments' });
Payment.belongsTo(Subscription, { foreignKey: 'subscriptionId', as: 'Subscription' });
Subscription.hasMany(Payment, { foreignKey: 'subscriptionId', as: 'payments' });
Alert.belongsTo(User, { foreignKey: 'targetUserId', as: 'TargetUser' });
User.hasMany(Alert, { foreignKey: 'targetUserId', as: 'TargetedAlerts' });
Alert.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(Alert, { foreignKey: 'studentId' });
Alert.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(Alert, { foreignKey: 'classId' });
HomeTask.belongsTo(User, { foreignKey: 'createdByUserId', as: 'CreatedByUser' });
User.hasMany(HomeTask, { foreignKey: 'createdByUserId', as: 'createdHomeTasks' });
HomeTask.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(HomeTask, { foreignKey: 'classId' });
HomeTask.belongsTo(ClassroomThread, { foreignKey: 'studyThreadId', as: 'StudyThread' });
ClassroomThread.hasOne(HomeTask, { foreignKey: 'studyThreadId', as: 'StudyTask' });
HomeTaskAssignment.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(HomeTaskAssignment, { foreignKey: 'classId' });
SchoolCalendar.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(SchoolCalendar, { foreignKey: 'classId' });
SchoolCalendar.belongsTo(User, { foreignKey: 'createdByUserId', as: 'CreatorUser' });
User.hasMany(SchoolCalendar, { foreignKey: 'createdByUserId', as: 'calendarEventsCreated' });
ConductLog.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(ConductLog, { foreignKey: 'studentId' });
ConductLog.belongsTo(Teacher, { foreignKey: 'teacherId' });
Teacher.hasMany(ConductLog, { foreignKey: 'teacherId' });
ResourceViews.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(ResourceViews, { foreignKey: 'userId' });
MoodCheckin.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(MoodCheckin, { foreignKey: 'userId' });
Timetable.belongsTo(Timetable, { as: 'Supersedes', foreignKey: 'supersedesId' });
Timetable.hasMany(Timetable, { as: 'SupersededBy', foreignKey: 'supersedesId' });
Department.belongsTo(Teacher, { foreignKey: 'headTeacherId', as: 'HeadTeacher' });
Teacher.hasMany(Department, { foreignKey: 'headTeacherId', as: 'headedDepartments' });
TutorMessage.belongsTo(User, { foreignKey: 'userId', as: 'User' });
User.hasMany(TutorMessage, { foreignKey: 'userId', as: 'tutorMessages' });
TutorUsage.belongsTo(Subscription, { foreignKey: 'subscriptionId' });
Subscription.hasMany(TutorUsage, { foreignKey: 'subscriptionId' });
AuditLog.belongsTo(User, { foreignKey: 'actorUserId', as: 'Actor' });
User.hasMany(AuditLog, { foreignKey: 'actorUserId', as: 'auditActions' });
ReportSnapshot.belongsTo(Class, { foreignKey: 'classId' });
Class.hasMany(ReportSnapshot, { foreignKey: 'classId' });
ReportSnapshot.belongsTo(ReportSnapshot, { as: 'Supersedes', foreignKey: 'supersedesId' });
ReportSnapshot.hasMany(ReportSnapshot, { as: 'SupersededBy', foreignKey: 'supersedesId' });
Subscription.belongsTo(Payment, { foreignKey: 'lastPaymentId', as: 'LastPayment' });
Payment.hasMany(Subscription, { foreignKey: 'lastPaymentId', as: 'renewedSubscriptions' });
AttendanceCorrection.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(AttendanceCorrection, { foreignKey: 'studentId' });
StudentEnrollment.belongsTo(ClassTransferRequest, { foreignKey: 'movementRequestId', as: 'MovementRequest' });
ClassTransferRequest.hasMany(StudentEnrollment, { foreignKey: 'movementRequestId', as: 'MovementEnrollments' });
StudentEnrollment.belongsTo(StudentEnrollment, { foreignKey: 'previousEnrollmentId', as: 'PreviousEnrollment' });
StudentEnrollment.hasMany(StudentEnrollment, { foreignKey: 'previousEnrollmentId', as: 'NextEnrollments' });
PromotionDecision.belongsTo(StudentEnrollment, { foreignKey: 'currentEnrollmentId', as: 'CurrentEnrollment' });
StudentEnrollment.hasMany(PromotionDecision, { foreignKey: 'currentEnrollmentId', as: 'CurrentPromotionDecisions' });
PromotionDecision.belongsTo(Class, { foreignKey: 'fromClassId', as: 'FromClass' });
PromotionDecision.belongsTo(Class, { foreignKey: 'toClassId', as: 'ToClass' });
Class.hasMany(PromotionDecision, { foreignKey: 'fromClassId', as: 'PromotionDecisionsFrom' });
Class.hasMany(PromotionDecision, { foreignKey: 'toClassId', as: 'PromotionDecisionsTo' });
PromotionDecision.belongsTo(StudentEnrollment, { foreignKey: 'appliedEnrollmentId', as: 'AppliedEnrollment' });
StudentEnrollment.hasMany(PromotionDecision, { foreignKey: 'appliedEnrollmentId', as: 'AppliedPromotionDecisions' });
ReportShare.belongsTo(User, { foreignKey: 'recipientUserId', as: 'RecipientUser' });
User.hasMany(ReportShare, { foreignKey: 'recipientUserId', as: 'receivedReportShares' });
MediaAsset.belongsTo(User, { foreignKey: 'ownerUserId', as: 'Owner' });
User.hasMany(MediaAsset, { foreignKey: 'ownerUserId', as: 'mediaAssets' });
FeeInvoice.belongsTo(Parent, { foreignKey: 'parentId' });
Parent.hasMany(FeeInvoice, { foreignKey: 'parentId' });
FeeInvoiceItem.belongsTo(Student, { foreignKey: 'studentId' });
Student.hasMany(FeeInvoiceItem, { foreignKey: 'studentId' });
PaymentTransaction.belongsTo(Parent, { foreignKey: 'parentId' });
Parent.hasMany(PaymentTransaction, { foreignKey: 'parentId' });
PaymentReconciliation.belongsTo(Payment, { foreignKey: 'legacyPaymentId', as: 'LegacyPayment' });
Payment.hasMany(PaymentReconciliation, { foreignKey: 'legacyPaymentId', as: 'reconciliations' });
ProviderCredentialsAudit.belongsTo(User, { foreignKey: 'actorUserId', as: 'Actor' });
User.hasMany(ProviderCredentialsAudit, { foreignKey: 'actorUserId', as: 'providerCredentialActions' });
PaymentRefund.belongsTo(Payment, { foreignKey: 'legacyPaymentId', as: 'LegacyPayment' });
Payment.hasMany(PaymentRefund, { foreignKey: 'legacyPaymentId', as: 'legacyRefunds' });
LearnFeedUser.belongsTo(Student, { foreignKey: 'linkedElimuId', targetKey: 'elimuid', as: 'LinkedStudentByElimuId' });
Student.hasOne(LearnFeedUser, { foreignKey: 'linkedElimuId', sourceKey: 'elimuid', as: 'LearnFeedAccountByElimuId' });
LearnFeedSubscriptionPayment.belongsTo(LearnFeedUser, { foreignKey: 'learnFeedId', targetKey: 'learnFeedId', as: 'LearnFeedAccount' });
LearnFeedUser.hasMany(LearnFeedSubscriptionPayment, { foreignKey: 'learnFeedId', sourceKey: 'learnFeedId', as: 'paymentsByLearnFeedId' });


// --- Canonical realtime hooks ---
// Controller-owned transactions can set { realtimeHandled:true } to avoid duplicate events.
function modelSchoolCode(instance) {
  const raw = instance?.toJSON ? instance.toJSON() : (instance || {});
  return raw.schoolCode || raw.schoolId || raw.school || raw.metadata?.schoolCode || raw.metadata?.schoolId || null;
}
const CANONICAL_MODEL_EVENTS = {
  Payment: 'payment:recorded', Fee: 'fee_balance:updated', FeeStructure: 'fee_structure:updated',
  AcademicRecord: 'marks:updated', ReportSnapshot: 'report_card:updated', Attendance: 'attendance:updated',
  HomeTask: 'homework:assigned', HomeTaskAssignment: 'homework:updated',
  ApprovalRequest: 'approval:updated', Student: 'student:updated', Teacher: 'teacher:updated',
  Parent: 'parent:updated', Class: 'class:updated', Message: 'chat:message_created'
};
async function emitModelChange(modelName, action, instance, options = {}) {
  try {
    if (options.realtimeHandled) return;
    const schoolCode = modelSchoolCode(instance);
    if (!schoolCode) return;
    const realtime = require('../services/realtimeService');
    const type = CANONICAL_MODEL_EVENTS[modelName] || `${modelName.toLowerCase()}:updated`;
    const raw = instance?.toJSON ? instance.toJSON() : instance;
    const emit = () => {
      if (modelName === 'Message') {
        const conversation = raw?.metadata?.conversationKey || realtime.directConversationKey(raw?.senderId, raw?.receiverId);
        return realtime.emit({ type: action === 'created' ? 'chat:message_created' : 'chat:message_updated', schoolCode:String(schoolCode), audience:{ school:false, userIds:[raw?.senderId,raw?.receiverId].filter(Boolean), conversations:[conversation] }, entityType:'Message', entityId:raw?.id, version:Number(raw?.version||1), data:{ ...raw, conversationId:conversation, conversationKey:conversation, metadata:{ ...(raw?.metadata || {}), conversationKey:conversation } } });
      }
      return realtime.emitToSchool(String(schoolCode), type, { model:modelName, action, id:instance?.id||null, version:Number(instance?.version||1), updatedAt:instance?.updatedAt||new Date() });
    };
    const safeEmit = () => emit().catch(error => console.error('[canonical realtime hook]', modelName, error.message));
    if (options.transaction?.afterCommit) options.transaction.afterCommit(safeEmit); else await safeEmit();
  } catch (error) { console.error('[Realtime model hook failed]', modelName, action, error.message); }
}
function attachRealtimeHooks(model, modelName) {
  if (!model || model.__realtimeHooksAttached) return;
  model.__realtimeHooksAttached = true;
  model.addHook('afterCreate', (instance, options) => emitModelChange(modelName, 'created', instance, options));
  model.addHook('afterUpdate', (instance, options) => emitModelChange(modelName, 'updated', instance, options));
  model.addHook('afterDestroy', (instance, options) => emitModelChange(modelName, 'deleted', instance, options));
}
[
  [Payment,'Payment'],[PaymentEvent,'PaymentEvent'],[PaymentTransaction,'PaymentTransaction'],[FeeInvoice,'FeeInvoice'],[StudentFeeAccount,'StudentFeeAccount'],[Fee,'Fee'],[FeeStructure,'FeeStructure'],[AcademicRecord,'AcademicRecord'],
  [ReportSnapshot,'ReportSnapshot'],[Attendance,'Attendance'],[HomeTask,'HomeTask'],
  [HomeTaskAssignment,'HomeTaskAssignment'],[ApprovalRequest,'ApprovalRequest'],
  [Student,'Student'],[Teacher,'Teacher'],[Parent,'Parent'],[Class,'Class'],[Message,'Message']
].forEach(([model,name]) => attachRealtimeHooks(model,name));


// Production tenant guard: after a protected request is authenticated, all direct
// queries against models that carry schoolCode are automatically constrained to
// req.user.schoolCode unless the user is super_admin or the query explicitly sets
// skipTenantScope. This is a backstop; controllers should still pass tenant filters.
function installTenantHooks(models) {
  let getTenantContext = null;
  try { ({ getTenantContext } = require('../middleware/requestContext')); } catch (_) {}
  if (!getTenantContext) return;
  Object.values(models).forEach((model) => {
    if (!model || !model.rawAttributes || !model.rawAttributes.schoolCode || model.__tenantHookInstalled) return;
    model.__tenantHookInstalled = true;
    model.addHook('beforeFind', (options = {}) => {
      const ctx = getTenantContext() || {};
      const user = ctx.user;
      if (!user || user.role === 'super_admin' || options.skipTenantScope === true) return;
      if (!user.schoolCode) return;
      options.where = options.where || {};
      if (options.where.schoolCode && options.where.schoolCode !== user.schoolCode) {
        const err = new Error('Cross-school data access blocked');
        err.status = 403;
        throw err;
      }
      options.where.schoolCode = user.schoolCode;
    });
  });
}
installTenantHooks({ User, UserRoleAssignment, School, Student, Teacher, Parent, Admin, AcademicRecord, Attendance, AttendanceSession, AttendanceCorrection, ClassRelease, StudentEnrollment, SchoolCurriculumAssignment, SchoolGradingProfile, PromotionBatch, PromotionDecision, ClassTransferRequest, ReportShare, BirthdayEvent, RealtimeEvent, Fee, FeeStructure, Payment, Message, Alert, ApprovalRequest, DutyRoster, UploadLog, SchoolNameRequest, Class, Settings, Task, HomeTask, HomeTaskAssignment, Subscription, SubscriptionPayment, SchoolPaymentSetting, PaymentEvent, AuditLog, MediaAsset, FinanceExpense, FeeInvoice, FeeInvoiceItem, StudentFeeAccount, PaymentTransaction, PaymentReconciliation, ProviderCredentialsAudit, PaymentRefund, PlatformSubscription, Department, ChatGroup, ChatMessage, ClassroomThread, AchievementEvent, ReportSnapshot, TutorSession, TutorMessage, TutorProgress, TutorUsage, BackgroundJob });

module.exports = {
    sequelize,
    User,
    UserRoleAssignment,
    School,
    Country,
    CurriculumPack,
    SchoolCurriculumAssignment,
    SchoolGradingProfile,
    Student,
    Teacher,
    Parent,
    Admin,
    AcademicRecord,
    Attendance,
    Fee,
    FeeStructure,
    Payment,
    PaymentEvent,
    Message,
    Alert,
    ApprovalRequest,
    DutyRoster,
    UploadLog,
    SchoolNameRequest,
    Class,
    Settings,
    TeacherSubjectAssignment,
    Task,
    HomeTask,
    Competency,
    LearningOutcome,
    HomeTaskAssignment,
    SchoolDPA,
    ParentChildConsent,
    UserConsent,
    StudentCompetencyProgress,
    SchoolCalendar,
    Badge,
    StudentBadge,
    Reward,
    StudentReward,
    SubscriptionPlan,
    ConductLog,
    ResourceViews,
    MoodCheckin,
    Timetable,
    Department,
    DepartmentMember,
    ChatGroup,
    ChatGroupMember,
    ChatMessage,
    ClassroomThread,
    ThreadReply,
    AchievementEvent,
    TutorSession,
    TutorMessage,
    TutorProgress,
    TutorUsage,
    AuditLog,
    ReportSnapshot,
    SchoolPaymentSetting,
    PlatformPaymentSetting,
    PlatformSetting,
    PlatformBackup,
    Subscription,
    SubscriptionPayment,
    FeatureLock,
    RealtimeEvent,
    AttendanceSession,
    AttendanceCorrection,
    AbsenceReport,
    ClassRelease,
    StudentEnrollment,
    PromotionBatch,
    PromotionDecision,
    ClassTransferRequest,
    ReportShare,
    BirthdayEvent,
    MediaAsset,
    FinanceExpense,
    FeeInvoice,
    FeeInvoiceItem,
    StudentFeeAccount,
    PaymentTransaction,
    PaymentReconciliation,
    ProviderCredentialsAudit,
    PaymentRefund,
    PlatformSubscription,
    LearnFeedUser,
    LearnFeedVideo,
    LearnFeedInteraction,
    LearnFeedFollow,
    LearnFeedComment,
    LearnFeedLiveRoom,
    LearnFeedMessage,
    LearnFeedSubscriptionPayment,
    BackgroundJob,
    LearnFeedWalletTransaction,
    StudentParent
};
