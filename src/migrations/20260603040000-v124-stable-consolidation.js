'use strict';

module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    // Parent-child link hardening and audit support.
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "status" VARCHAR(30) DEFAULT 'active'`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50) DEFAULT 'manual'`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP WITH TIME ZONE`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "verifiedBy" INTEGER`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "StudentParents" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}'::jsonb`).catch(() => null);
    await q.query(`UPDATE "StudentParents" SET "status" = COALESCE("status", 'active') WHERE "status" IS NULL`).catch(() => null);

    // Heal safe legacy links before deleting bad ones: earlier versions sometimes stored User.id in StudentParents.
    await q.query(`
      INSERT INTO "StudentParents" ("studentId", "parentId", "status", "source", "createdAt", "updatedAt")
      SELECT DISTINCT s."id", p."id", 'active', 'v124_healed_student_user_parent_user', NOW(), NOW()
      FROM "StudentParents" sp
      JOIN "Students" s ON s."userId" = sp."studentId"
      JOIN "Parents" p ON p."userId" = sp."parentId"
      JOIN "Users" su ON su."id" = s."userId"
      JOIN "Users" pu ON pu."id" = p."userId"
      WHERE su."schoolCode" = pu."schoolCode"
      ON CONFLICT ("studentId", "parentId") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt", "status" = COALESCE("StudentParents"."status", 'active')
    `).catch(() => null);
    await q.query(`
      INSERT INTO "StudentParents" ("studentId", "parentId", "status", "source", "createdAt", "updatedAt")
      SELECT DISTINCT sp."studentId", p."id", 'active', 'v124_healed_parent_user', NOW(), NOW()
      FROM "StudentParents" sp
      JOIN "Students" s ON s."id" = sp."studentId"
      JOIN "Parents" p ON p."userId" = sp."parentId"
      JOIN "Users" su ON su."id" = s."userId"
      JOIN "Users" pu ON pu."id" = p."userId"
      WHERE su."schoolCode" = pu."schoolCode"
      ON CONFLICT ("studentId", "parentId") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt", "status" = COALESCE("StudentParents"."status", 'active')
    `).catch(() => null);
    await q.query(`
      INSERT INTO "StudentParents" ("studentId", "parentId", "status", "source", "createdAt", "updatedAt")
      SELECT DISTINCT s."id", sp."parentId", 'active', 'v124_healed_student_user', NOW(), NOW()
      FROM "StudentParents" sp
      JOIN "Students" s ON s."userId" = sp."studentId"
      JOIN "Parents" p ON p."id" = sp."parentId"
      JOIN "Users" su ON su."id" = s."userId"
      JOIN "Users" pu ON pu."id" = p."userId"
      WHERE su."schoolCode" = pu."schoolCode"
      ON CONFLICT ("studentId", "parentId") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt", "status" = COALESCE("StudentParents"."status", 'active')
    `).catch(() => null);

    // Preserve but quarantine links that still point to missing records or cross schools.
    await q.query(`
      UPDATE "StudentParents" sp
         SET "status"='quarantined',
             "metadata"=COALESCE(sp."metadata", '{}'::jsonb) || jsonb_build_object(
               'quarantineReason','missing_student_or_parent',
               'quarantinedAt',NOW()
             ),
             "updatedAt"=NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "Students" s WHERE s."id" = sp."studentId")
         OR NOT EXISTS (SELECT 1 FROM "Parents" p WHERE p."id" = sp."parentId")
    `).catch(() => null);
    await q.query(`
      UPDATE "StudentParents" sp
         SET "status"='quarantined',
             "metadata"=COALESCE(sp."metadata", '{}'::jsonb) || jsonb_build_object(
               'quarantineReason','cross_school_parent_link',
               'quarantinedAt',NOW()
             ),
             "updatedAt"=NOW()
        FROM "Students" s, "Parents" p, "Users" su, "Users" pu
      WHERE sp."studentId" = s."id"
        AND sp."parentId" = p."id"
        AND su."id" = s."userId"
        AND pu."id" = p."userId"
        AND su."schoolCode" IS DISTINCT FROM pu."schoolCode"
    `).catch(() => null);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_studentparents_secure_lookup" ON "StudentParents" ("studentId", "parentId", "status")`).catch(() => null);

    // Alert labels everywhere.
    await q.query(`ALTER TABLE IF EXISTS "Alerts" ADD COLUMN IF NOT EXISTS "sourceLabel" VARCHAR(120)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Alerts" ADD COLUMN IF NOT EXISTS "sourceType" VARCHAR(80)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Alerts" ADD COLUMN IF NOT EXISTS "categoryLabel" VARCHAR(120)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Alerts" ADD COLUMN IF NOT EXISTS "targetLabel" VARCHAR(120)`).catch(() => null);

    // School access / plan source of truth.
    await q.query(`ALTER TABLE IF EXISTS "Schools" ADD COLUMN IF NOT EXISTS "currentPlan" VARCHAR(30) DEFAULT 'starter'`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Schools" ADD COLUMN IF NOT EXISTS "subscriptionEndsAt" TIMESTAMP WITH TIME ZONE`).catch(() => null);

    // Test/report-card engine.
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "assessmentType" VARCHAR(60)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "assessmentWeight" DECIMAL(6,2)`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "showOnReport" BOOLEAN DEFAULT true`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "countInFinal" BOOLEAN DEFAULT true`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "AcademicRecords" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER DEFAULT 0`).catch(() => null);
    await q.query(`CREATE TABLE IF NOT EXISTS "SchoolAssessmentSettings" (
      "id" SERIAL PRIMARY KEY,
      "schoolCode" VARCHAR(255) NOT NULL,
      "assessmentType" VARCHAR(60) NOT NULL,
      "label" VARCHAR(120) NOT NULL,
      "showOnReport" BOOLEAN DEFAULT true,
      "countInFinal" BOOLEAN DEFAULT true,
      "weight" DECIMAL(6,2) DEFAULT 0,
      "displayOrder" INTEGER DEFAULT 0,
      "metadata" JSONB DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE ("schoolCode", "assessmentType")
    )`).catch(() => null);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_school_assessment_settings_school" ON "SchoolAssessmentSettings" ("schoolCode", "displayOrder")`).catch(() => null);

    // Report-card design/signatures.
    await q.query(`ALTER TABLE IF EXISTS "Teachers" ADD COLUMN IF NOT EXISTS "signature" TEXT`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Teachers" ADD COLUMN IF NOT EXISTS "signatureUrl" TEXT`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Admins" ADD COLUMN IF NOT EXISTS "signature" TEXT`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Admins" ADD COLUMN IF NOT EXISTS "signatureUrl" TEXT`).catch(() => null);
    await q.query(`ALTER TABLE IF EXISTS "Schools" ADD COLUMN IF NOT EXISTS "reportCardSettings" JSONB DEFAULT '{}'::jsonb`).catch(() => null);
    await q.query(`
      UPDATE "Schools"
      SET "reportCardSettings" = COALESCE("reportCardSettings", '{}'::jsonb) || jsonb_build_object(
        'layout', 'one_page_a4',
        'showParentGuardianSignature', false,
        'showChildPhoto', true,
        'showTopLogo', true,
        'showCenterWatermark', true,
        'signatureSlots', jsonb_build_array('class_teacher', 'headteacher_principal')
      )
      WHERE "reportCardSettings" IS NULL
         OR COALESCE("reportCardSettings"->>'layout','') = ''
         OR COALESCE("reportCardSettings"->>'showParentGuardianSignature','') <> 'false'
    `).catch(() => null);

    // Seed final platform settings without overwriting user custom settings.
    await q.query(`
      INSERT INTO "Settings" ("key", "value", "createdAt", "updatedAt")
      VALUES ('platform_payment_settings', jsonb_build_object(
        'schoolPlans', jsonb_build_array(
          jsonb_build_object('code','starter','name','Starter','minStudents',50,'maxStudents',400,'features',jsonb_build_array('dashboard','teachers','teacher_approvals','students','analytics','alerts','finance_fees','parent_messages','school_settings','billing','classes','report_cards')),
          jsonb_build_object('code','growth','name','Growth','minStudents',401,'maxStudents',500,'features',jsonb_build_array('dashboard','teachers','teacher_approvals','students','analytics','alerts','finance_fees','parent_messages','school_settings','billing','classes','report_cards','calendar','school_branding','timetable','homework')),
          jsonb_build_object('code','enterprise','name','Enterprise','minStudents',501,'maxStudents',null,'features',jsonb_build_array('dashboard','teachers','teacher_approvals','students','analytics','alerts','finance_fees','parent_messages','school_settings','billing','classes','report_cards','calendar','school_branding','timetable','homework','duty','fairness_report','departments','bulk_sms','senior_subject_choice'))
        ),
        'parentPlans', jsonb_build_array(
          jsonb_build_object('code','child_basic','name','Basic','monthlyPriceKes',100,'features',jsonb_build_array('Report cards','Attendance','Progress'),'limits',jsonb_build_object('days',30,'aiQuestionsPerDay',0,'aiQuestionsPerMonth',0)),
          jsonb_build_object('code','child_premium','name','Premium','monthlyPriceKes',250,'features',jsonb_build_array('Everything in Basic','AI Tutor: 6 messages/day','Child timetable if school has timetable'),'limits',jsonb_build_object('days',30,'aiQuestionsPerDay',6,'aiQuestionsPerMonth',180)),
          jsonb_build_object('code','child_ultimate','name','Ultimate','monthlyPriceKes',500,'features',jsonb_build_array('Everything in Premium','Extended AI Tutor','Live child analytics','Stronger alerts','Child recommendations'),'limits',jsonb_build_object('days',30,'aiQuestionsPerDay',50,'aiQuestionsPerMonth',1500))
        )
      ), NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE
      SET "value" = jsonb_set(
        jsonb_set("Settings"."value", '{schoolPlans}', CASE WHEN COALESCE("Settings"."value"->'schoolPlans','[]'::jsonb) = '[]'::jsonb THEN EXCLUDED."value"->'schoolPlans' ELSE "Settings"."value"->'schoolPlans' END, true),
        '{parentPlans}', CASE WHEN COALESCE("Settings"."value"->'parentPlans','[]'::jsonb) = '[]'::jsonb THEN EXCLUDED."value"->'parentPlans' ELSE "Settings"."value"->'parentPlans' END, true
      ),
      "updatedAt" = NOW()
    `).catch(() => null);

    // Keep old child plan aliases usable while dashboards show Basic/Premium/Ultimate.
    await q.query(`UPDATE "SubscriptionPlans" SET "code"='child_basic', "displayName"='Basic', "name"='Basic' WHERE "ownerType"='child' AND lower(COALESCE("code","name")) IN ('child_essential','essential')`).catch(() => null);
    await q.query(`UPDATE "SubscriptionPlans" SET "code"='child_premium', "displayName"='Premium', "name"='Premium', "limits" = COALESCE("limits", '{}'::jsonb) || '{"aiQuestionsPerDay":6,"aiQuestionsPerMonth":180}'::jsonb WHERE "ownerType"='child' AND lower(COALESCE("code","name")) IN ('child_smart','smart')`).catch(() => null);
    await q.query(`UPDATE "SubscriptionPlans" SET "code"='child_ultimate', "displayName"='Ultimate', "name"='Ultimate', "limits" = COALESCE("limits", '{}'::jsonb) || '{"aiQuestionsPerDay":50,"aiQuestionsPerMonth":1500}'::jsonb WHERE "ownerType"='child' AND lower(COALESCE("code","name")) IN ('child_genius','genius')`).catch(() => null);
  },
  async down() {
    throw new Error('Irreversible migration 20260603040000-v124-stable-consolidation.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
