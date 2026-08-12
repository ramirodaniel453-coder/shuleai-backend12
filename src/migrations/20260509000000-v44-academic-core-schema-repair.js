'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const add = async (table, column, type) => {
      const desc = await queryInterface.describeTable(table).catch(() => null);
      if (!desc || desc[column]) return;
      await queryInterface.addColumn(table, column, type);
    };

    await add('Students', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('Students', 'curriculum', { type: Sequelize.STRING, allowNull: true, defaultValue: 'cbc' });
    await add('Students', 'admissionNumber', { type: Sequelize.STRING, allowNull: true });
    await add('Teachers', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('AcademicRecords', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('Attendance', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('Fees', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('FeeStructures', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('ReportSnapshots', 'classId', { type: Sequelize.INTEGER, allowNull: true });
    await add('TutorSessions', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    await add('TutorMessages', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    await add('TutorProgresses', 'schoolCode', { type: Sequelize.STRING, allowNull: true });
    await add('TutorUsages', 'schoolCode', { type: Sequelize.STRING, allowNull: true });

    await queryInterface.sequelize.query(`UPDATE "TutorSessions" SET "schoolCode" = COALESCE("schoolCode", "schoolId", 'default') WHERE "schoolCode" IS NULL`).catch(() => null);
    await queryInterface.sequelize.query(`UPDATE "TutorMessages" SET "schoolCode" = COALESCE("schoolCode", "schoolId", 'default') WHERE "schoolCode" IS NULL`).catch(() => null);
    await queryInterface.sequelize.query(`UPDATE "TutorProgresses" SET "schoolCode" = COALESCE("schoolCode", "schoolId", 'default') WHERE "schoolCode" IS NULL`).catch(() => null);
    await queryInterface.sequelize.query(`UPDATE "TutorUsages" SET "schoolCode" = COALESCE("schoolCode", "schoolId", 'default') WHERE "schoolCode" IS NULL`).catch(() => null);
  },

  async down() {
    throw new Error('Irreversible migration 20260509000000-v44-academic-core-schema-repair.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
