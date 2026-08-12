'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = new Set(tables.map(t => typeof t === 'string' ? t : (t.tableName || t.name)));

    if (names.has('Timetables')) {
      const d = await queryInterface.describeTable('Timetables');
      const add = async (name, spec) => { if (!d[name]) await queryInterface.addColumn('Timetables', name, spec).catch(() => null); };
      await add('term', { type: Sequelize.STRING, allowNull: true });
      await add('year', { type: Sequelize.INTEGER, allowNull: true });
      await add('scope', { type: Sequelize.STRING, allowNull: false, defaultValue: 'term' });
      await add('classes', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
      await add('warnings', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
      await add('isPublished', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
      await add('status', { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'draft' });
      await add('version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
      await add('publishedAt', { type: Sequelize.DATE, allowNull: true });
      await add('publishedBy', { type: Sequelize.INTEGER, allowNull: true });
      await add('supersedesId', { type: Sequelize.INTEGER, allowNull: true });
      await queryInterface.sequelize.query(`UPDATE "Timetables" SET "status" = CASE WHEN COALESCE("isPublished", false)=true THEN 'published' ELSE COALESCE(NULLIF("status", ''), 'draft') END WHERE "status" IS NULL OR "status" = ''`).catch(() => null);
      await queryInterface.addIndex('Timetables', ['schoolId', 'term', 'year', 'scope', 'isPublished'], { name: 'v1493_timetable_active_lookup' }).catch(() => null);
    }

    await queryInterface.createTable('MediaAssets', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      token: { type: Sequelize.UUID, allowNull: false, unique: true, defaultValue: Sequelize.UUIDV4 },
      schoolCode: { type: Sequelize.STRING, allowNull: true },
      ownerUserId: { type: Sequelize.INTEGER, allowNull: true },
      kind: { type: Sequelize.STRING(40), allowNull: false },
      mimeType: { type: Sequelize.STRING(120), allowNull: false },
      originalName: { type: Sequelize.STRING(255), allowNull: true },
      byteSize: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      checksum: { type: Sequelize.STRING(64), allowNull: false },
      data: { type: Sequelize.BLOB('long'), allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    }).catch(() => null);
    await queryInterface.addIndex('MediaAssets', ['token'], { unique: true, name: 'media_assets_token_unique' }).catch(() => null);
    await queryInterface.addIndex('MediaAssets', ['ownerUserId', 'kind', 'isActive'], { name: 'media_assets_owner_kind_idx' }).catch(() => null);

    // Stop stale Render /uploads signature URLs from being reused in report-card payloads.
    // Durable replacements are stored as /api/media/:token after re-upload.
    for (const table of ['Teachers', 'Admins']) {
      if (!names.has(table)) continue;
      await queryInterface.sequelize.query(`UPDATE "${table}" SET "signature" = NULL WHERE "signature" ILIKE '%/uploads/signatures/%'`).catch(() => null);
      await queryInterface.sequelize.query(`UPDATE "${table}" SET "signatureUrl" = NULL WHERE "signatureUrl" ILIKE '%/uploads/signatures/%'`).catch(() => null);
    }
    if (names.has('Users')) {
      await queryInterface.sequelize.query(`
        UPDATE "Users"
        SET "preferences" = (COALESCE("preferences", '{}'::jsonb) - 'signatureUrl' - 'signatureAbsoluteUrl' - 'signatureFileUrl')
        WHERE COALESCE("preferences"->>'signatureUrl','') ILIKE '%/uploads/signatures/%'
           OR COALESCE("preferences"->>'signatureAbsoluteUrl','') ILIKE '%/uploads/signatures/%'
           OR COALESCE("preferences"->>'signatureFileUrl','') ILIKE '%/uploads/signatures/%'
      `).catch(() => null);
    }
  },
  async down() {
    throw new Error('Irreversible migration 20260613000000-v1493-console-error-hardening.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
