'use strict';

module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    const parentPlansJson = `[
      {"code":"child_basic","name":"Basic","displayName":"Basic","monthlyPriceKes":100,"features":["Report cards","Attendance","Progress"],"limits":{"days":30,"aiTutor":false,"aiQuestionsPerDay":0,"aiQuestionsPerMonth":0}},
      {"code":"child_premium","name":"Premium","displayName":"Premium","monthlyPriceKes":250,"features":["Everything in Basic","AI Tutor: 6 messages/day","Child timetable if school has timetable"],"limits":{"days":30,"aiTutor":true,"aiQuestionsPerDay":6,"aiQuestionsPerMonth":180}},
      {"code":"child_ultimate","name":"Ultimate","displayName":"Ultimate","monthlyPriceKes":500,"features":["Everything in Premium","Extended AI Tutor","Live child analytics","Stronger alerts","Child recommendations"],"limits":{"days":30,"aiTutor":true,"aiQuestionsPerDay":50,"aiQuestionsPerMonth":1500}}
    ]`;

    await q.query(`
      INSERT INTO "SubscriptionPlans" ("code","name","displayName","ownerType","price_kes","monthlyPriceKes","features","lockedFeatures","limits","sortOrder","isActive","createdAt","updatedAt")
      VALUES
        ('child_basic','Basic','Basic','child',100,100,'["Report cards","Attendance","Progress"]'::jsonb,'[]'::jsonb,'{"days":30,"aiTutor":false,"aiQuestionsPerDay":0,"aiQuestionsPerMonth":0}'::jsonb,10,true,NOW(),NOW()),
        ('child_premium','Premium','Premium','child',250,250,'["Everything in Basic","AI Tutor: 6 messages/day","Child timetable if school has timetable"]'::jsonb,'[]'::jsonb,'{"days":30,"aiTutor":true,"aiQuestionsPerDay":6,"aiQuestionsPerMonth":180}'::jsonb,11,true,NOW(),NOW()),
        ('child_ultimate','Ultimate','Ultimate','child',500,500,'["Everything in Premium","Extended AI Tutor","Live child analytics","Stronger alerts","Child recommendations"]'::jsonb,'[]'::jsonb,'{"days":30,"aiTutor":true,"aiQuestionsPerDay":50,"aiQuestionsPerMonth":1500}'::jsonb,12,true,NOW(),NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "name" = EXCLUDED."name",
        "displayName" = EXCLUDED."displayName",
        "ownerType" = EXCLUDED."ownerType",
        "price_kes" = EXCLUDED."price_kes",
        "monthlyPriceKes" = EXCLUDED."monthlyPriceKes",
        "features" = EXCLUDED."features",
        "lockedFeatures" = EXCLUDED."lockedFeatures",
        "limits" = EXCLUDED."limits",
        "sortOrder" = EXCLUDED."sortOrder",
        "isActive" = true,
        "updatedAt" = NOW()
    `).catch(() => null);

    await q.query(`
      UPDATE "SubscriptionPlans"
      SET "isActive" = false, "updatedAt" = NOW()
      WHERE "ownerType" = 'child'
        AND lower(COALESCE("code", "name", '')) IN ('child_essential','essential','child_smart','smart','child_genius','genius')
    `).catch(() => null);

    await q.query(`
      UPDATE "Subscriptions"
      SET "planCode" = CASE
            WHEN lower(COALESCE("planCode",'')) IN ('child_essential','essential','basic') THEN 'child_basic'
            WHEN lower(COALESCE("planCode",'')) IN ('child_smart','smart','premium') THEN 'child_premium'
            WHEN lower(COALESCE("planCode",'')) IN ('child_genius','genius','ultimate') THEN 'child_ultimate'
            ELSE "planCode"
          END,
          "planName" = CASE
            WHEN lower(COALESCE("planCode",'')) IN ('child_essential','essential','basic','child_basic') THEN 'Basic'
            WHEN lower(COALESCE("planCode",'')) IN ('child_smart','smart','premium','child_premium') THEN 'Premium'
            WHEN lower(COALESCE("planCode",'')) IN ('child_genius','genius','ultimate','child_ultimate') THEN 'Ultimate'
            ELSE "planName"
          END,
          "limits" = CASE
            WHEN lower(COALESCE("planCode",'')) IN ('child_essential','essential','basic','child_basic') THEN COALESCE("limits", '{}'::jsonb) || '{"aiTutor":false,"aiQuestionsPerDay":0,"aiQuestionsPerMonth":0}'::jsonb
            WHEN lower(COALESCE("planCode",'')) IN ('child_smart','smart','premium','child_premium') THEN COALESCE("limits", '{}'::jsonb) || '{"aiTutor":true,"aiQuestionsPerDay":6,"aiQuestionsPerMonth":180}'::jsonb
            WHEN lower(COALESCE("planCode",'')) IN ('child_genius','genius','ultimate','child_ultimate') THEN COALESCE("limits", '{}'::jsonb) || '{"aiTutor":true,"aiQuestionsPerDay":50,"aiQuestionsPerMonth":1500}'::jsonb
            ELSE "limits"
          END,
          "updatedAt" = NOW()
      WHERE "ownerType" = 'child'
    `).catch(() => null);

    await q.query(`
      INSERT INTO "Settings" ("key", "value", "createdAt", "updatedAt")
      VALUES ('platform_payment_settings', jsonb_build_object('parentPlans', '${parentPlansJson}'::jsonb), NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE
      SET "value" = CASE
            WHEN COALESCE("Settings"."value"->'parentPlans','[]'::jsonb) = '[]'::jsonb
              OR lower(("Settings"."value"->'parentPlans')::text) ~ 'essential|smart|genius|child_essential|child_smart|child_genius'
            THEN jsonb_set(COALESCE("Settings"."value", '{}'::jsonb), '{parentPlans}', EXCLUDED."value"->'parentPlans', true)
            ELSE "Settings"."value"
          END,
          "updatedAt" = NOW()
    `).catch(() => null);
  },

  async down() {
    throw new Error('Irreversible migration 20260603050000-v127-ai-parent-plan-alignment.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
