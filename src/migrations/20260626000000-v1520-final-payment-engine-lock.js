'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const add = (table, column, spec) => queryInterface.addColumn(table, column, spec);

    await queryInterface.createTable('PaymentEvents', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      paymentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onDelete: 'SET NULL' },
      schoolCode: { type: Sequelize.STRING, allowNull: true },
      provider: { type: Sequelize.STRING, allowNull: false },
      eventType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'webhook' },
      providerEventId: { type: Sequelize.STRING, allowNull: true },
      internalReference: { type: Sequelize.STRING, allowNull: true },
      providerReference: { type: Sequelize.STRING, allowNull: true },
      verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      processed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      processingError: { type: Sequelize.TEXT, allowNull: true },
      rawPayload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await add('Payments', 'paymentDestination', { type: Sequelize.STRING, allowNull: false, defaultValue: 'platform' });
    await add('Payments', 'providerReference', { type: Sequelize.STRING, allowNull: true });
    await add('Payments', 'checkoutUrl', { type: Sequelize.TEXT, allowNull: true });
    await add('Payments', 'promptType', { type: Sequelize.STRING, allowNull: true });
    await add('Payments', 'promptStatus', { type: Sequelize.STRING, allowNull: true });
    await add('Payments', 'confirmedAmount', { type: Sequelize.INTEGER, allowNull: true });
    await add('Payments', 'confirmedCurrency', { type: Sequelize.STRING, allowNull: true });
    await add('Payments', 'providerStatus', { type: Sequelize.STRING, allowNull: true });
    await add('Payments', 'reconciliationStatus', { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' });
    await add('Payments', 'reconciledAt', { type: Sequelize.DATE, allowNull: true });
    await add('Payments', 'failedAt', { type: Sequelize.DATE, allowNull: true });
    await add('Payments', 'expiresAt', { type: Sequelize.DATE, allowNull: true });
    await add('Payments', 'receiptNumber', { type: Sequelize.STRING, allowNull: true });

    await add('SchoolPaymentSettings', 'enabledProviders', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('SchoolPaymentSettings', 'defaultProvider', { type: Sequelize.STRING, allowNull: true });
    await add('PlatformPaymentSettings', 'enabledProviders', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await add('PlatformPaymentSettings', 'defaultProvider', { type: Sequelize.STRING, allowNull: true });

    await queryInterface.addIndex('PaymentEvents', ['paymentId'], { name: 'payment_events_payment_idx' });
    await queryInterface.addIndex('PaymentEvents', ['schoolCode'], { name: 'payment_events_school_idx' });
    await queryInterface.addIndex('PaymentEvents', ['provider', 'providerEventId'], { name: 'payment_events_provider_event_unique', unique: true });
    await queryInterface.addIndex('Payments', ['paymentType', 'paidTo', 'status'], { name: 'payments_type_destination_status_idx' });
    await queryInterface.addIndex('Payments', ['schoolCode', 'reference'], { name: 'payments_school_reference_idx' });
    await queryInterface.addIndex('Payments', ['paymentGateway', 'providerReference'], { name: 'payments_gateway_provider_ref_idx' });
  },
  async down() {
    throw new Error('Irreversible migration 20260626000000-v1520-final-payment-engine-lock.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
