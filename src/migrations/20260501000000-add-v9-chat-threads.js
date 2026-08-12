'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const create = async (name, columns) => {
      try {
        await queryInterface.createTable(name, columns);
      } catch (err) {
        const code = err?.parent?.code || err?.original?.code;
        if (code === '42P07' || String(err.message).includes('already exists')) {
          console.log(`[migration-safe] ${name} already exists; skipping`);
          return;
        }
        throw err;
      }
    };

    const baseTimestamps = {
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    };

    await create('Departments', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT },
      headTeacherId: { type: Sequelize.INTEGER },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      ...baseTimestamps
    });

    await create('DepartmentMembers', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      departmentId: { type: Sequelize.INTEGER, allowNull: false },
      teacherId: { type: Sequelize.INTEGER, allowNull: false },
      role: { type: Sequelize.STRING, defaultValue: 'member' },
      ...baseTimestamps
    });

    await create('ChatGroups', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, defaultValue: 'general' },
      description: { type: Sequelize.TEXT },
      createdBy: { type: Sequelize.INTEGER },
      departmentId: { type: Sequelize.INTEGER },
      classId: { type: Sequelize.INTEGER },
      onlyAdminsCanSend: { type: Sequelize.BOOLEAN, defaultValue: false },
      isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
      ...baseTimestamps
    });

    await create('ChatGroupMembers', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      groupId: { type: Sequelize.INTEGER, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      role: { type: Sequelize.STRING, defaultValue: 'member' },
      muted: { type: Sequelize.BOOLEAN, defaultValue: false },
      ...baseTimestamps
    });

    await create('ChatMessages', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      senderId: { type: Sequelize.INTEGER, allowNull: false },
      receiverId: { type: Sequelize.INTEGER },
      groupId: { type: Sequelize.INTEGER },
      messageType: { type: Sequelize.STRING, defaultValue: 'text' },
      content: { type: Sequelize.TEXT, allowNull: false },
      attachmentUrl: { type: Sequelize.STRING },
      pointsAwarded: { type: Sequelize.INTEGER, defaultValue: 0 },
      streakAwarded: { type: Sequelize.INTEGER, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      isRead: { type: Sequelize.BOOLEAN, defaultValue: false },
      ...baseTimestamps
    });

    await create('ClassroomThreads', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      classId: { type: Sequelize.INTEGER },
      subject: { type: Sequelize.STRING, allowNull: false },
      topic: { type: Sequelize.STRING, allowNull: false },
      content: { type: Sequelize.TEXT, allowNull: false },
      teacherId: { type: Sequelize.INTEGER },
      createdBy: { type: Sequelize.INTEGER, allowNull: false },
      isPinned: { type: Sequelize.BOOLEAN, defaultValue: false },
      isClosed: { type: Sequelize.BOOLEAN, defaultValue: false },
      pointsAwarded: { type: Sequelize.INTEGER, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      ...baseTimestamps
    });

    await create('ThreadReplies', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      threadId: { type: Sequelize.INTEGER, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      parentReplyId: { type: Sequelize.INTEGER },
      content: { type: Sequelize.TEXT, allowNull: false },
      pointsAwarded: { type: Sequelize.INTEGER, defaultValue: 0 },
      streakAwarded: { type: Sequelize.INTEGER, defaultValue: 0 },
      helpfulCount: { type: Sequelize.INTEGER, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      ...baseTimestamps
    });

    await create('AchievementEvents', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schoolCode: { type: Sequelize.STRING, allowNull: false },
      studentId: { type: Sequelize.INTEGER },
      userId: { type: Sequelize.INTEGER },
      awardedBy: { type: Sequelize.INTEGER },
      sourceType: { type: Sequelize.STRING, allowNull: false },
      sourceId: { type: Sequelize.INTEGER },
      points: { type: Sequelize.INTEGER, defaultValue: 0 },
      streakDelta: { type: Sequelize.INTEGER, defaultValue: 0 },
      title: { type: Sequelize.STRING, defaultValue: 'Achievement' },
      note: { type: Sequelize.TEXT },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      ...baseTimestamps
    });
  },

  async down(queryInterface) {
    for (const table of ['AchievementEvents','ThreadReplies','ClassroomThreads','ChatMessages','ChatGroupMembers','ChatGroups','DepartmentMembers','Departments']) {
      try { await queryInterface.dropTable(table); } catch (_) {}
    }
  }
};
