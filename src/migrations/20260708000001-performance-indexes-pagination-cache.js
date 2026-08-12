'use strict';

const INDEXES = [
  // Users: auth, role dashboards, school scoping
  ['Users', ['email'], { name: 'idx_perf_users_email' }],
  ['Users', ['schoolCode'], { name: 'idx_perf_users_school_code' }],
  ['Users', ['schoolCode', 'role'], { name: 'idx_perf_users_school_role' }],
  ['Users', ['schoolCode', 'role', 'isActive'], { name: 'idx_perf_users_school_role_active' }],
  ['Users', ['role'], { name: 'idx_perf_users_role' }],
  ['Users', ['createdAt'], { name: 'idx_perf_users_created_at' }],

  // Schools
  ['Schools', ['schoolId'], { name: 'idx_perf_schools_school_id' }],
  ['Schools', ['code'], { name: 'idx_perf_schools_code' }],
  ['Schools', ['status'], { name: 'idx_perf_schools_status' }],
  ['Schools', ['subscriptionStatus'], { name: 'idx_perf_schools_subscription_status' }],

  // Students
  ['Students', ['userId'], { name: 'idx_perf_students_user_id' }],
  ['Students', ['classId'], { name: 'idx_perf_students_class_id' }],
  ['Students', ['status'], { name: 'idx_perf_students_status' }],
  ['Students', ['approvalStatus'], { name: 'idx_perf_students_approval_status' }],
  ['Students', ['elimuid'], { name: 'idx_perf_students_elimuid' }],
  ['Students', ['admissionNumber'], { name: 'idx_perf_students_admission_number' }],
  ['Students', ['createdAt'], { name: 'idx_perf_students_created_at' }],
  ['Students', ['classId', 'status'], { name: 'idx_perf_students_class_status' }],

  // Teachers / Parents
  ['Teachers', ['userId'], { name: 'idx_perf_teachers_user_id' }],
  ['Teachers', ['classId'], { name: 'idx_perf_teachers_class_id' }],
  ['Teachers', ['approvalStatus'], { name: 'idx_perf_teachers_approval_status' }],
  ['Teachers', ['department'], { name: 'idx_perf_teachers_department' }],
  ['Parents', ['userId'], { name: 'idx_perf_parents_user_id' }],

  // Classes and school structure
  ['Classes', ['schoolCode'], { name: 'idx_perf_classes_school_code' }],
  ['Classes', ['schoolCode', 'isActive'], { name: 'idx_perf_classes_school_active' }],
  ['Classes', ['schoolCode', 'grade'], { name: 'idx_perf_classes_school_grade' }],
  ['Classes', ['teacherId'], { name: 'idx_perf_classes_teacher_id' }],
  ['TeacherSubjectAssignments', ['teacherId'], { name: 'idx_perf_tsa_teacher_id' }],
  ['TeacherSubjectAssignments', ['classId'], { name: 'idx_perf_tsa_class_id' }],
  ['TeacherSubjectAssignments', ['teacherId', 'classId'], { name: 'idx_perf_tsa_teacher_class' }],

  // Attendance: high-volume table
  ['Attendances', ['schoolCode', 'date'], { name: 'idx_perf_attendances_school_date' }],
  ['Attendances', ['schoolCode', 'classId', 'date'], { name: 'idx_perf_attendances_school_class_date' }],
  ['Attendances', ['studentId', 'date'], { name: 'idx_perf_attendances_student_date' }],
  ['Attendances', ['schoolCode', 'status'], { name: 'idx_perf_attendances_school_status' }],
  ['Attendances', ['sessionId'], { name: 'idx_perf_attendances_session_id' }],
  // Legacy singular table name support if present.
  ['Attendance', ['schoolCode', 'date'], { name: 'idx_perf_attendance_school_date' }],
  ['Attendance', ['studentId', 'date'], { name: 'idx_perf_attendance_student_date' }],

  // Academic records / reports
  ['AcademicRecords', ['schoolCode', 'year', 'term'], { name: 'idx_perf_academic_school_year_term' }],
  ['AcademicRecords', ['schoolCode', 'classId', 'year', 'term'], { name: 'idx_perf_academic_school_class_year_term' }],
  ['AcademicRecords', ['studentId', 'year', 'term'], { name: 'idx_perf_academic_student_year_term' }],
  ['AcademicRecords', ['studentId', 'subject'], { name: 'idx_perf_academic_student_subject' }],
  ['AcademicRecords', ['subjectId'], { name: 'idx_perf_academic_subject_id' }],
  ['ReportSnapshots', ['schoolCode', 'studentId', 'year', 'term'], { name: 'idx_perf_report_snapshots_student_term' }],
  ['ReportSnapshots', ['schoolCode', 'classId', 'year', 'term'], { name: 'idx_perf_report_snapshots_class_term' }],

  // Fees and payments
  ['Fees', ['schoolCode', 'status'], { name: 'idx_perf_fees_school_status' }],
  ['Fees', ['studentId', 'status'], { name: 'idx_perf_fees_student_status' }],
  ['Fees', ['schoolCode', 'year', 'term'], { name: 'idx_perf_fees_school_year_term' }],
  ['Fees', ['dueDate'], { name: 'idx_perf_fees_due_date' }],
  ['Payments', ['reference'], { name: 'idx_perf_payments_reference' }],
  ['Payments', ['providerReference'], { name: 'idx_perf_payments_provider_reference' }],
  ['Payments', ['schoolCode', 'status'], { name: 'idx_perf_payments_school_status' }],
  ['Payments', ['schoolId', 'status'], { name: 'idx_perf_payments_school_id_status' }],
  ['Payments', ['studentId'], { name: 'idx_perf_payments_student_id' }],
  ['Payments', ['parentId'], { name: 'idx_perf_payments_parent_id' }],
  ['Payments', ['provider', 'status'], { name: 'idx_perf_payments_provider_status' }],
  ['Payments', ['schoolCode', 'createdAt'], { name: 'idx_perf_payments_school_created' }],
  ['PaymentEvents', ['paymentId'], { name: 'idx_perf_payment_events_payment_id' }],
  ['PaymentEvents', ['provider', 'createdAt'], { name: 'idx_perf_payment_events_provider_created' }],

  // Messaging, alerts and real-time feeds
  ['Messages', ['schoolCode', 'createdAt'], { name: 'idx_perf_messages_school_created' }],
  ['Messages', ['senderId', 'createdAt'], { name: 'idx_perf_messages_sender_created' }],
  ['Messages', ['receiverId', 'createdAt'], { name: 'idx_perf_messages_receiver_created' }],
  ['Messages', ['conversationId', 'createdAt'], { name: 'idx_perf_messages_conversation_created' }],
  ['Messages', ['receiverId', 'isRead'], { name: 'idx_perf_messages_receiver_unread' }],
  ['Alerts', ['userId', 'createdAt'], { name: 'idx_perf_alerts_user_created' }],
  ['Alerts', ['userId', 'isRead'], { name: 'idx_perf_alerts_user_read' }],
  ['Alerts', ['schoolCode', 'createdAt'], { name: 'idx_perf_alerts_school_created' }],
  ['Alerts', ['role', 'createdAt'], { name: 'idx_perf_alerts_role_created' }],
  ['ChatMessages', ['groupId', 'createdAt'], { name: 'idx_perf_chat_messages_group_created' }],
  ['ChatMessages', ['senderId', 'createdAt'], { name: 'idx_perf_chat_messages_sender_created' }],

  // Duty, tasks, calendars, uploads
  ['DutyRosters', ['schoolCode', 'date'], { name: 'idx_perf_duty_rosters_school_date' }],
  ['DutyRosters', ['teacherId', 'date'], { name: 'idx_perf_duty_rosters_teacher_date' }],
  ['Tasks', ['userId', 'status'], { name: 'idx_perf_tasks_user_status' }],
  ['Tasks', ['schoolCode', 'status'], { name: 'idx_perf_tasks_school_status' }],
  ['SchoolCalendars', ['schoolCode', 'startDate'], { name: 'idx_perf_calendars_school_start' }],
  ['SchoolCalendars', ['classId', 'startDate'], { name: 'idx_perf_calendars_class_start' }],
  ['UploadLogs', ['uploadedBy', 'createdAt'], { name: 'idx_perf_uploads_user_created' }],

  // LearnFeed high-volume content/feed tables
  ['LearnFeedVideos', ['createdAt'], { name: 'idx_perf_lfv_created_at' }],
  ['LearnFeedVideos', ['userId', 'createdAt'], { name: 'idx_perf_lfv_user_created' }],
  ['LearnFeedInteractions', ['videoId', 'type'], { name: 'idx_perf_lfi_video_type' }],
  ['LearnFeedComments', ['videoId', 'createdAt'], { name: 'idx_perf_lfc_video_created' }],
  ['LearnFeedFollows', ['followerId'], { name: 'idx_perf_lff_follower' }],
  ['LearnFeedFollows', ['followingId'], { name: 'idx_perf_lff_following' }]
];

