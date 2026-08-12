'use strict';

module.exports = {
  async up(queryInterface) {
    const qi = queryInterface;
    const addIndex = (table, fields, opts) => qi.addIndex(table, fields, opts).catch(() => {});

    await qi.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('"SchoolPaymentSettings"') IS NOT NULL THEN
          WITH resolved AS (
            SELECT id,
                   NULLIF(lower(replace(COALESCE(NULLIF("defaultProvider", ''), "enabledProviders"->>0, "metadata"->>'activeProvider', "metadata"->>'defaultProvider'), '-', '_')), '') AS active_provider
              FROM "SchoolPaymentSettings"
          )
          UPDATE "SchoolPaymentSettings" s
             SET "enabledProviders" = CASE WHEN r.active_provider IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r.active_provider) END,
                 "defaultProvider" = r.active_provider,
                 "metadata" = COALESCE(s."metadata", '{}'::jsonb)
                   || jsonb_build_object(
                        'providerLock', 'one_active_provider',
                        'providerSelectionRule', 'one_active_provider_per_scope',
                        'activeProvider', r.active_provider,
                        'defaultProvider', r.active_provider,
                        'enabledProviders', CASE WHEN r.active_provider IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r.active_provider) END,
                        'migration', '20260629000000-v2002-exclusive-payment-provider-lock'
                      )
                   || jsonb_build_object(
                        'paymentProviders', COALESCE((
                          SELECT jsonb_object_agg(key, (CASE WHEN jsonb_typeof(value) = 'object' THEN value ELSE '{}'::jsonb END) || jsonb_build_object('provider', key, 'enabled', lower(replace(key, '-', '_')) = r.active_provider))
                            FROM jsonb_each(COALESCE(s."metadata"->'paymentProviders', '{}'::jsonb))
                        ), '{}'::jsonb)
                      ),
                 "updatedAt" = NOW()
            FROM resolved r
           WHERE s.id = r.id;
        END IF;

        IF to_regclass('"PlatformPaymentSettings"') IS NOT NULL THEN
          WITH resolved AS (
            SELECT id,
                   NULLIF(lower(replace(COALESCE(NULLIF("defaultProvider", ''), "enabledProviders"->>0, "metadata"->>'activeProvider', "metadata"->>'defaultProvider'), '-', '_')), '') AS active_provider
              FROM "PlatformPaymentSettings"
          )
          UPDATE "PlatformPaymentSettings" p
             SET "enabledProviders" = CASE WHEN r.active_provider IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r.active_provider) END,
                 "defaultProvider" = r.active_provider,
                 "metadata" = COALESCE(p."metadata", '{}'::jsonb)
                   || jsonb_build_object(
                        'providerLock', 'one_active_provider',
                        'providerSelectionRule', 'one_active_provider_per_scope',
                        'activeProvider', r.active_provider,
                        'defaultProvider', r.active_provider,
                        'enabledProviders', CASE WHEN r.active_provider IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r.active_provider) END,
                        'migration', '20260629000000-v2002-exclusive-payment-provider-lock'
                      )
                   || jsonb_build_object(
                        'paymentProviders', COALESCE((
                          SELECT jsonb_object_agg(key, (CASE WHEN jsonb_typeof(value) = 'object' THEN value ELSE '{}'::jsonb END) || jsonb_build_object('provider', key, 'enabled', lower(replace(key, '-', '_')) = r.active_provider))
                            FROM jsonb_each(COALESCE(p."metadata"->'paymentProviders', '{}'::jsonb))
                        ), '{}'::jsonb)
                      ),
                 "updatedAt" = NOW()
            FROM resolved r
           WHERE p.id = r.id;
        END IF;
      END $$;
    `).catch(() => {});

    await addIndex('SchoolPaymentSettings', ['schoolCode', 'defaultProvider'], { name: 'school_payment_settings_active_provider_v2002_idx' });
    await addIndex('PlatformPaymentSettings', ['defaultProvider'], { name: 'platform_payment_settings_active_provider_v2002_idx' });
    await addIndex('Payments', ['paymentType', 'paidTo', 'paymentGateway', 'status'], { name: 'payments_type_destination_provider_status_v2002_idx' });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    await qi.removeIndex('SchoolPaymentSettings', 'school_payment_settings_active_provider_v2002_idx').catch(() => {});
    await qi.removeIndex('PlatformPaymentSettings', 'platform_payment_settings_active_provider_v2002_idx').catch(() => {});
    await qi.removeIndex('Payments', 'payments_type_destination_provider_status_v2002_idx').catch(() => {});
  }
};
