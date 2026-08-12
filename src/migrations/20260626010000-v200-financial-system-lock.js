'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const create = (name, columns, options = {}) => qi.createTable(name, columns, options);
    const addIndex = (table, fields, opts) => qi.addIndex(table, fields, opts);
    const addColumn = (table, column, spec) => qi.addColumn(table, column, spec);

    await create('FeeInvoices', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      schoolId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' }, onDelete: 'SET NULL' },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onDelete: 'CASCADE' },
      parentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Parents', key: 'id' }, onDelete: 'SET NULL' },
      feeId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Fees', key: 'id' }, onDelete: 'SET NULL' },
      feeStructureId: { type: Sequelize.INTEGER, allowNull: true },
      invoiceNumber: { type: Sequelize.STRING, allowNull: false },
      term: { type: Sequelize.STRING, allowNull: true },
      year: { type: Sequelize.INTEGER, allowNull: true },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'KES' },
      subtotalAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      discountAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      taxAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      totalAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      paidAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      creditAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      balanceAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'unpaid' },
      dueDate: { type: Sequelize.DATE, allowNull: true },
      issuedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      locked: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdBy: { type: Sequelize.INTEGER, allowNull: true },
      updatedBy: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('FeeInvoiceItems', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      invoiceId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'FeeInvoices', key: 'id' }, onDelete: 'CASCADE' },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onDelete: 'CASCADE' },
      category: { type: Sequelize.STRING, allowNull: false, defaultValue: 'tuition' },
      description: { type: Sequelize.STRING, allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      unitAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      amount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('StudentFeeAccounts', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      schoolId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' }, onDelete: 'SET NULL' },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onDelete: 'CASCADE' },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'KES' },
      openingBalance: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      invoicedAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      paidAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      creditAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      refundedAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      balanceAmount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'unpaid' },
      lastTransactionAt: { type: Sequelize.DATE, allowNull: true },
      lastRecalculatedAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('PaymentTransactions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      legacyPaymentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onDelete: 'SET NULL' },
      invoiceId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'FeeInvoices', key: 'id' }, onDelete: 'SET NULL' },
      schoolId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' }, onDelete: 'SET NULL' },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Students', key: 'id' }, onDelete: 'SET NULL' },
      parentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Parents', key: 'id' }, onDelete: 'SET NULL' },
      paymentType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'school_fee' },
      destination: { type: Sequelize.STRING, allowNull: false, defaultValue: 'school' },
      provider: { type: Sequelize.STRING, allowNull: false, defaultValue: 'manual' },
      method: { type: Sequelize.STRING, allowNull: false, defaultValue: 'manual' },
      internalReference: { type: Sequelize.STRING, allowNull: false },
      providerReference: { type: Sequelize.STRING, allowNull: true },
      idempotencyKey: { type: Sequelize.STRING, allowNull: true },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      confirmedAmount: { type: Sequelize.INTEGER, allowNull: true },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'KES' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      promptType: { type: Sequelize.STRING, allowNull: true },
      promptStatus: { type: Sequelize.STRING, allowNull: true },
      checkoutUrl: { type: Sequelize.TEXT, allowNull: true },
      phone: { type: Sequelize.STRING, allowNull: true },
      accountReference: { type: Sequelize.STRING, allowNull: true },
      failureReason: { type: Sequelize.TEXT, allowNull: true },
      receiptNumber: { type: Sequelize.STRING, allowNull: true },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      failedAt: { type: Sequelize.DATE, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      reconciledAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      providerPayload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      auditTrail: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      createdBy: { type: Sequelize.INTEGER, allowNull: true },
      updatedBy: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('PaymentReconciliations', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      paymentTransactionId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'PaymentTransactions', key: 'id' }, onDelete: 'SET NULL' },
      legacyPaymentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onDelete: 'SET NULL' },
      schoolCode: { type: Sequelize.STRING, allowNull: true },
      provider: { type: Sequelize.STRING, allowNull: false },
      internalReference: { type: Sequelize.STRING, allowNull: true },
      providerReference: { type: Sequelize.STRING, allowNull: true },
      statusBefore: { type: Sequelize.STRING, allowNull: true },
      statusAfter: { type: Sequelize.STRING, allowNull: true },
      result: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      message: { type: Sequelize.TEXT, allowNull: true },
      checkedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      rawResponse: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('ProviderCredentialsAudits', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      schoolCode: { type: Sequelize.STRING, allowNull: true },
      scope: { type: Sequelize.STRING, allowNull: false, defaultValue: 'school' },
      provider: { type: Sequelize.STRING, allowNull: false },
      action: { type: Sequelize.STRING, allowNull: false },
      actorUserId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      changedFields: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('PaymentRefunds', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      paymentTransactionId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'PaymentTransactions', key: 'id' }, onDelete: 'SET NULL' },
      legacyPaymentId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Payments', key: 'id' }, onDelete: 'SET NULL' },
      schoolCode: { type: Sequelize.STRING, allowNull: true },
      provider: { type: Sequelize.STRING, allowNull: false },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'KES' },
      reason: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'requested' },
      requestedBy: { type: Sequelize.INTEGER, allowNull: true },
      approvedBy: { type: Sequelize.INTEGER, allowNull: true },
      providerRefundReference: { type: Sequelize.STRING, allowNull: true },
      rawPayload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('PlatformSubscriptions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      schoolId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Schools', key: 'id' }, onDelete: 'SET NULL' },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      planCode: { type: Sequelize.STRING, allowNull: false, defaultValue: 'basic' },
      planName: { type: Sequelize.STRING, allowNull: false, defaultValue: 'Basic' },
      billingCycle: { type: Sequelize.STRING, allowNull: false, defaultValue: 'monthly' },
      amount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'KES' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      startsAt: { type: Sequelize.DATE, allowNull: true },
      endsAt: { type: Sequelize.DATE, allowNull: true },
      lastPaymentTransactionId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'PaymentTransactions', key: 'id' }, onDelete: 'SET NULL' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await addColumn('PaymentEvents', 'paymentTransactionId', { type: Sequelize.INTEGER, allowNull: true, references: { model: 'PaymentTransactions', key: 'id' }, onDelete: 'SET NULL' });
    await addColumn('PaymentEvents', 'idempotencyKey', { type: Sequelize.STRING, allowNull: true });

    await addIndex('FeeInvoices', ['schoolCode', 'studentId', 'status'], { name: 'fee_invoices_school_student_status_v200_idx' });
    await addIndex('FeeInvoices', ['schoolCode', 'invoiceNumber'], { name: 'fee_invoices_school_invoice_v200_unique', unique: true });
    await addIndex('FeeInvoiceItems', ['invoiceId'], { name: 'fee_invoice_items_invoice_v200_idx' });
    await addIndex('StudentFeeAccounts', ['schoolCode', 'studentId'], { name: 'student_fee_accounts_school_student_v200_unique', unique: true });
    await addIndex('PaymentTransactions', ['schoolCode', 'internalReference'], { name: 'payment_transactions_school_ref_v200_unique', unique: true });
    await addIndex('PaymentTransactions', ['provider', 'providerReference'], { name: 'payment_transactions_provider_ref_v200_idx' });
    await addIndex('PaymentTransactions', ['schoolCode', 'studentId', 'status'], { name: 'payment_transactions_student_status_v200_idx' });
    await addIndex('PaymentTransactions', ['paymentType', 'destination', 'status'], { name: 'payment_transactions_type_destination_status_v200_idx' });
    await addIndex('PaymentReconciliations', ['internalReference'], { name: 'payment_reconciliations_ref_v200_idx' });
    await addIndex('ProviderCredentialsAudits', ['schoolCode', 'provider'], { name: 'provider_credentials_audits_school_provider_v200_idx' });
    await addIndex('PaymentRefunds', ['schoolCode', 'status'], { name: 'payment_refunds_school_status_v200_idx' });
    await addIndex('PlatformSubscriptions', ['schoolCode', 'status'], { name: 'platform_subscriptions_school_status_v200_idx' });

    // Safe backfill: create invoice/account rows from existing Fees without changing old balances.
    await qi.sequelize.query(`
      INSERT INTO "FeeInvoices" ("schoolCode", "studentId", "feeId", "feeStructureId", "invoiceNumber", "term", "year", "currency", "subtotalAmount", "totalAmount", "paidAmount", "creditAmount", "balanceAmount", "status", "dueDate", "issuedAt", "metadata", "createdAt", "updatedAt")
      SELECT f."schoolCode", f."studentId", f."id", f."feeStructureId", COALESCE(NULLIF(f."invoiceNumber", ''), CONCAT('INV-', f."id")), f."term"::text, f."year", 'KES', COALESCE(f."totalAmount",0), COALESCE(f."totalAmount",0), COALESCE(f."parentPaidAmount", f."paidAmount", 0), COALESCE(f."creditAmount",0), GREATEST(0, COALESCE(f."totalAmount",0) - COALESCE(f."parentPaidAmount", f."paidAmount", 0) - COALESCE(f."creditAmount",0)), COALESCE(f."status"::text, 'unpaid'), f."dueDate", COALESCE(f."createdAt", NOW()), jsonb_build_object('backfilledFromFeeId', f."id", 'source', 'v200_migration'), NOW(), NOW()
      FROM "Fees" f
      WHERE f."studentId" IS NOT NULL AND f."schoolCode" IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);

    await qi.sequelize.query(`
      INSERT INTO "StudentFeeAccounts" ("schoolCode", "studentId", "currency", "invoicedAmount", "paidAmount", "creditAmount", "balanceAmount", "status", "lastRecalculatedAt", "metadata", "createdAt", "updatedAt")
      SELECT "schoolCode", "studentId", 'KES', SUM("totalAmount"), SUM("paidAmount"), SUM("creditAmount"), SUM("balanceAmount"),
        CASE WHEN SUM("balanceAmount") <= 0 AND SUM("totalAmount") > 0 THEN 'paid' WHEN SUM("paidAmount" + "creditAmount") > 0 THEN 'partial' ELSE 'unpaid' END,
        NOW(), jsonb_build_object('source', 'v200_migration_backfill'), NOW(), NOW()
      FROM "FeeInvoices"
      GROUP BY "schoolCode", "studentId"
      ON CONFLICT DO NOTHING;
    `);
  },
  async down() {
    throw new Error('Irreversible migration 20260626010000-v200-financial-system-lock.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
