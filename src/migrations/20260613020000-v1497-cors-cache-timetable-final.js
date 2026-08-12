'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const tableNames = new Set(tables.map(t => (typeof t === 'object' ? (t.tableName || t.name) : t)));
    const jsonType = Sequelize.JSONB || Sequelize.JSON;
    if (tableNames.has('Timetables')) {
      const d = await queryInterface.describeTable('Timetables');
      const add = async (name, spec) => { if (!d[name]) await queryInterface.addColumn('Timetables', name, spec).catch(() => null); };
      await add('schoolId', { type: Sequelize.STRING, allowNull: true });
      await add('weekStartDate', { type: Sequelize.DATEONLY, allowNull: true });
      await add('term', { type: Sequelize.STRING, allowNull: true });
      await add('year', { type: Sequelize.INTEGER, allowNull: true });
      await add('scope', { type: Sequelize.STRING, allowNull: true, defaultValue: 'term' });
      await add('slots', { type: jsonType, allowNull: false, defaultValue: [] });
      await add('classes', { type: jsonType, allowNull: false, defaultValue: [] });
      await add('warnings', { type: jsonType, allowNull: false, defaultValue: [] });
      await add('isPublished', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
      await add('status', { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'draft' });
      await add('version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });
      await add('publishedAt', { type: Sequelize.DATE, allowNull: true });
      await add('publishedBy', { type: Sequelize.INTEGER, allowNull: true });
      await add('supersedesId', { type: Sequelize.INTEGER, allowNull: true });
      await queryInterface.sequelize.query(`UPDATE "Timetables" SET "scope" = COALESCE(NULLIF("scope", ''), 'term') WHERE "scope" IS NULL OR "scope" = ''`).catch(() => null);
      await queryInterface.sequelize.query(`UPDATE "Timetables" SET "status" = CASE WHEN COALESCE("isPublished", false)=true THEN 'published' ELSE COALESCE(NULLIF("status", ''), 'draft') END WHERE "status" IS NULL OR "status" = ''`).catch(() => null);
      await queryInterface.sequelize.query(`UPDATE "Timetables" SET "version" = 1 WHERE "version" IS NULL OR "version" < 1`).catch(() => null);
      await queryInterface.addIndex('Timetables', ['schoolId', 'term', 'year', 'scope', 'isPublished'], { name: 'v1497_timetable_active_lookup' }).catch(() => null);
      await queryInterface.addIndex('Timetables', ['schoolId', 'supersedesId', 'status'], { name: 'v1497_timetable_draft_lookup' }).catch(() => null);
    }
  },
  async down() {
    throw new Error('Irreversible migration 20260613020000-v1497-cors-cache-timetable-final.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
