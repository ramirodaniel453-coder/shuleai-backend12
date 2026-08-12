'use strict';

const planSeeds = [
  { code:'school_starter', name:'starter', displayName:'Starter', ownerType:'school', price_kes:5000, monthlyPriceKes:5000, termlyPriceKes:15000, yearlyPriceKes:50000, setupFeeMinKes:50000, setupFeeMaxKes:100000, sortOrder:1, features:['Core school operations','Student management','Teacher management','Parent and student dashboards','Attendance','Homework','Timetable','Academic calendar','Marks and report cards','Finance and fee tracking','Messaging and announcements','Basic analytics','Maintenance included'], lockedFeatures:['School name/sidebar branding','AI powered analytics','Smart alerts','Advanced reports','Department management','Advanced multi-admin controls','Full AI tutor'], limits:{ branding:false, support:'basic' }},
  { code:'school_growth', name:'growth', displayName:'Growth', ownerType:'school', price_kes:10000, monthlyPriceKes:10000, termlyPriceKes:30000, yearlyPriceKes:100000, setupFeeMinKes:50000, setupFeeMaxKes:100000, sortOrder:2, features:['Everything in Starter','School name and branding in sidebar','School logo customization','Advanced analytics','AI powered school insights','Smart alerts center','Weak student detection','Attendance intelligence','Parent engagement analytics','Teacher performance insights','Department management','Multi-admin controls','Advanced reports','Priority maintenance included'], lockedFeatures:['Enterprise integrations','Multi-campus workflows','Dedicated account support'], limits:{ branding:true, support:'priority' }},
  { code:'school_enterprise', name:'enterprise', displayName:'Enterprise', ownerType:'school', price_kes:30000, monthlyPriceKes:30000, termlyPriceKes:90000, yearlyPriceKes:300000, setupFeeMinKes:50000, setupFeeMaxKes:100000, sortOrder:3, features:['Everything in Growth','Full AI tutor integration','Full analytics engine','Predictive academic insights','Premium reporting','SMS automation','Advanced timetable automation','Custom workflows','Multi-campus support','Dedicated support','Custom integrations'], lockedFeatures:[], limits:{ branding:true, support:'dedicated' }},
  { code:'child_essential', name:'essential', displayName:'Essential', ownerType:'child', price_kes:100, monthlyPriceKes:100, termlyPriceKes:300, yearlyPriceKes:1200, sortOrder:10, features:['Marks and report cards','Attendance','Homework tracking','Fee balance','Timetable','Teacher communication','Academic calendar','Basic performance trends','Light AI tutor'], lockedFeatures:['Personalized study plans','Deep analytics','Advanced exam preparation','Unlimited tutor use'], limits:{ aiQuestionsPerMonth:30 }},
  { code:'child_smart', name:'smart', displayName:'Smart', ownerType:'child', price_kes:250, monthlyPriceKes:250, termlyPriceKes:750, yearlyPriceKes:3000, sortOrder:11, features:['Everything in Essential','Weak subject detection','Performance insights','Attendance trend alerts','Homework completion insights','Academic recommendations','Study recommendations','Exam readiness insights','Parent guidance tips','Expanded AI tutor'], lockedFeatures:['Unlimited AI tutor','Full adaptive learning','Daily learning goals'], limits:{ aiQuestionsPerMonth:150 }},
  { code:'child_genius', name:'genius', displayName:'Genius', ownerType:'child', price_kes:500, monthlyPriceKes:500, termlyPriceKes:1500, yearlyPriceKes:6000, sortOrder:12, features:['Everything in Smart','Unlimited AI tutor','Full child analytics','Performance prediction','Behavior and performance alerts','Parent coaching recommendations','Personalized study plans','Adaptive learning','Smart revision engine','Exam prep mode','Daily learning goals'], lockedFeatures:[], limits:{ aiQuestionsPerMonth:null, unlimitedAI:true }}
];

