'use strict';

/**
 * Canonical ordered replacement for superseded placeholder migrations.
 *
 * This migration is intentionally additive and idempotent:
 * - Existing production databases keep their data and simply skip objects that exist.
 * - Databases that never ran the placeholder files receive the required tables/columns.
 * - No rollback drops production data.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableExists = async (table) => {
      try { await queryInterface.describeTable(table); return true; } catch (_) { return false; }
    };
    const columnExists = async (table, column) => {
      try { const desc = await queryInterface.describeTable(table); return Boolean(desc[column]); } catch (_) { return false; }
    };
    const create = async (table, definition) => {
      if (!(await tableExists(table))) await queryInterface.createTable(table, definition);
    };
    const add = async (table, column, definition) => {
      if ((await tableExists(table)) && !(await columnExists(table, column))) {
        await queryInterface.addColumn(table, column, definition);
      }
    };
    const index = async (table, fields, name, unique = false) => {
      if (!(await tableExists(table))) return;
      try { await queryInterface.addIndex(table, fields, { name, unique }); }
      catch (error) {
        const message = String(error?.message || '').toLowerCase();
        if (!message.includes('already exists') && !message.includes('duplicate')) throw error;
      }
    };
    const timestamps = {
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW }
    };

    await create('UserConsents', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      termsAccepted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      privacyAccepted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      acceptedAt: { type: Sequelize.DATE, allowNull: true, defaultValue: Sequelize.NOW },
      ipAddress: { type: Sequelize.STRING, allowNull: true },
      userAgent: { type: Sequelize.TEXT, allowNull: true },
      ...timestamps
    });
    await index('UserConsents', ['userId'], 'v1481_user_consents_user_lookup');

    await create('ParentChildConsents', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      parentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onDelete: 'CASCADE' },
      consentGiven: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps
    });
    await index('ParentChildConsents', ['parentId', 'studentId'], 'v1481_parent_child_consents_lookup');

    await create('SchoolDPAs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolId: { type: Sequelize.STRING, allowNull: false, references: { model: 'Schools', key: 'schoolId' }, onDelete: 'CASCADE' },
      adminId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      accepted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      acceptedAt: { type: Sequelize.DATE, allowNull: true, defaultValue: Sequelize.NOW },
      ipAddress: { type: Sequelize.STRING, allowNull: true },
      ...timestamps
    });
    await index('SchoolDPAs', ['schoolId', 'adminId'], 'v1481_school_dpa_school_admin_lookup');

    await create('Badges', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      icon: { type: Sequelize.STRING, allowNull: true },
      category: { type: Sequelize.STRING, allowNull: false, defaultValue: 'other' },
      requiredPoints: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      schoolId: { type: Sequelize.STRING, allowNull: false },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps
    });
    await index('Badges', ['schoolId', 'isActive'], 'v1481_badges_school_active');

    await create('StudentBadges', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onDelete: 'CASCADE' },
      badgeId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Badges', key: 'id' }, onDelete: 'CASCADE' },
      awardedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      ...timestamps
    });
    await index('StudentBadges', ['studentId', 'badgeId'], 'v1481_student_badges_lookup');

    await create('Rewards', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      pointsCost: { type: Sequelize.INTEGER, allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: -1 },
      schoolId: { type: Sequelize.STRING, allowNull: false },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps
    });
    await index('Rewards', ['schoolId', 'isActive'], 'v1481_rewards_school_active');

    await create('StudentRewards', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      studentId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Students', key: 'id' }, onDelete: 'CASCADE' },
      rewardId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Rewards', key: 'id' }, onDelete: 'CASCADE' },
      pointsSpent: { type: Sequelize.INTEGER, allowNull: false },
      redeemedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      ...timestamps
    });
    await index('StudentRewards', ['studentId', 'redeemedAt'], 'v1481_student_rewards_history');

    await create('SchoolCalendars', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolId: { type: Sequelize.STRING, allowNull: false },
      eventType: { type: Sequelize.STRING, allowNull: false, defaultValue: 'other' },
      eventName: { type: Sequelize.STRING, allowNull: false },
      term: { type: Sequelize.STRING, allowNull: true },
      year: { type: Sequelize.INTEGER, allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      startDate: { type: Sequelize.DATEONLY, allowNull: false },
      endDate: { type: Sequelize.DATEONLY, allowNull: true },
      time: { type: Sequelize.STRING, allowNull: true },
      location: { type: Sequelize.STRING, allowNull: true },
      audience: { type: Sequelize.STRING, allowNull: false, defaultValue: 'whole_school' },
      classId: { type: Sequelize.INTEGER, allowNull: true },
      createdByUserId: { type: Sequelize.INTEGER, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      isPublic: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps
    });
    await index('SchoolCalendars', ['schoolId', 'startDate'], 'v1481_school_calendar_date');
    await index('SchoolCalendars', ['schoolId', 'year', 'term'], 'v1481_school_calendar_term');

    await create('Timetables', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolId: { type: Sequelize.STRING, allowNull: false },
      weekStartDate: { type: Sequelize.DATEONLY, allowNull: false },
      term: { type: Sequelize.STRING, allowNull: true },
      year: { type: Sequelize.INTEGER, allowNull: true },
      scope: { type: Sequelize.STRING, allowNull: false, defaultValue: 'term' },
      slots: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      classes: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      warnings: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      isPublished: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'draft' },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      publishedAt: { type: Sequelize.DATE, allowNull: true },
      publishedBy: { type: Sequelize.INTEGER, allowNull: true },
      supersedesId: { type: Sequelize.INTEGER, allowNull: true },
      ...timestamps
    });
    await index('Timetables', ['schoolId', 'term', 'year', 'scope', 'isPublished'], 'v1481_timetable_active_lookup');

    await add('AcademicRecords', 'gradingScale', { type: Sequelize.JSONB, allowNull: true, defaultValue: null });
    await add('Students', 'isPrefect', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
  },

  async down() {
    throw new Error('Irreversible migration 20260609020000-v148-canonical-runtime-foundation.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
