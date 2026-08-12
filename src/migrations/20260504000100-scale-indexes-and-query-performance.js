const INDEXES = [
  ['Users', ['schoolCode', 'role'], 'idx_users_school_role'],
  ['Users', ['schoolCode', 'isActive'], 'idx_users_school_active'],
  ['Users', ['role'], 'idx_users_role'],
  ['Users', ['phone'], 'idx_users_phone'],
  ['Students', ['userId'], 'idx_students_user_id'],
  ['Students', ['grade', 'status'], 'idx_students_grade_status'],
  ['Students', ['status'], 'idx_students_status'],
  ['Students', ['approvalStatus'], 'idx_students_approval_status'],
  ['Teachers', ['userId'], 'idx_teachers_user_id'],
  ['Teachers', ['classId'], 'idx_teachers_class_id'],
  ['Teachers', ['department'], 'idx_teachers_department'],
  ['Teachers', ['approvalStatus'], 'idx_teachers_approval_status'],
  ['Parents', ['userId'], 'idx_parents_user_id'],
  ['Classes', ['schoolCode'], 'idx_classes_school_code'],
  ['Classes', ['schoolCode', 'grade'], 'idx_classes_school_grade'],
  ['AcademicRecords', ['schoolCode', 'year', 'term'], 'idx_records_school_year_term'],
  ['AcademicRecords', ['studentId', 'year', 'term'], 'idx_records_student_year_term'],
  ['AcademicRecords', ['schoolCode', 'subject'], 'idx_records_school_subject'],
  ['AcademicRecords', ['schoolCode', 'isPublished'], 'idx_records_school_published'],
  ['Attendance', ['schoolCode', 'date'], 'idx_attendance_school_date'],
  ['Attendance', ['studentId', 'date'], 'idx_attendance_student_date'],
  ['Attendance', ['schoolCode', 'status'], 'idx_attendance_school_status'],
  ['Attendances', ['schoolCode', 'date'], 'idx_attendances_school_date'],
  ['Attendances', ['studentId', 'date'], 'idx_attendances_student_date'],
  ['Attendances', ['schoolCode', 'status'], 'idx_attendances_school_status'],
  ['Fees', ['schoolCode', 'year', 'term'], 'idx_fees_school_year_term'],
  ['Fees', ['studentId', 'year', 'term'], 'idx_fees_student_year_term'],
  ['Fees', ['schoolCode', 'status'], 'idx_fees_school_status'],
  ['Payments', ['schoolCode', 'status'], 'idx_payments_school_status'],
  ['Payments', ['studentId'], 'idx_payments_student_id'],
  ['Payments', ['parentId'], 'idx_payments_parent_id'],
  ['Payments', ['paymentType', 'status'], 'idx_payments_type_status'],
  ['Messages', ['senderId', 'createdAt'], 'idx_messages_sender_created'],
  ['Messages', ['receiverId', 'createdAt'], 'idx_messages_receiver_created'],
  ['Alerts', ['role', 'createdAt'], 'idx_alerts_role_created'],
  ['Tasks', ['userId', 'status'], 'idx_tasks_user_status'],
  ['UploadLogs', ['uploadedBy', 'createdAt'], 'idx_uploads_user_created'],
  ['ChatMessages', ['groupId', 'createdAt'], 'idx_chat_messages_group_created'],
  ['ChatMessages', ['senderId', 'createdAt'], 'idx_chat_messages_sender_created'],
  ['SchoolCalendars', ['schoolCode', 'startDate'], 'idx_calendar_school_start'],
  ['Timetables', ['schoolCode', 'classId'], 'idx_timetables_school_class']
];

async function safeAddIndex(queryInterface, table, fields, name) {
  try {
    await queryInterface.addIndex(table, fields, { name });
  } catch (error) {
    const msg = String(error.message || '').toLowerCase();
    if (!msg.includes('already exists') && !msg.includes('does not exist')) throw error;
    console.log(`Skipping index ${name}: ${error.message}`);
  }
}

async function safeRemoveIndex(queryInterface, table, name) {
  try { await queryInterface.removeIndex(table, name); } catch (error) { console.log(`Skipping remove ${name}: ${error.message}`); }
}

module.exports = {
  async up(queryInterface) {
    for (const [table, fields, name] of INDEXES) await safeAddIndex(queryInterface, table, fields, name);
  },
  async down(queryInterface) {
    for (const [table, , name] of [...INDEXES].reverse()) await safeRemoveIndex(queryInterface, table, name);
  }
};
