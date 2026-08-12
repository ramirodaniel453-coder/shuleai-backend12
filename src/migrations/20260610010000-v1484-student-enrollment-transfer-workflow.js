'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const jsonDefault = Sequelize.literal("'{}'::jsonb");
    const add = async (table, name, type) => queryInterface.addColumn(table, name, type);

    await add('StudentEnrollments', 'startTerm', { type: Sequelize.STRING(20), allowNull: true });
    await add('StudentEnrollments', 'endTerm', { type: Sequelize.STRING(20), allowNull: true });
    await add('StudentEnrollments', 'movementType', { type: Sequelize.STRING(40), allowNull: true });
    await add('StudentEnrollments', 'movementReason', { type: Sequelize.STRING(120), allowNull: true });
    await add('StudentEnrollments', 'movementRequestId', { type: Sequelize.INTEGER, allowNull: true });
    await add('StudentEnrollments', 'previousEnrollmentId', { type: Sequelize.INTEGER, allowNull: true });
    await add('StudentEnrollments', 'classTeacherIdAtStart', { type: Sequelize.INTEGER, allowNull: true });
    await add('StudentEnrollments', 'classTeacherIdAtEnd', { type: Sequelize.INTEGER, allowNull: true });

    await queryInterface.createTable('ClassTransferRequests', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false },
      requestedBy: { type: Sequelize.INTEGER, allowNull: false },
      requestedByRole: { type: Sequelize.STRING(30), allowNull: false },
      fromEnrollmentId: Sequelize.INTEGER,
      fromClassId: { type: Sequelize.INTEGER, allowNull: false },
      toClassId: { type: Sequelize.INTEGER, allowNull: false },
      academicYear: { type: Sequelize.INTEGER, allowNull: false },
      term: { type: Sequelize.STRING(20), allowNull: false },
      effectiveDate: { type: Sequelize.DATEONLY, allowNull: false },
      reason: { type: Sequelize.STRING(120), allowNull: false },
      note: Sequelize.TEXT,
      feeAction: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'keep_current_period' },
      feePreview: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      impactPreview: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'pending' },
      approvedBy: Sequelize.INTEGER,
      approvedAt: Sequelize.DATE,
      rejectedBy: Sequelize.INTEGER,
      rejectedAt: Sequelize.DATE,
      rejectionReason: Sequelize.TEXT,
      appliedBy: Sequelize.INTEGER,
      appliedAt: Sequelize.DATE,
      appliedEnrollmentId: Sequelize.INTEGER,
      rollbackBy: Sequelize.INTEGER,
      rollbackAt: Sequelize.DATE,
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: jsonDefault },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.sequelize.query(`
      UPDATE "StudentEnrollments" e
      SET "classTeacherIdAtStart" = c."teacherId"
      FROM "Classes" c
      WHERE e."classId" = c.id
        AND e."schoolCode" = c."schoolCode"
        AND e."classTeacherIdAtStart" IS NULL;
    `);

    // Older deployments sometimes stored the class-teacher link on the Teacher
    // profile or assignment table instead of Classes.teacherId. Backfill those
    // supported representations without rewriting the class itself.
    await queryInterface.sequelize.query(`
      UPDATE "StudentEnrollments" e
      SET "classTeacherIdAtStart" = t.id
      FROM "Teachers" t
      JOIN "Users" u ON u.id = t."userId"
      WHERE t."classId" = e."classId"
        AND u."schoolCode" = e."schoolCode"
        AND e."classTeacherIdAtStart" IS NULL;
    `).catch(() => null);
    await queryInterface.sequelize.query(`
      UPDATE "StudentEnrollments" e
      SET "classTeacherIdAtStart" = a."teacherId"
      FROM "TeacherSubjectAssignments" a
      WHERE a."classId" = e."classId"
        AND a."isClassTeacher" = TRUE
        AND e."classTeacherIdAtStart" IS NULL;
    `).catch(() => null);
    await queryInterface.sequelize.query(`
      UPDATE "StudentEnrollments"
      SET "classTeacherIdAtEnd" = "classTeacherIdAtStart"
      WHERE status <> 'active'
        AND "classTeacherIdAtEnd" IS NULL
        AND "classTeacherIdAtStart" IS NOT NULL;
    `);

    await queryInterface.addIndex('ClassTransferRequests', ['schoolCode','status','effectiveDate'], { name:'idx_class_transfer_due' });
    await queryInterface.addIndex('ClassTransferRequests', ['schoolCode','studentId','createdAt'], { name:'idx_class_transfer_student' });
    await queryInterface.addIndex('StudentEnrollments', ['schoolCode','studentId','effectiveFrom','effectiveTo'], { name:'idx_enrollment_effective_dates' });

    // Preserve every enrollment row, but close duplicate active rows before enforcing the invariant.
    await queryInterface.sequelize.query(`
      WITH ranked AS (
        SELECT id, "schoolCode", "studentId", "effectiveFrom",
               ROW_NUMBER() OVER (PARTITION BY "schoolCode", "studentId" ORDER BY "effectiveFrom" DESC, id DESC) AS rn,
               MAX("effectiveFrom") OVER (PARTITION BY "schoolCode", "studentId") AS keeper_start
        FROM "StudentEnrollments"
        WHERE status = 'active'
      )
      UPDATE "StudentEnrollments" e
      SET status = 'closed',
          "effectiveTo" = GREATEST(e."effectiveFrom", LEAST(COALESCE(e."effectiveTo", r.keeper_start - 1), r.keeper_start - 1)),
          "endedReason" = COALESCE(e."endedReason", 'duplicate_active_enrollment_cleanup'),
          metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object('v1484DuplicateActiveCleanup', true),
          "updatedAt" = NOW()
      FROM ranked r
      WHERE e.id = r.id AND r.rn > 1;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_student_one_active_enrollment
      ON "StudentEnrollments" ("schoolCode", "studentId")
      WHERE status = 'active';
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_student_open_transfer_request
      ON "ClassTransferRequests" ("schoolCode", "studentId")
      WHERE status IN ('pending','approved','scheduled');
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS "uq_student_open_transfer_request"').catch(()=>null);
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS "uq_student_one_active_enrollment"').catch(()=>null);
    await queryInterface.dropTable('ClassTransferRequests').catch(()=>null);
    for (const column of ['classTeacherIdAtEnd','classTeacherIdAtStart','previousEnrollmentId','movementRequestId','movementReason','movementType','endTerm','startTerm']) {
      await queryInterface.removeColumn('StudentEnrollments', column).catch(()=>null);
    }
  }
};
