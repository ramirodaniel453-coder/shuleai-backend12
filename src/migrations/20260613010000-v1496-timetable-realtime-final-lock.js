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
      await queryInterface.sequelize.query(`UPDATE "Timetables" SET "version" = 1 WHERE "version" IS NULL OR "version" < 1`).catch(() => null);
      await queryInterface.addIndex('Timetables', ['schoolId', 'term', 'year', 'scope', 'isPublished'], { name: 'v1496_timetable_active_lookup' }).catch(() => null);
      await queryInterface.addIndex('Timetables', ['schoolId', 'supersedesId', 'status'], { name: 'v1496_timetable_draft_lookup' }).catch(() => null);
    }

    if (names.has('ReportSnapshots')) {
      await queryInterface.sequelize.query(`UPDATE "ReportSnapshots" SET "formatVersion" = 'v149.6' WHERE "formatVersion" IS NULL OR "formatVersion" IN ('v143','v149','v149.4')`).catch(() => null);
    }

    if (names.has('RealtimeEvents')) {
      await queryInterface.addIndex('RealtimeEvents', ['schoolCode', 'id'], { name: 'v1496_realtime_school_cursor' }).catch(() => null);
      await queryInterface.addIndex('RealtimeEvents', ['status', 'createdAt'], { name: 'v1496_realtime_pending' }).catch(() => null);
      await queryInterface.addIndex('RealtimeEvents', ['eventType', 'createdAt'], { name: 'v1496_realtime_type_time' }).catch(() => null);
    }

    if (names.has('ChatMessages')) {
      const d = await queryInterface.describeTable('ChatMessages');
      const add = async (name, spec) => { if (!d[name]) await queryInterface.addColumn('ChatMessages', name, spec).catch(() => null); };
      await add('conversationKey', { type: Sequelize.STRING(220), allowNull: true });
      await add('clientMessageId', { type: Sequelize.STRING(120), allowNull: true });
      await add('deliveryStatus', { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'sent' });
      await add('deliveredAt', { type: Sequelize.DATE, allowNull: true });
      await add('readAt', { type: Sequelize.DATE, allowNull: true });
      await add('version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
      await queryInterface.addIndex('ChatMessages', ['schoolCode', 'conversationKey', 'createdAt'], { name: 'v1496_chat_conversation_time' }).catch(() => null);
    }
  },
  async down() {
    throw new Error('Irreversible migration 20260613010000-v1496-timetable-realtime-final-lock.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
