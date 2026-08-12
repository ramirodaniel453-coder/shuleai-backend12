'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const jsonDefault = Sequelize.literal("'{}'::jsonb");
    const listDefault = Sequelize.literal("'[]'::jsonb");

    await queryInterface.createTable('RealtimeEvents', {
      id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
      eventType: { type: Sequelize.STRING(120), allowNull: false },
      schoolCode: { type: Sequelize.STRING, allowNull: true },
      audience: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      entityType: { type: Sequelize.STRING(120), allowNull: true },
      entityId: { type: Sequelize.STRING(120), allowNull: true },
      recordVersion: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'pending' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      emittedAt: { type: Sequelize.DATE, allowNull: true },
      lastError: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('AttendanceSessions', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      classId: { type: Sequelize.INTEGER, allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'not_started' },
      startedBy: Sequelize.INTEGER,
      submittedBy: Sequelize.INTEGER,
      submittedAt: Sequelize.DATE,
      lockedAt: Sequelize.DATE,
      timezone: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'Africa/Nairobi' },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('AttendanceCorrections', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      sessionId: { type: Sequelize.INTEGER, allowNull: false },
      attendanceId: { type: Sequelize.INTEGER, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false },
      previousStatus: { type: Sequelize.STRING(30), allowNull: false },
      newStatus: { type: Sequelize.STRING(30), allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: false },
      note: Sequelize.TEXT,
      correctedBy: { type: Sequelize.INTEGER, allowNull: false },
      correctedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('ClassReleases', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      classId: { type: Sequelize.INTEGER, allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      updateNumber: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      releaseType: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'normal' },
      message: { type: Sequelize.TEXT, allowNull: false },
      channel: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'platform' },
      releasedBy: { type: Sequelize.INTEGER, allowNull: false },
      releasedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      parentTargetCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      successCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      failedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('StudentEnrollments', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false },
      classId: Sequelize.INTEGER,
      stream: Sequelize.STRING,
      academicYear: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'active' },
      effectiveFrom: { type: Sequelize.DATEONLY, allowNull: false },
      effectiveTo: Sequelize.DATEONLY,
      endedReason: Sequelize.STRING(80),
      createdBy: Sequelize.INTEGER,
      closedBy: Sequelize.INTEGER,
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('PromotionBatches', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      closingYear: { type: Sequelize.INTEGER, allowNull: false },
      newYear: { type: Sequelize.INTEGER, allowNull: false },
      effectiveDate: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'draft' },
      createdBy: { type: Sequelize.INTEGER, allowNull: false },
      confirmedBy: Sequelize.INTEGER,
      confirmedAt: Sequelize.DATE,
      rollbackBy: Sequelize.INTEGER,
      rollbackAt: Sequelize.DATE,
      summary: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('PromotionDecisions', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      batchId: { type: Sequelize.INTEGER, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false },
      currentEnrollmentId: Sequelize.INTEGER,
      fromClassId: Sequelize.INTEGER,
      toClassId: Sequelize.INTEGER,
      fromStream: Sequelize.STRING,
      toStream: Sequelize.STRING,
      outcome: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'promote' },
      warnings: { type: Sequelize.JSONB, allowNull: false, defaultValue: listDefault },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'proposed' },
      appliedEnrollmentId: Sequelize.INTEGER,
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('ReportShares', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      reportSnapshotId: { type: Sequelize.INTEGER, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false },
      recipientUserId: Sequelize.INTEGER,
      channel: { type: Sequelize.STRING(30), allowNull: false },
      recipientAddress: Sequelize.STRING,
      tokenHash: Sequelize.STRING,
      expiresAt: Sequelize.DATE,
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'queued' },
      sentBy: { type: Sequelize.INTEGER, allowNull: false },
      sentAt: Sequelize.DATE,
      deliveredAt: Sequelize.DATE,
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.createTable('BirthdayEvents', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false },
      eventDate: { type: Sequelize.DATEONLY, allowNull: false },
      eventType: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'same_day' },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'created' },
      audience: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdBy: Sequelize.INTEGER,
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.addColumn('Students', 'activeEnrollmentId', { type: Sequelize.INTEGER, allowNull: true });

    await queryInterface.addColumn('Attendances', 'sessionId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Attendances', 'version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
    await queryInterface.addColumn('Attendances', 'lockedAt', { type: Sequelize.DATE, allowNull: true });

    await queryInterface.addColumn('ChatMessages', 'clientMessageId', { type: Sequelize.STRING(120), allowNull: true });
    await queryInterface.addColumn('ChatMessages', 'conversationKey', { type: Sequelize.STRING(220), allowNull: true });
    await queryInterface.addColumn('ChatMessages', 'deliveryStatus', { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'sent' });
    await queryInterface.addColumn('ChatMessages', 'deliveredAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('ChatMessages', 'readAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('ChatMessages', 'version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });

    await queryInterface.addColumn('ThreadReplies', 'clientMessageId', { type: Sequelize.STRING(120), allowNull: true });
    await queryInterface.addColumn('ThreadReplies', 'version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });

    await queryInterface.addColumn('ReportSnapshots', 'version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
    await queryInterface.addColumn('ReportSnapshots', 'assessmentKey', { type: Sequelize.STRING(120), allowNull: false, defaultValue: 'term' });
    await queryInterface.addColumn('ReportSnapshots', 'supersedesId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('ReportSnapshots', 'correctionReason', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('ReportSnapshots', 'isCurrent', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await queryInterface.addColumn('ReportSnapshots', 'lockedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('ReportSnapshots', 'formatVersion', { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'v143' });

    // Existing installations may already contain several snapshots for the same
    // learner/term. Convert those rows into deterministic immutable versions before
    // the partial unique-current index is created, otherwise deployment can fail.
    await queryInterface.sequelize.query(`
      WITH ranked AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "schoolCode", "studentId", "term", "year", "reportType", COALESCE(NULLIF("assessmentKey", ''), 'term')
            ORDER BY COALESCE("publishedAt", "createdAt") ASC, "id" ASC
          ) AS calculated_version,
          ROW_NUMBER() OVER (
            PARTITION BY "schoolCode", "studentId", "term", "year", "reportType", COALESCE(NULLIF("assessmentKey", ''), 'term')
            ORDER BY COALESCE("publishedAt", "createdAt") DESC, "id" DESC
          ) AS current_rank
        FROM "ReportSnapshots"
      )
      UPDATE "ReportSnapshots" AS snapshot
      SET
        "assessmentKey" = COALESCE(NULLIF(snapshot."assessmentKey", ''), 'term'),
        "version" = ranked.calculated_version,
        "isCurrent" = (ranked.current_rank = 1),
        "lockedAt" = COALESCE(snapshot."lockedAt", snapshot."publishedAt", snapshot."createdAt")
      FROM ranked
      WHERE snapshot."id" = ranked."id";
    `);

    await queryInterface.sequelize.query(`
      DO $$
      DECLARE idx RECORD;
      BEGIN
        FOR idx IN
          SELECT indexname FROM pg_indexes
          WHERE tablename = 'ReportSnapshots'
            AND indexdef ILIKE '%UNIQUE%'
            AND indexdef ILIKE '%schoolCode%'
            AND indexdef ILIKE '%studentId%'
            AND indexdef ILIKE '%reportType%'
        LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I', idx.indexname);
        END LOOP;
      END $$;
    `).catch(() => null);

    const indexes = [
      ['RealtimeEvents', ['schoolCode','id'], { name:'idx_realtime_school_cursor' }],
      ['RealtimeEvents', ['status','createdAt'], { name:'idx_realtime_pending' }],
      ['AttendanceSessions', ['schoolCode','classId','date'], { unique:true, name:'uq_attendance_session_day' }],
      ['AttendanceCorrections', ['attendanceId','correctedAt'], { name:'idx_attendance_correction_history' }],
      ['ClassReleases', ['schoolCode','classId','date','updateNumber'], { unique:true, name:'uq_class_release_update' }],
      ['StudentEnrollments', ['schoolCode','studentId','academicYear'], { name:'idx_enrollment_history' }],
      ['PromotionDecisions', ['batchId','studentId'], { unique:true, name:'uq_promotion_student' }],
      ['ReportShares', ['tokenHash'], { name:'idx_report_share_token' }],
      ['BirthdayEvents', ['schoolCode','studentId','eventDate','eventType'], { unique:true, name:'uq_birthday_event' }],
      ['ChatMessages', ['schoolCode','senderId','clientMessageId'], { unique:true, name:'uq_chat_client_message' }],
      ['ThreadReplies', ['threadId','userId','clientMessageId'], { unique:true, name:'uq_thread_reply_client_message' }],
      ['ReportSnapshots', ['schoolCode','studentId','term','year','reportType','assessmentKey','version'], { unique:true, name:'uq_report_snapshot_version' }],
      ['ReportSnapshots', ['schoolCode','studentId','isCurrent'], { name:'idx_report_current' }]
    ];
    for (const [table, fields, opts] of indexes) await queryInterface.addIndex(table, fields, opts);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_report_snapshot_current
      ON "ReportSnapshots" ("schoolCode", "studentId", "term", "year", "reportType", "assessmentKey")
      WHERE "isCurrent" = true;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS "uq_report_snapshot_current"').catch(() => null);
    const indexes = [
      ['ReportSnapshots','uq_report_snapshot_version'], ['ReportSnapshots','idx_report_current'],
      ['ThreadReplies','uq_thread_reply_client_message'], ['ChatMessages','uq_chat_client_message']
    ];
    for (const [table, name] of indexes) await queryInterface.removeIndex(table, name).catch(() => null);

    const columns = {
      ReportSnapshots: ['formatVersion','lockedAt','isCurrent','correctionReason','supersedesId','assessmentKey','version'],
      ThreadReplies: ['version','clientMessageId'],
      ChatMessages: ['version','readAt','deliveredAt','deliveryStatus','conversationKey','clientMessageId'],
      Attendances: ['version','lockedAt','sessionId'],
      Students: ['birthdayPrivacy','dateOfBirthVerified']
    };
    for (const [table, names] of Object.entries(columns)) {
      for (const name of names) await queryInterface.removeColumn(table, name).catch(() => null);
    }

    const tables = ['BirthdayEvents','ReportShares','PromotionDecisions','PromotionBatches','StudentEnrollments','ClassReleases','AttendanceCorrections','AttendanceSessions','RealtimeEvents'];
    for (const table of tables) await queryInterface.dropTable(table).catch(() => null);
  }
};
