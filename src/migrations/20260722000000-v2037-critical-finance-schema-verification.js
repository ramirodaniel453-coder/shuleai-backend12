'use strict';

const { reconcileModels, readSchema } = require('./lib/canonical-model-reconciler');

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    const names = [
      'Fee', 'Payment', 'PaymentEvent', 'SchoolPaymentSetting', 'PlatformPaymentSetting',
      'FeeInvoice', 'FeeInvoiceItem', 'StudentFeeAccount', 'PaymentTransaction',
      'PaymentReconciliation', 'ProviderCredentialsAudit', 'PaymentRefund', 'PlatformSubscription'
    ];
    const models = names.map(name => sequelize.models[name]);
    await reconcileModels(queryInterface, Sequelize, models);

    // Convert legacy Fee balances using canonical Fee fields only. invoiceNumber
    // was never a Fee column, so it is generated from the stable Fee primary key.
    await sequelize.query(`
      INSERT INTO "FeeInvoices"
        ("schoolCode", "studentId", "feeId", "feeStructureId", "invoiceNumber", "term", "year", "currency",
         "subtotalAmount", "totalAmount", "paidAmount", "creditAmount", "balanceAmount", "status", "dueDate",
         "issuedAt", "metadata", "createdAt", "updatedAt")
      SELECT f."schoolCode", f."studentId", f."id", f."feeStructureId", CONCAT('INV-', f."id"), f."term"::text,
             f."year", COALESCE(f."currency", 'KES'), COALESCE(f."totalAmount", 0), COALESCE(f."totalAmount", 0),
             COALESCE(f."parentPaidAmount", f."paidAmount", 0), COALESCE(f."creditAmount", 0),
             GREATEST(0, COALESCE(f."totalAmount", 0) - COALESCE(f."parentPaidAmount", f."paidAmount", 0) - COALESCE(f."creditAmount", 0)),
             COALESCE(f."status"::text, 'unpaid'), f."dueDate", COALESCE(f."createdAt", NOW()),
             jsonb_build_object('backfilledFromFeeId', f."id", 'source', 'canonical_finance_reconciler'), NOW(), NOW()
        FROM "Fees" f
       WHERE f."studentId" IS NOT NULL
         AND f."schoolCode" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "FeeInvoices" i WHERE i."feeId" = f."id")
    `);

    await sequelize.query(`
      WITH totals AS (
        SELECT "schoolCode", "studentId", SUM("totalAmount")::integer AS invoiced,
               SUM("paidAmount")::integer AS paid, SUM("creditAmount")::integer AS credit,
               SUM("balanceAmount")::integer AS balance
          FROM "FeeInvoices"
         GROUP BY "schoolCode", "studentId"
      )
      UPDATE "StudentFeeAccounts" a
         SET "invoicedAmount" = t.invoiced, "paidAmount" = t.paid, "creditAmount" = t.credit,
             "balanceAmount" = t.balance,
             "status" = CASE WHEN t.balance <= 0 AND t.invoiced > 0 THEN 'paid'
                             WHEN t.paid + t.credit > 0 THEN 'partial' ELSE 'unpaid' END,
             "lastRecalculatedAt" = NOW(), "updatedAt" = NOW()
        FROM totals t
       WHERE a."schoolCode" = t."schoolCode" AND a."studentId" = t."studentId"
    `);

    await sequelize.query(`
      WITH totals AS (
        SELECT "schoolCode", "studentId", SUM("totalAmount")::integer AS invoiced,
               SUM("paidAmount")::integer AS paid, SUM("creditAmount")::integer AS credit,
               SUM("balanceAmount")::integer AS balance
          FROM "FeeInvoices"
         GROUP BY "schoolCode", "studentId"
      )
      INSERT INTO "StudentFeeAccounts"
        ("schoolCode", "studentId", "currency", "openingBalance", "invoicedAmount", "paidAmount", "creditAmount",
         "refundedAmount", "balanceAmount", "status", "lastRecalculatedAt", "metadata", "createdAt", "updatedAt")
      SELECT t."schoolCode", t."studentId", 'KES', 0, t.invoiced, t.paid, t.credit, 0, t.balance,
             CASE WHEN t.balance <= 0 AND t.invoiced > 0 THEN 'paid'
                  WHEN t.paid + t.credit > 0 THEN 'partial' ELSE 'unpaid' END,
             NOW(), jsonb_build_object('source', 'canonical_finance_reconciler'), NOW(), NOW()
        FROM totals t
       WHERE NOT EXISTS (
         SELECT 1 FROM "StudentFeeAccounts" a
          WHERE a."schoolCode" = t."schoolCode" AND a."studentId" = t."studentId"
       )
    `);

    const required = {
      Payments: ['paymentDestination', 'providerReference', 'promptType', 'promptStatus', 'reconciliationStatus'],
      PaymentEvents: ['paymentId', 'schoolCode', 'provider', 'providerEventId', 'processed'],
      SchoolPaymentSettings: ['enabledProviders', 'defaultProvider'],
      PlatformPaymentSettings: ['enabledProviders', 'defaultProvider'],
      FeeInvoices: ['schoolCode', 'studentId', 'invoiceNumber', 'balanceAmount', 'status'],
      StudentFeeAccounts: ['schoolCode', 'studentId', 'balanceAmount', 'status'],
      PaymentTransactions: ['schoolCode', 'internalReference', 'provider', 'amount', 'status'],
      PaymentReconciliations: ['provider', 'result', 'checkedAt'],
      ProviderCredentialsAudits: ['provider', 'action', 'changedFields'],
      PaymentRefunds: ['provider', 'amount', 'status'],
      PlatformSubscriptions: ['schoolCode', 'planCode', 'status']
    };
    const schema = await readSchema(queryInterface);
    for (const [table, columns] of Object.entries(required)) {
      const present = schema.get(table) || new Set();
      const missing = columns.filter(column => !present.has(column));
      if (missing.length) throw new Error(`Critical finance schema verification failed: ${table} is missing ${missing.join(', ')}`);
    }
  },
  async down() {
    throw new Error('Irreversible migration 20260722000000-v2037-critical-finance-schema-verification.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
