'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const add = async (table, column, spec) => {
      try { await qi.addColumn(table, column, spec); } catch (e) { if (!String(e.message).includes('already exists')) throw e; }
    };
    await add('Payments', 'idempotencyKey', { type: Sequelize.STRING, allowNull: true });
    await add('Payments', 'callbackAttempts', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await add('Payments', 'lastCallbackAt', { type: Sequelize.DATE, allowNull: true });
    await add('Payments', 'lastStatusQueryAt', { type: Sequelize.DATE, allowNull: true });
    await add('Payments', 'gatewayResponse', { type: Sequelize.JSONB, allowNull: false, defaultValue: {} });
    await add('Payments', 'auditTrail', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('Payments', 'paymentType', { type: Sequelize.STRING, allowNull: false, defaultValue: 'subscription' });
    await add('Payments', 'paidTo', { type: Sequelize.STRING, allowNull: false, defaultValue: 'platform' });
    await add('Payments', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    await add('Fees', 'auditTrail', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('Fees', 'adjustments', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('Fees', 'payments', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('Fees', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('FeeStructures', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('Students', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('Users', 'firstLogin', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    const indexes = [
      ['Payments', ['schoolCode','paymentType','paidTo','status'], 'payments_school_type_paidto_status_idx'],
      ['Payments', ['checkoutRequestId'], 'payments_checkout_request_idx'],
      ['Payments', ['idempotencyKey'], 'payments_idempotency_key_idx'],
      ['Fees', ['schoolCode','studentId','term','year'], 'fees_school_student_term_year_idx'],
      ['FeeStructures', ['schoolCode','className','term','year'], 'fee_structures_school_class_term_year_idx'],
      ['StudentParents', ['studentId','parentId'], 'studentparents_student_parent_unique']
    ];
    for (const [table, fields, name] of indexes) {
      try { await qi.addIndex(table, fields, { name, unique: name.includes('unique') }); } catch (e) { if (!String(e.message).includes('already exists')) console.warn(`[migration] skipped index ${name}: ${e.message}`); }
    }
  },
  async down(queryInterface) {
    throw new Error('Irreversible migration 20260525000000-national-rollout-hardening.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
