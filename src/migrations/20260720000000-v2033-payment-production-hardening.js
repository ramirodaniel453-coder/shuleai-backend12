'use strict';

const ALLOWED = new Set(['manual','bank','cash','card','mpesa','paystack','flutterwave','pesapal','stripe']);

function normalizeProvider(value) {
  let provider = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['daraja','m_pesa','mpesa_stk','stk','safaricom','safaricom_daraja'].includes(provider)) provider = 'mpesa';
  if (['manual_mpesa','manual_m_pesa','mpesa_manual','manual_verification'].includes(provider)) provider = 'manual';
  return ALLOWED.has(provider) ? provider : '';
}

function object(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function rowProvider(row) {
  const metadata = object(row.metadata);
  const enabled = Array.isArray(row.enabledProviders) ? row.enabledProviders : [];
  return normalizeProvider(row.defaultProvider || enabled[0] || metadata.activeProvider || metadata.defaultProvider);
}

function paymentMode(provider) {
  if (provider === 'mpesa') return 'daraja';
  if (provider === 'bank') return 'bank';
  return 'manual';
}

async function consolidate(queryInterface, table, groupKey, transaction) {
  const [rows] = await queryInterface.sequelize.query(`SELECT * FROM "${table}" ORDER BY "updatedAt" ASC NULLS FIRST, id ASC`, { transaction });
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey === null ? 'singleton' : String(row[groupKey] || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const group of groups.values()) {
    if (!group.length) continue;
    const keeper = group[group.length - 1];
    let metadata = {};
    let providers = {};
    for (const row of group) {
      const incoming = object(row.metadata);
      metadata = { ...metadata, ...incoming };
      providers = { ...providers, ...object(incoming.paymentProviders) };
    }
    const active = rowProvider(keeper) || [...group].reverse().map(rowProvider).find(Boolean) || '';
    const lockedProviders = {};
    for (const [rawName, rawConfig] of Object.entries(providers)) {
      const name = normalizeProvider(rawName);
      if (!name) continue;
      lockedProviders[name] = { ...object(rawConfig), provider: name, enabled: name === active };
    }
    if (active && !lockedProviders[active]) lockedProviders[active] = { provider: active, enabled: true };
    const auditTrail = Array.isArray(metadata.auditTrail) ? metadata.auditTrail.slice(-249) : [];
    auditTrail.push({ action: 'v2033_payment_settings_consolidated', activeProvider: active || null, mergedRows: group.length, at: new Date().toISOString() });
    metadata = {
      ...metadata,
      paymentProviders: lockedProviders,
      providerLock: 'one_active_provider',
      providerSelectionRule: 'one_active_provider_per_scope',
      activeProvider: active || null,
      defaultProvider: active || null,
      enabledProviders: active ? [active] : [],
      auditTrail
    };
    await queryInterface.sequelize.query(`
      UPDATE "${table}"
         SET "metadata" = CAST(:metadata AS jsonb),
             "enabledProviders" = CAST(:enabled AS jsonb),
             "defaultProvider" = :active,
             "paymentMode" = :paymentMode,
             "updatedAt" = NOW()
       WHERE id = :id
    `, { replacements: { metadata: JSON.stringify(metadata), enabled: JSON.stringify(active ? [active] : []), active: active || null, paymentMode: paymentMode(active), id: keeper.id }, transaction });
    const obsoleteIds = group.slice(0, -1).map(row => Number(row.id)).filter(Number.isFinite);
    if (obsoleteIds.length) await queryInterface.bulkDelete(table, { id: obsoleteIds }, { transaction });
  }
}

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const [tables] = await queryInterface.sequelize.query(`SELECT to_regclass('"SchoolPaymentSettings"') AS school, to_regclass('"PlatformPaymentSettings"') AS platform`, { transaction });
      if (tables[0]?.school) await consolidate(queryInterface, 'SchoolPaymentSettings', 'schoolCode', transaction);
      if (tables[0]?.platform) await consolidate(queryInterface, 'PlatformPaymentSettings', null, transaction);

      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS school_payment_settings_school_unique_v2033 ON "SchoolPaymentSettings" ("schoolCode");
        CREATE UNIQUE INDEX IF NOT EXISTS platform_payment_settings_singleton_unique_v2033 ON "PlatformPaymentSettings" ((1));
        CREATE INDEX IF NOT EXISTS payments_owner_status_v2033_idx ON "Payments" ("parentId", "studentId", "status");
        CREATE INDEX IF NOT EXISTS payments_provider_pending_v2033_idx ON "Payments" ("paymentGateway", "status", "createdAt");
      `, { transaction });

      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_payment_settings_one_provider_v2033') THEN
            ALTER TABLE "SchoolPaymentSettings" ADD CONSTRAINT school_payment_settings_one_provider_v2033
              CHECK (jsonb_typeof("enabledProviders") = 'array' AND jsonb_array_length("enabledProviders") <= 1
                AND (("defaultProvider" IS NULL AND jsonb_array_length("enabledProviders") = 0)
                  OR (jsonb_array_length("enabledProviders") = 1 AND lower(replace("defaultProvider", '-', '_')) = "enabledProviders"->>0)));
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_payment_settings_one_provider_v2033') THEN
            ALTER TABLE "PlatformPaymentSettings" ADD CONSTRAINT platform_payment_settings_one_provider_v2033
              CHECK (jsonb_typeof("enabledProviders") = 'array' AND jsonb_array_length("enabledProviders") <= 1
                AND (("defaultProvider" IS NULL AND jsonb_array_length("enabledProviders") = 0)
                  OR (jsonb_array_length("enabledProviders") = 1 AND lower(replace("defaultProvider", '-', '_')) = "enabledProviders"->>0)));
          END IF;
        END $$;
      `, { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS school_payment_settings_school_unique_v2033;
      DROP INDEX IF EXISTS platform_payment_settings_singleton_unique_v2033;
      DROP INDEX IF EXISTS payments_owner_status_v2033_idx;
      DROP INDEX IF EXISTS payments_provider_pending_v2033_idx;
      ALTER TABLE IF EXISTS "SchoolPaymentSettings" DROP CONSTRAINT IF EXISTS school_payment_settings_one_provider_v2033;
      ALTER TABLE IF EXISTS "PlatformPaymentSettings" DROP CONSTRAINT IF EXISTS platform_payment_settings_one_provider_v2033;
    `);
  }
};
