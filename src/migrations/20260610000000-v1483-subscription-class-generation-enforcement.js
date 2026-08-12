'use strict';

/**
 * v148.3 subscription enforcement foundation.
 * Additive and non-destructive: existing schools remain on legacy access until
 * they explicitly choose a monthly, termly or yearly payment cadence.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'Subscriptions';
    let desc;
    try { desc = await queryInterface.describeTable(table); } catch (_) { return; }
    const add = async (name, definition) => {
      if (!desc[name]) {
        await queryInterface.addColumn(table, name, definition);
        desc[name] = true;
      }
    };
    const index = async (fields, name) => {
      try { await queryInterface.addIndex(table, fields, { name }); }
      catch (error) {
        const text = String(error?.message || '').toLowerCase();
        if (!text.includes('already exists') && !text.includes('duplicate')) throw error;
      }
    };

    await add('enforcementEnabled', { type: Sequelize.BOOLEAN, allowNull:false, defaultValue:false });
    await add('nextDueDate', { type: Sequelize.DATE, allowNull:true });
    await add('graceEndsAt', { type: Sequelize.DATE, allowNull:true });
    await add('billingState', { type: Sequelize.STRING(32), allowNull:false, defaultValue:'not_enforced' });
    await add('billingAnchorDate', { type: Sequelize.DATE, allowNull:true });
    await add('periodKey', { type: Sequelize.STRING(160), allowNull:true });
    await add('academicPeriod', { type: Sequelize.JSONB, allowNull:false, defaultValue:{} });
    await add('reminderState', { type: Sequelize.JSONB, allowNull:false, defaultValue:{} });
    await add('lastReminderAt', { type: Sequelize.DATE, allowNull:true });
    await add('overdueSince', { type: Sequelize.DATE, allowNull:true });

    await index(['ownerType','enforcementEnabled','nextDueDate'], 'v1483_subscription_enforcement_due');
    await index(['schoolCode','periodKey'], 'v1483_subscription_school_period');
  },
  async down() {
    throw new Error('Irreversible migration 20260610000000-v1483-subscription-class-generation-enforcement.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
