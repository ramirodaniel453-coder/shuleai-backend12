'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = new Set(tables.map(x => typeof x === 'string' ? x : (x.tableName || x.name)));

    if (names.has('Users')) {
      const userColumns = await queryInterface.describeTable('Users');
      if (userColumns.profileImage) {
        await queryInterface.changeColumn('Users', 'profileImage', { type: Sequelize.TEXT, allowNull: true }).catch(() => {});
      }
    }

    if (!names.has('SmsAllocations')) {
      await queryInterface.createTable('SmsAllocations', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
        schoolCode: { type: Sequelize.STRING(80), allowNull: false },
        quantity: { type: Sequelize.INTEGER, allowNull: false },
        allocationType: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'set_balance' },
        previousBalance: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        newBalance: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        reason: { type: Sequelize.TEXT, allowNull: true },
        reference: { type: Sequelize.STRING(160), allowNull: true },
        allocatedBy: { type: Sequelize.INTEGER, allowNull: true },
        expiresAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('SmsAllocations', ['schoolCode','createdAt'], { name:'v146_sms_allocations_school_date' }).catch(()=>{});
    }

    if (names.has('SubscriptionPlans')) {
      const fullCore = JSON.stringify(['dashboard','teachers','teacher_approvals','students','analytics','alerts','announcements','finance_fees','fees','payments','parent_messages','chat','school_settings','billing','subscriptions','classes','attendance','attendance_corrections','marks','grading','report_cards','report_history','calendar','school_branding','timetable','homework','duty','fairness_report','departments','bulk_sms','birthdays','curriculum','subject_selection','senior_subject_choice','academic_year_transition','promotions','transfers']);
      await queryInterface.sequelize.query(
        `UPDATE "SubscriptionPlans" SET "features"=CAST(:features AS JSONB), "lockedFeatures"='[]'::jsonb, "updatedAt"=NOW() WHERE "ownerType"='school'`,
        { replacements:{ features:fullCore } }
      ).catch(()=>{});
    }
  },
  async down() {
    throw new Error('Irreversible migration 20260608020000-v146-grounded-consolidation.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
