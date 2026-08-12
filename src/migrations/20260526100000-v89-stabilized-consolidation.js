'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'calendar';`).catch(()=>{});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'message';`).catch(()=>{});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'announcement';`).catch(()=>{});
    await sequelize.query(`ALTER TYPE "enum_SchoolPaymentSettings_paymentMode" ADD VALUE IF NOT EXISTS 'both';`).catch(()=>{});
    const add = async (table, col, spec) => { try { await queryInterface.addColumn(table,col,spec); } catch(e){ if(!/already exists|duplicate column/i.test(String(e.message))) console.warn(`[v89-safe] ${table}.${col}: ${e.message}`); } };
    await add('SchoolCalendars','classId',{ type: Sequelize.INTEGER, allowNull: true });
    await add('SchoolCalendars','metadata',{ type: Sequelize.JSONB, allowNull: false, defaultValue: {} });
    await add('SchoolPaymentSettings','cashEnabled',{ type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await add('SchoolPaymentSettings','cardEnabled',{ type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await queryInterface.addIndex('Alerts', ['userId','dedupeKey'], { unique: true, name:'v89_alerts_user_dedupe_unique' }).catch(()=>{});
    await queryInterface.addIndex('SchoolPaymentSettings', ['schoolCode','isActive'], { name:'v89_payment_settings_school_active_idx' }).catch(()=>{});
  },
  async down() {
    throw new Error('Irreversible migration 20260526100000-v89-stabilized-consolidation.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