async function tableExists(queryInterface, table) {
  const rows = await queryInterface.sequelize.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table LIMIT 1',
    { replacements: { table }, type: queryInterface.sequelize.QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function columnsExist(queryInterface, table, columns) {
  const rows = await queryInterface.sequelize.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name IN (:columns)',
    { replacements: { table, columns }, type: queryInterface.sequelize.QueryTypes.SELECT }
  );
  const found = new Set(rows.map((row) => row.column_name));
  return columns.every((column) => found.has(column));
}

async function safeAddIndex(queryInterface, table, fields, options) {
  const name = options.name;
  try {
    if (!(await tableExists(queryInterface, table))) {
      console.log(`Skipping ${name}: table ${table} does not exist`);
      return;
    }
    if (!(await columnsExist(queryInterface, table, fields))) {
      console.log(`Skipping ${name}: one or more columns missing on ${table} (${fields.join(', ')})`);
      return;
    }
    await queryInterface.addIndex(table, fields, options);
  } catch (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('already exists') || msg.includes('relation') && msg.includes('already exists')) {
      console.log(`Index already exists: ${name}`);
      return;
    }
    if (options.unique && (msg.includes('could not create unique index') || msg.includes('duplicate key'))) {
      console.warn(`Skipped unique index ${name}: duplicate rows must be cleaned first.`);
      return;
    }
    throw error;
  }
}

async function safeRemoveIndex(queryInterface, table, name) {
  try {
    await queryInterface.removeIndex(table, name);
  } catch (error) {
    console.log(`Skipping remove ${name}: ${error.message}`);
  }
}

module.exports = {
  async up(queryInterface) {
    for (const [table, fields, options] of INDEXES) {
      await safeAddIndex(queryInterface, table, fields, options);
    }
  },

  async down(queryInterface) {
    for (const [table, , options] of [...INDEXES].reverse()) {
      await safeRemoveIndex(queryInterface, table, options.name);
    }
  }
};
