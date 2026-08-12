'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const addColumn = (table, column, spec) => queryInterface.addColumn(table, column, spec).catch(() => {});
    const addIndex = (table, fields, options = {}) => queryInterface.addIndex(table, fields, options).catch(() => {});

    await addColumn('LearnFeedUsers', 'learnFeedId', { type: Sequelize.STRING(40), allowNull: true });
    await addColumn('LearnFeedUsers', 'linkedPlatformUserId', { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' });
    await addColumn('LearnFeedUsers', 'linkedStudentId', { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' }, onDelete: 'SET NULL' });
    await addColumn('LearnFeedUsers', 'linkedSchoolCode', { type: Sequelize.STRING, allowNull: true });
    await addColumn('LearnFeedUsers', 'linkedElimuId', { type: Sequelize.STRING, allowNull: true });
    await addColumn('LearnFeedUsers', 'linkStatus', { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'standalone' });
    await addColumn('LearnFeedUsers', 'linkSource', { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'learnfeed_signup' });
    await addColumn('LearnFeedUsers', 'linkedAt', { type: Sequelize.DATE, allowNull: true });
    await addColumn('LearnFeedUsers', 'subscriptionPlanCode', { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'free' });
    await addColumn('LearnFeedUsers', 'subscriptionSource', { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'learnfeed' });
    await addColumn('LearnFeedUsers', 'subscriptionEndsAt', { type: Sequelize.DATE, allowNull: true });
    await addColumn('LearnFeedUsers', 'lastSubscriptionPaymentReference', { type: Sequelize.STRING(120), allowNull: true });

    await addColumn('LearnFeedSubscriptionPayments', 'learnFeedId', { type: Sequelize.STRING(40), allowNull: true });
    await addColumn('LearnFeedSubscriptionPayments', 'legacyPaymentId', { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onDelete: 'SET NULL' });
    await addColumn('LearnFeedSubscriptionPayments', 'phone', { type: Sequelize.STRING(40), allowNull: true });
    await addColumn('LearnFeedSubscriptionPayments', 'checkoutRequestId', { type: Sequelize.STRING(120), allowNull: true });
    await addColumn('LearnFeedSubscriptionPayments', 'expiresAt', { type: Sequelize.DATE, allowNull: true });

    await queryInterface.sequelize.query(`UPDATE "LearnFeedUsers" SET "learnFeedId" = CONCAT('LF-', EXTRACT(YEAR FROM NOW())::int, '-', LPAD("id"::text, 6, '0')) WHERE "learnFeedId" IS NULL OR "learnFeedId" = ''`).catch(() => {});
    await addIndex('LearnFeedUsers', ['learnFeedId'], { name: 'learnfeed_users_learnfeed_id_unique', unique: true });
    await addIndex('LearnFeedUsers', ['linkedStudentId'], { name: 'learnfeed_users_linked_student_unique', unique: true });
    await addIndex('LearnFeedUsers', ['linkedSchoolCode'], { name: 'learnfeed_users_linked_school_idx' });
    await addIndex('LearnFeedUsers', ['linkStatus', 'subscriptionStatus'], { name: 'learnfeed_users_link_subscription_idx' });
    await addIndex('LearnFeedSubscriptionPayments', ['learnFeedId', 'status'], { name: 'learnfeed_subscription_learnfeed_status_idx' });
    await addIndex('LearnFeedSubscriptionPayments', ['legacyPaymentId'], { name: 'learnfeed_subscription_legacy_payment_idx' });
  },
  async down() {
    throw new Error('Irreversible migration 20260627010000-learnfeed-linking-and-platform-payments.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
