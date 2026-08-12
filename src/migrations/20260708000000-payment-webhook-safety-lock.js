'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('PaymentEvents', 'verificationMethod', {
      type: Sequelize.STRING,
      allowNull: true
    }).catch(() => null);
    await queryInterface.addColumn('PaymentEvents', 'sourceIp', {
      type: Sequelize.STRING,
      allowNull: true
    }).catch(() => null);

    // Keep the earliest event canonical and quarantine later duplicates in-place.
    // The original provider event ID remains in metadata; no payment audit row is deleted.
    await queryInterface.sequelize.query(`
      UPDATE "PaymentEvents" newer
         SET "metadata"=COALESCE(newer."metadata",'{}'::jsonb) || jsonb_build_object(
               'quarantinedDuplicateProviderEventId',newer."providerEventId",
               'duplicateOf',older."id",
               'quarantinedAt',NOW()
             ),
             "providerEventId"=NULL,
             "processed"=true,
             "processingError"=COALESCE(newer."processingError",'Duplicate legacy provider event retained in quarantine')
        FROM "PaymentEvents" older
      WHERE newer."provider" = older."provider"
        AND newer."providerEventId" = older."providerEventId"
        AND newer."providerEventId" IS NOT NULL
        AND newer."id" > older."id";
    `).catch(() => null);

    await queryInterface.addIndex('PaymentEvents', ['provider', 'providerEventId'], {
      unique: true,
      name: 'payment_events_provider_event_unique'
    }).catch(() => null);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('PaymentEvents', 'payment_events_provider_event_unique').catch(() => null);
    await queryInterface.removeColumn('PaymentEvents', 'sourceIp').catch(() => null);
    await queryInterface.removeColumn('PaymentEvents', 'verificationMethod').catch(() => null);
  }
};
