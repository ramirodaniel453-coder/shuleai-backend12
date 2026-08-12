'use strict';

async function addColumnIfMissing(queryInterface, table, column, definition) {
  const desc = await queryInterface.describeTable(table).catch(() => null);
  if (!desc || desc[column]) return;
  await queryInterface.addColumn(table, column, definition).catch((error) => {
    if (!String(error.message || '').toLowerCase().includes('already exists')) throw error;
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'subscriptionId', { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'planCode', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'usageMonth', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'monthlyQuestionsUsed', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'dailyLimit', { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'monthlyLimit', { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'provider', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'model', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'inputTokens', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'outputTokens', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumnIfMissing(queryInterface, 'TutorUsages', 'costEstimate', { type: Sequelize.DECIMAL(12, 6), allowNull: false, defaultValue: 0 });

    await queryInterface.sequelize.query(`
      UPDATE "TutorUsages"
         SET "usageMonth" = COALESCE("usageMonth", TO_CHAR("usageDate"::date, 'YYYY-MM'))
       WHERE "usageMonth" IS NULL;
    `).catch(() => null);

    await queryInterface.createTable('AIInsightUsages', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      usageMonth: { type: Sequelize.STRING, allowNull: false },
      usedCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      provider: { type: Sequelize.STRING, allowNull: true },
      model: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    }).catch((error) => {
      if (!String(error.message || '').toLowerCase().includes('already exists')) throw error;
    });

    await queryInterface.addIndex('AIInsightUsages', ['schoolCode', 'usageMonth'], { unique: true, name: 'ai_insight_usages_school_month_unique' }).catch(() => null);
    await queryInterface.addIndex('TutorUsages', ['schoolCode', 'studentId'], { name: 'tutor_usages_school_student_idx' }).catch(() => null);
    await queryInterface.addIndex('TutorUsages', ['usageMonth'], { name: 'tutor_usages_month_idx' }).catch(() => null);

    const childPlanUpdates = [
      { code: 'child_essential', limits: { aiQuestionsPerDay: 20, aiQuestionsPerMonth: 600, aiTutor: true, noFreeTier: true } },
      { code: 'child_smart', limits: { aiQuestionsPerDay: 75, aiQuestionsPerMonth: 2250, aiTutor: true, noFreeTier: true } },
      { code: 'child_genius', limits: { aiQuestionsPerDay: 200, aiQuestionsPerMonth: 6000, aiTutor: true, noFreeTier: true } }
    ];
    for (const plan of childPlanUpdates) {
      await queryInterface.sequelize.query(`
        UPDATE "SubscriptionPlans"
           SET "limits" = COALESCE("limits", '{}'::jsonb) || CAST(:limits AS jsonb),
               "updatedAt" = NOW()
         WHERE "ownerType" = 'child'
           AND (LOWER(COALESCE("code", '')) = :code OR LOWER(COALESCE("name", '')) = REPLACE(:code, 'child_', ''));
      `, { replacements: { code: plan.code, limits: JSON.stringify(plan.limits) } });
    }

    const schoolPlanUpdates = [
      { code: 'school_starter', limit: 100 },
      { code: 'school_growth', limit: 500 },
      { code: 'school_enterprise', limit: 2000 },
      { code: 'school_premium', limit: 2000 }
    ];
    for (const plan of schoolPlanUpdates) {
      await queryInterface.sequelize.query(`
        UPDATE "SubscriptionPlans"
           SET "limits" = COALESCE("limits", '{}'::jsonb) || CAST(:limits AS jsonb),
               "updatedAt" = NOW()
         WHERE "ownerType" = 'school'
           AND LOWER(COALESCE("code", '')) = :code;
      `, { replacements: { code: plan.code, limits: JSON.stringify({ aiAlertSuggestionsPerMonth: plan.limit }) } });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AIInsightUsages').catch(() => null);
  }
};
