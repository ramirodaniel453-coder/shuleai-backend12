module.exports = {
  // Original constants
  CURRICULUM_SYSTEMS: {
    '844': '8-4-4 System',
    'cbc': 'Competency Based Curriculum',
    'british': 'British Curriculum',
    'american': 'American Curriculum'
  },
  TERMS: ['Term 1', 'Term 2', 'Term 3'],
  ASSESSMENT_TYPES: ['test', 'exam', 'assignment', 'project', 'quiz'],
  ATTENDANCE_STATUS: ['present', 'absent', 'late', 'holiday', 'sick'],
  ALERT_TYPES: ['academic', 'attendance', 'fee', 'system', 'improvement', 'duty', 'approval', 'understaffed', 'workload_imbalance', 'conflict_detected'],
  ALERT_SEVERITY: ['critical', 'warning', 'info', 'success'],
  PAYMENT_METHODS: ['mpesa', 'bank', 'cash', 'card'],
  PAYMENT_PLANS: {
    basic: { name: 'Basic Access', price: 5000 },
    premium: { name: 'Premium Access', price: 10000 },
    ultimate: { name: 'Ultimate Access', price: 15000 }
  },
  DUTY_TYPES: ['morning', 'lunch', 'afternoon', 'whole_day'],
  DUTY_AREAS: {
    morning: 'School Gate / Assembly Area',
    lunch: 'Dining Hall / Playground',
    afternoon: 'School Compound / Classrooms',
    whole_day: 'General Supervision'
  },
  DUTY_TIME_SLOTS: {
    morning: { start: '07:30', end: '08:30' },
    lunch: { start: '12:30', end: '14:00' },
    afternoon: { start: '15:30', end: '16:30' },
    whole_day: { start: '07:30', end: '16:30' }
  },
  APPROVAL_STATUS: ['pending', 'approved', 'rejected', 'suspended'],
  UPLOAD_TYPES: ['students', 'marks', 'attendance'],
  SCHOOL_ID_FORMATS: {
    standard: 'SCH-YYYY-XXXXX',
    simple: 'SCHOOLXXX',
    custom: 'PREFIX-XXXXX'
  },
  
  // NEW: Duty requirements per area
  DUTY_REQUIREMENTS: {
    morning: { min: 2, max: 3, priority: 'high' },
    lunch: { min: 3, max: 4, priority: 'high' },
    afternoon: { min: 2, max: 3, priority: 'medium' },
    whole_day: { min: 1, max: 2, priority: 'low' }
  },
  
  // NEW: Fairness calculation weights
  FAIRNESS_WEIGHTS: {
    monthlyCount: 0.4,
    totalDuties: 0.3,
    reliabilityScore: 0.2,
    preferences: 0.1
  },
  
  // NEW: Department list
  DEPARTMENTS: [
    'mathematics',
    'science',
    'languages',
    'humanities',
    'technical',
    'sports',
    'general'
  ],
  
  // NEW: Duty status types
  DUTY_STATUS: {
    SCHEDULED: 'scheduled',
    COMPLETED: 'completed',
    MISSED: 'missed',
    PENDING: 'pending',
    CANCELLED: 'cancelled'
  },
  
  // NEW: Teacher workload thresholds
  WORKLOAD_THRESHOLDS: {
    overworked: 10, // duties per month
    underworked: 3, // duties per month
    critical: 15, // duties per month
    target: 6 // ideal duties per month
  },
  
  // NEW: Conflict types
  CONFLICT_TYPES: {
    TIMETABLE: 'timetable',
    BLACKOUT: 'blackout',
    MAX_WEEKLY: 'max_weekly_reached',
    DUPLICATE: 'duplicate_assignment'
  },
  
  // NEW: Default school settings (extended)
  DEFAULT_SCHOOL_SETTINGS: {
    allowTeacherSignup: true,
    requireApproval: true,
    autoApproveDomains: [],
    dutyManagement: {
      enabled: true,
      reminderHours: 24,
      maxTeachersPerDay: 3,
      checkInWindow: 15,
      teachersPerSlot: {
        morning: 2,
        lunch: 3,
        afternoon: 2,
        whole_day: 1
      },
      autoAssign: true,
      fairnessEnabled: true,
      allowSwaps: true,
      notifyUnderstaffed: true,
      understaffedThreshold: 0.8 // 80% of required
    }
  }
};