async function addColumnIfMissing(queryInterface, table, column, definition) {
  const desc = await queryInterface.describeTable(table).catch(() => null);
  if (desc && !desc[column]) await queryInterface.addColumn(table, column, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SchoolPaymentSettings', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' }, onDelete: 'CASCADE' },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      paymentMode: { type: Sequelize.ENUM('manual','daraja','bank','mixed'), defaultValue: 'manual' },
      mpesaType: { type: Sequelize.ENUM('till','paybill'), defaultValue: 'paybill' },
      tillNumber: Sequelize.STRING,
      paybillNumber: Sequelize.STRING,
      businessShortCode: Sequelize.STRING,
      accountReferenceFormat: { type: Sequelize.STRING, defaultValue: 'admissionNumber' },
      bankName: Sequelize.STRING,
      bankAccountName: Sequelize.STRING,
      bankAccountNumber: Sequelize.STRING,
      bankBranch: Sequelize.STRING,
      darajaEnabled: { type: Sequelize.BOOLEAN, defaultValue: false },
      darajaConsumerKey: Sequelize.TEXT,
      darajaConsumerSecret: Sequelize.TEXT,
      darajaPasskey: Sequelize.TEXT,
      darajaShortcode: Sequelize.STRING,
      darajaEnvironment: { type: Sequelize.ENUM('sandbox','production'), defaultValue: 'sandbox' },
      callbackUrl: Sequelize.STRING,
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      auditTrail: { type: Sequelize.JSONB, defaultValue: [] },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });

    await queryInterface.createTable('PlatformPaymentSettings', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      businessName: { type: Sequelize.STRING, defaultValue: 'Shule AI' },
      paymentMode: { type: Sequelize.ENUM('manual','daraja','bank','mixed'), defaultValue: 'daraja' },
      mpesaType: { type: Sequelize.ENUM('till','paybill'), defaultValue: 'paybill' },
      tillNumber: Sequelize.STRING,
      paybillNumber: Sequelize.STRING,
      businessShortCode: Sequelize.STRING,
      accountNumber: { type: Sequelize.STRING, defaultValue: 'SHULEAI' },
      darajaConsumerKey: Sequelize.TEXT,
      darajaConsumerSecret: Sequelize.TEXT,
      darajaPasskey: Sequelize.TEXT,
      darajaShortcode: Sequelize.STRING,
      darajaEnvironment: { type: Sequelize.ENUM('sandbox','production'), defaultValue: 'sandbox' },
      callbackUrl: Sequelize.STRING,
      bankName: Sequelize.STRING,
      bankAccountName: Sequelize.STRING,
      bankAccountNumber: Sequelize.STRING,
      bankBranch: Sequelize.STRING,
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      auditTrail: { type: Sequelize.JSONB, defaultValue: [] },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });

    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'code', { type: Sequelize.STRING, unique: true });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'displayName', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'ownerType', { type: Sequelize.ENUM('school','child'), defaultValue: 'child' });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'monthlyPriceKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'termlyPriceKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'yearlyPriceKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'setupFeeMinKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'setupFeeMaxKes', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'lockedFeatures', { type: Sequelize.JSONB, defaultValue: [] });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'limits', { type: Sequelize.JSONB, defaultValue: {} });
    await addColumnIfMissing(queryInterface, 'SubscriptionPlans', 'sortOrder', { type: Sequelize.INTEGER, defaultValue: 0 });
    await queryInterface.addIndex('SubscriptionPlans', ['code'], { unique: true, name: 'subscription_plans_code_unique' }).catch(() => null);

    await queryInterface.createTable('Subscriptions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      ownerType: { type: Sequelize.ENUM('school','child'), allowNull: false },
      schoolId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' } },
      schoolCode: Sequelize.STRING,
      parentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Parents', key: 'id' } },
      studentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' } },
      planId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'SubscriptionPlans', key: 'id' } },
      planCode: { type: Sequelize.STRING, allowNull: false },
      planName: { type: Sequelize.STRING, allowNull: false },
      billingCycle: { type: Sequelize.ENUM('monthly','termly','yearly','custom'), defaultValue: 'monthly' },
      status: { type: Sequelize.ENUM('active','expired','cancelled','pending','paused','trial'), defaultValue: 'pending' },
      startDate: Sequelize.DATE,
      endDate: Sequelize.DATE,
      autoRenew: { type: Sequelize.BOOLEAN, defaultValue: false },
      lastPaymentId: Sequelize.INTEGER,
      features: { type: Sequelize.JSONB, defaultValue: [] },
      limits: { type: Sequelize.JSONB, defaultValue: {} },
      auditTrail: { type: Sequelize.JSONB, defaultValue: [] },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });

    await queryInterface.createTable('SubscriptionPayments', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      subscriptionId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Subscriptions', key: 'id' } },
      ownerType: { type: Sequelize.ENUM('school','child'), allowNull: false },
      schoolId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' } },
      schoolCode: Sequelize.STRING,
      parentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Parents', key: 'id' } },
      studentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' } },
      planId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'SubscriptionPlans', key: 'id' } },
      planCode: { type: Sequelize.STRING, allowNull: false },
      planName: { type: Sequelize.STRING, allowNull: false },
      billingCycle: { type: Sequelize.ENUM('monthly','termly','yearly','custom'), defaultValue: 'monthly' },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      currency: { type: Sequelize.STRING, defaultValue: 'KES' },
      paymentMethod: { type: Sequelize.ENUM('mpesa','bank','card','manual'), defaultValue: 'mpesa' },
      checkoutRequestId: Sequelize.STRING,
      merchantRequestId: Sequelize.STRING,
      mpesaReceiptNumber: Sequelize.STRING,
      status: { type: Sequelize.ENUM('pending','success','failed','cancelled','expired'), defaultValue: 'pending' },
      paidAt: Sequelize.DATE,
      rawCallback: { type: Sequelize.JSONB, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      auditTrail: { type: Sequelize.JSONB, defaultValue: [] },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });

    await queryInterface.createTable('FeatureLocks', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      featureKey: { type: Sequelize.STRING, allowNull: false, unique: true },
      featureName: { type: Sequelize.STRING, allowNull: false },
      ownerType: { type: Sequelize.ENUM('school','child','both'), defaultValue: 'both' },
      requiredPlans: { type: Sequelize.JSONB, defaultValue: [] },
      gracefulFallback: { type: Sequelize.BOOLEAN, defaultValue: true },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(e => { if (!/already exists/i.test(e.message)) throw e; });

    await addColumnIfMissing(queryInterface, 'Payments', 'subscriptionPaymentId', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Payments', 'subscriptionId', { type: Sequelize.INTEGER });
    await addColumnIfMissing(queryInterface, 'Payments', 'ownerType', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Payments', 'billingCycle', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Payments', 'planCode', { type: Sequelize.STRING });
    await addColumnIfMissing(queryInterface, 'Payments', 'planName', { type: Sequelize.STRING });
    await queryInterface.changeColumn('Payments', 'plan', { type: Sequelize.STRING, allowNull: true }).catch(() => null);
    await queryInterface.changeColumn('Payments', 'studentId', { type: Sequelize.INTEGER, allowNull: true }).catch(() => null);
    await queryInterface.changeColumn('Payments', 'parentId', { type: Sequelize.INTEGER, allowNull: true }).catch(() => null);

    for (const plan of planSeeds) {
      const now = new Date();
      await queryInterface.sequelize.query(`
        INSERT INTO "SubscriptionPlans" ("code","name","displayName","ownerType","price_kes","monthlyPriceKes","termlyPriceKes","yearlyPriceKes","setupFeeMinKes","setupFeeMaxKes","features","lockedFeatures","limits","sortOrder","isActive","createdAt","updatedAt")
        VALUES (:code,:name,:displayName,:ownerType,:price_kes,:monthlyPriceKes,:termlyPriceKes,:yearlyPriceKes,:setupFeeMinKes,:setupFeeMaxKes,CAST(:features AS JSONB),CAST(:lockedFeatures AS JSONB),CAST(:limits AS JSONB),:sortOrder,true,:now,:now)
        ON CONFLICT ("code") DO UPDATE SET
          "displayName" = EXCLUDED."displayName",
          "ownerType" = EXCLUDED."ownerType",
          "price_kes" = EXCLUDED."price_kes",
          "monthlyPriceKes" = EXCLUDED."monthlyPriceKes",
          "termlyPriceKes" = EXCLUDED."termlyPriceKes",
          "yearlyPriceKes" = EXCLUDED."yearlyPriceKes",
          "setupFeeMinKes" = EXCLUDED."setupFeeMinKes",
          "setupFeeMaxKes" = EXCLUDED."setupFeeMaxKes",
          "features" = EXCLUDED."features",
          "lockedFeatures" = EXCLUDED."lockedFeatures",
          "limits" = EXCLUDED."limits",
          "sortOrder" = EXCLUDED."sortOrder",
          "updatedAt" = EXCLUDED."updatedAt";
      `, {
        replacements: {
          code: plan.code,
          name: plan.name,
          displayName: plan.displayName,
          ownerType: plan.ownerType,
          price_kes: plan.price_kes ?? 0,
          monthlyPriceKes: plan.monthlyPriceKes ?? null,
          termlyPriceKes: plan.termlyPriceKes ?? null,
          yearlyPriceKes: plan.yearlyPriceKes ?? null,
          setupFeeMinKes: plan.setupFeeMinKes ?? null,
          setupFeeMaxKes: plan.setupFeeMaxKes ?? null,
          features: JSON.stringify(plan.features || []),
          lockedFeatures: JSON.stringify(plan.lockedFeatures || []),
          limits: JSON.stringify(plan.limits || {}),
          sortOrder: plan.sortOrder ?? 0,
          now
        }
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('FeatureLocks').catch(() => null);
    await queryInterface.dropTable('SubscriptionPayments').catch(() => null);
    await queryInterface.dropTable('Subscriptions').catch(() => null);
    await queryInterface.dropTable('PlatformPaymentSettings').catch(() => null);
    await queryInterface.dropTable('SchoolPaymentSettings').catch(() => null);
  }
};
