'use strict';

async function addColumnIfMissing(queryInterface, table, column, spec) {
  const desc = await queryInterface.describeTable(table).catch(() => null);
  if (desc && !desc[column]) await queryInterface.addColumn(table, column, spec);
}

const plans = [
  {
    code: 'child_essential', name: 'essential', displayName: 'Essential', ownerType: 'child',
    price_kes: 100, monthlyPriceKes: 100, yearlyPriceKes: 1200, sortOrder: 10,
    features: ['marks','attendance','homework','timetable','basic_ai_tutor'],
    lockedFeatures: ['personalized_study_plans','deep_analytics','advanced_exam_preparation','unlimited_tutor_use'],
    limits: { aiQuestionsPerMonth: 30 }
  },
  {
    code: 'child_smart', name: 'smart', displayName: 'Smart', ownerType: 'child',
    price_kes: 250, monthlyPriceKes: 250, yearlyPriceKes: 3000, sortOrder: 11,
    features: ['marks','attendance','homework','timetable','ai_tutor','weak_subject_detection','study_recommendations'],
    lockedFeatures: ['unlimited_ai_tutor','full_adaptive_learning','daily_learning_goals'],
    limits: { aiQuestionsPerMonth: 150 }
  },
  {
    code: 'child_genius', name: 'genius', displayName: 'Genius', ownerType: 'child',
    price_kes: 500, monthlyPriceKes: 500, yearlyPriceKes: 6000, sortOrder: 12,
    features: ['marks','attendance','homework','timetable','unlimited_ai_tutor','personalized_study_plan','exam_prep','advanced_insights'],
    lockedFeatures: [],
    limits: { aiQuestionsPerMonth: -1, unlimitedAI: true }
  },
  {
    code: 'school_starter', name: 'starter', displayName: 'Starter', ownerType: 'school',
    price_kes: 5000, monthlyPriceKes: 5000, yearlyPriceKes: 50000, setupFeeMinKes: 50000, setupFeeMaxKes: 100000, sortOrder: 1,
    features: ['students','teachers','attendance','marks','reports','fees','homework','timetable','maintenance_included'],
    lockedFeatures: ['school_branding','ai_analytics','smart_alerts','advanced_reports','department_management','advanced_multi_admin','full_ai_tutor'],
    limits: { branding: false, support: 'basic' }
  },
  {
    code: 'school_growth', name: 'growth', displayName: 'Growth', ownerType: 'school',
    price_kes: 10000, monthlyPriceKes: 10000, yearlyPriceKes: 100000, setupFeeMinKes: 50000, setupFeeMaxKes: 100000, sortOrder: 2,
    features: ['students','teachers','attendance','marks','reports','fees','homework','timetable','school_branding','advanced_analytics','smart_alerts','maintenance_included'],
    lockedFeatures: ['enterprise_integrations','dedicated_account_manager'],
    limits: { branding: true, support: 'priority' }
  },
  {
    code: 'school_enterprise', name: 'enterprise', displayName: 'Enterprise', ownerType: 'school',
    price_kes: 30000, monthlyPriceKes: 30000, yearlyPriceKes: 300000, setupFeeMinKes: 50000, setupFeeMaxKes: 100000, sortOrder: 3,
    features: ['all_features'],
    lockedFeatures: [],
    limits: { branding: true, support: 'dedicated' }
  }
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'code', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'displayName', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'ownerType', { type: Sequelize.STRING, defaultValue: 'child' });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'price_kes', { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'monthlyPriceKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'termlyPriceKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'yearlyPriceKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'setupFeeMinKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'setupFeeMaxKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'features', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'lockedFeatures', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'limits', { type: Sequelize.JSONB, defaultValue: {} });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'sortOrder', { type: Sequelize.INTEGER, defaultValue: 0 });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'isActive', { type: Sequelize.BOOLEAN, defaultValue: true });

    await addColumnIfMissing(queryInterface, 'Subscriptions', 'features', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'Subscriptions', 'limits', { type: Sequelize.JSONB, defaultValue: {} });
    await addColumnIfMissing(queryInterface, 'Subscriptions', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'SubscriptionPayments', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'Payments', 'auditTrail', { type: Sequelize.JSONB, defaultValue: [] });

    const aliasMap = (plan) => plan.ownerType === 'child'
      ? (plan.code === 'child_essential'
        ? ['basic', 'essential', 'child_essential']
        : plan.code === 'child_smart'
          ? ['premium', 'smart', 'child_smart']
          : ['ultimate', 'genius', 'child_genius'])
      : (plan.code === 'school_starter'
        ? ['starter', 'school_starter']
        : plan.code === 'school_growth'
          ? ['growth', 'school_growth']
          : ['enterprise', 'school_enterprise']);

    for (const plan of plans) {
      const aliases = aliasMap(plan);
      const replacements = {
        ...plan,
        aliases,
        features: JSON.stringify(plan.features || []),
        lockedFeatures: JSON.stringify(plan.lockedFeatures || []),
        limits: JSON.stringify(plan.limits || {}),
        setupFeeMinKes: plan.setupFeeMinKes || null,
        setupFeeMaxKes: plan.setupFeeMaxKes || null
      };

      const matches = await queryInterface.sequelize.query(`
        SELECT "id", "code", "name"
        FROM "SubscriptionPlans"
        WHERE LOWER("name") IN (:aliases)
           OR LOWER(COALESCE("code", '')) IN (:aliases)
           OR "code" = :code
        ORDER BY
          CASE WHEN "code" = :code THEN 0 ELSE 1 END,
          "id" ASC;
      `, {
        replacements,
        type: queryInterface.sequelize.QueryTypes.SELECT
      });

      if (matches.length > 0) {
        const targetId = matches[0].id;

        // Production-safe/idempotent duplicate handling:
        // Older builds can contain both legacy names like "starter" and canonical codes
        // like "school_starter". Updating all alias rows to the same unique code causes
        // Postgres error 23505. Keep one canonical row and neutralize duplicates first.
        await queryInterface.sequelize.query(`
          UPDATE "SubscriptionPlans"
          SET "code" = NULL,
              "isActive" = false,
              "updatedAt" = NOW()
          WHERE "id" <> :targetId
            AND (
              LOWER("name") IN (:aliases)
              OR LOWER(COALESCE("code", '')) IN (:aliases)
              OR "code" = :code
            );
        `, { replacements: { ...replacements, targetId } });

        await queryInterface.sequelize.query(`
          UPDATE "SubscriptionPlans"
          SET "code" = :code,
              "name" = :name,
              "displayName" = :displayName,
              "ownerType" = :ownerType,
              "price_kes" = :price_kes,
              "monthlyPriceKes" = :monthlyPriceKes,
              "yearlyPriceKes" = :yearlyPriceKes,
              "setupFeeMinKes" = :setupFeeMinKes,
              "setupFeeMaxKes" = :setupFeeMaxKes,
              "features" = CAST(:features AS JSONB),
              "lockedFeatures" = CAST(:lockedFeatures AS JSONB),
              "limits" = CAST(:limits AS JSONB),
              "sortOrder" = :sortOrder,
              "isActive" = true,
              "updatedAt" = NOW()
          WHERE "id" = :targetId;
        `, { replacements: { ...replacements, targetId } });
      } else {
        await queryInterface.sequelize.query(`
          INSERT INTO "SubscriptionPlans"
            ("code","name","displayName","ownerType","price_kes","monthlyPriceKes","yearlyPriceKes","setupFeeMinKes","setupFeeMaxKes","features","lockedFeatures","limits","sortOrder","isActive","createdAt","updatedAt")
          VALUES
            (:code,:name,:displayName,:ownerType,:price_kes,:monthlyPriceKes,:yearlyPriceKes,:setupFeeMinKes,:setupFeeMaxKes,CAST(:features AS JSONB),CAST(:lockedFeatures AS JSONB),CAST(:limits AS JSONB),:sortOrder,true,NOW(),NOW())
          ON CONFLICT ("code") DO UPDATE SET
            "name" = EXCLUDED."name",
            "displayName" = EXCLUDED."displayName",
            "ownerType" = EXCLUDED."ownerType",
            "price_kes" = EXCLUDED."price_kes",
            "monthlyPriceKes" = EXCLUDED."monthlyPriceKes",
            "yearlyPriceKes" = EXCLUDED."yearlyPriceKes",
            "setupFeeMinKes" = EXCLUDED."setupFeeMinKes",
            "setupFeeMaxKes" = EXCLUDED."setupFeeMaxKes",
            "features" = EXCLUDED."features",
            "lockedFeatures" = EXCLUDED."lockedFeatures",
            "limits" = EXCLUDED."limits",
            "sortOrder" = EXCLUDED."sortOrder",
            "isActive" = true,
            "updatedAt" = NOW();
        `, { replacements });
      }
    }
  },
  async down() {
    throw new Error('Irreversible migration 20260511150000-v58-subscription-schema-alignment.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
