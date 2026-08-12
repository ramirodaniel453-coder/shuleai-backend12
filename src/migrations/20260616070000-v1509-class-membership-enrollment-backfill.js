module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    await q.query(`ALTER TABLE IF EXISTS "StudentEnrollments" ADD COLUMN IF NOT EXISTS "startTerm" VARCHAR(20)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentEnrollments" ADD COLUMN IF NOT EXISTS "endTerm" VARCHAR(20)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentEnrollments" ADD COLUMN IF NOT EXISTS "movementType" VARCHAR(40)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentEnrollments" ADD COLUMN IF NOT EXISTS "movementReason" VARCHAR(120)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentEnrollments" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Students" ADD COLUMN IF NOT EXISTS "activeEnrollmentId" INTEGER`).catch(() => null);

    // 1) Create active enrollments for students that already have a valid classId.
    await q.query(`
      INSERT INTO "StudentEnrollments" (
        "schoolCode", "studentId", "classId", "stream", "academicYear", "status", "effectiveFrom",
        "startTerm", "createdBy", "classTeacherIdAtStart", "movementType", "movementReason", "metadata", "createdAt", "updatedAt"
      )
      SELECT u."schoolCode", s.id, c.id, c.stream,
             COALESCE(NULLIF(regexp_replace(COALESCE(c."academicYear", EXTRACT(YEAR FROM NOW())::text), '[^0-9]', '', 'g'), '')::int, EXTRACT(YEAR FROM NOW())::int),
             'active', COALESCE(s."enrollmentDate"::date, CURRENT_DATE),
             'Term 1', NULL, c."teacherId", 'admission_backfill',
             'Backfilled from existing Students.classId by v1509',
             jsonb_build_object('source','v1509_direct_classId_backfill'), NOW(), NOW()
      FROM "Students" s
      JOIN "Users" u ON u.id = s."userId" AND u.role = 'student'
      JOIN "Classes" c ON c.id = s."classId" AND c."schoolCode" = u."schoolCode" AND COALESCE(c."isActive", TRUE) = TRUE
      WHERE s."classId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "StudentEnrollments" e
          WHERE e."schoolCode" = u."schoolCode" AND e."studentId" = s.id AND e.status = 'active'
        );
    `);

    // 2) Create active enrollments for students whose legacy grade has exactly one best active-class match.
    await q.query(`
      WITH candidates AS (
        SELECT s.id AS "studentId", u."schoolCode", c.id AS "classId", c.stream, c."teacherId", c."academicYear", s."enrollmentDate",
               CASE
                 WHEN lower(trim(c.name)) = lower(trim(s.grade)) THEN 1
                 WHEN regexp_replace(lower(trim(c.name)), '[[:space:]]+', '', 'g') = regexp_replace(lower(trim(s.grade)), '[[:space:]]+', '', 'g') THEN 2
                 WHEN c.stream IS NOT NULL AND lower(trim(c.grade || ' ' || c.stream)) = lower(trim(s.grade)) THEN 3
                 WHEN lower(trim(c.grade)) = lower(trim(s.grade)) THEN 4
                 ELSE 9
               END AS priority
        FROM "Students" s
        JOIN "Users" u ON u.id = s."userId" AND u.role = 'student'
        JOIN "Classes" c ON c."schoolCode" = u."schoolCode" AND COALESCE(c."isActive", TRUE) = TRUE
        WHERE s."classId" IS NULL
          AND COALESCE(NULLIF(trim(s.grade), ''), 'Not Assigned') <> 'Not Assigned'
          AND NOT EXISTS (
            SELECT 1 FROM "StudentEnrollments" e
            WHERE e."schoolCode" = u."schoolCode" AND e."studentId" = s.id AND e.status = 'active'
          )
          AND (
            lower(trim(c.name)) = lower(trim(s.grade))
            OR regexp_replace(lower(trim(c.name)), '[[:space:]]+', '', 'g') = regexp_replace(lower(trim(s.grade)), '[[:space:]]+', '', 'g')
            OR (c.stream IS NOT NULL AND lower(trim(c.grade || ' ' || c.stream)) = lower(trim(s.grade)))
            OR lower(trim(c.grade)) = lower(trim(s.grade))
          )
      ), best AS (
        SELECT "studentId", MIN(priority) AS best_priority
        FROM candidates
        GROUP BY "studentId"
      ), ranked AS (
        SELECT c.*,
               b.best_priority,
               COUNT(*) OVER (PARTITION BY c."studentId", c.priority) AS best_count,
               ROW_NUMBER() OVER (PARTITION BY c."studentId" ORDER BY c.priority, c."classId") AS rn
        FROM candidates c
        JOIN best b ON b."studentId" = c."studentId"
        WHERE c.priority = b.best_priority
      ), safe AS (
        SELECT * FROM ranked
        WHERE rn = 1 AND best_count = 1
      ), inserted AS (
        INSERT INTO "StudentEnrollments" (
          "schoolCode", "studentId", "classId", "stream", "academicYear", "status", "effectiveFrom",
          "startTerm", "createdBy", "classTeacherIdAtStart", "movementType", "movementReason", "metadata", "createdAt", "updatedAt"
        )
        SELECT "schoolCode", "studentId", "classId", stream,
               COALESCE(NULLIF(regexp_replace(COALESCE("academicYear", EXTRACT(YEAR FROM NOW())::text), '[^0-9]', '', 'g'), '')::int, EXTRACT(YEAR FROM NOW())::int),
               'active', COALESCE("enrollmentDate"::date, CURRENT_DATE),
               'Term 1', NULL, "teacherId", 'admission_backfill',
               'Backfilled from exact legacy grade/class match by v1509',
               jsonb_build_object('source','v1509_legacy_grade_backfill'), NOW(), NOW()
        FROM safe
        RETURNING id, "studentId", "classId"
      )
      UPDATE "Students" s
      SET "classId" = i."classId",
          "activeEnrollmentId" = i.id,
          "updatedAt" = NOW()
      FROM inserted i
      WHERE s.id = i."studentId";
    `);

    // 3) Sync Students.activeEnrollmentId/classId from any active enrollment that already exists.
    await q.query(`
      WITH ranked AS (
        SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e."schoolCode", e."studentId" ORDER BY e."effectiveFrom" DESC, e.id DESC) AS rn
        FROM "StudentEnrollments" e
        WHERE e.status = 'active'
      )
      UPDATE "Students" s
      SET "activeEnrollmentId" = r.id,
          "classId" = COALESCE(s."classId", r."classId"),
          grade = COALESCE(c.name, s.grade),
          "updatedAt" = NOW()
      FROM ranked r
      LEFT JOIN "Classes" c ON c.id = r."classId" AND c."schoolCode" = r."schoolCode"
      WHERE r.rn = 1 AND s.id = r."studentId";
    `);

    await q.query(`CREATE INDEX IF NOT EXISTS "idx_student_enrollments_v1509_active_class" ON "StudentEnrollments" ("schoolCode", "classId", "status")`).catch(() => null);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_students_v1509_classid" ON "Students" ("classId")`).catch(() => null);
  },
  async down() {
    throw new Error('Irreversible migration 20260616070000-v1509-class-membership-enrollment-backfill.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
