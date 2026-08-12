'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const create = (name, columns, options = {}) => queryInterface.createTable(name, columns, options).catch(() => {});
    const addIndex = (table, fields, options = {}) => queryInterface.addIndex(table, fields, options).catch(() => {});

    await create('LearnFeedUsers', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      password: { type: Sequelize.STRING, allowNull: false },
      role: { type: Sequelize.ENUM('student', 'teacher'), allowNull: false, defaultValue: 'student' },
      displayName: { type: Sequelize.STRING(120), allowNull: false },
      handle: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      avatar: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '🎓' },
      bio: { type: Sequelize.TEXT, allowNull: true },
      subscriptionStatus: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'free' },
      walletBalanceCents: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      lastLogin: { type: Sequelize.DATE, allowNull: true },
      preferences: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('LearnFeedVideos', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      creatorId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      subject: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'General' },
      className: { type: Sequelize.STRING(80), allowNull: true },
      title: { type: Sequelize.STRING(180), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      visualEmoji: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '🎓' },
      soundTitle: { type: Sequelize.STRING(180), allowNull: true },
      topic: { type: Sequelize.STRING(120), allowNull: true },
      aiContext: { type: Sequelize.TEXT, allowNull: true },
      quizQuestion: { type: Sequelize.TEXT, allowNull: true },
      quizOptions: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      quizAnswerIndex: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      visibility: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'public' },
      allowComments: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      allowDuet: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      allowStitch: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      isLiveReplay: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'published' },
      likesCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      commentsCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      savesCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      sharesCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      viewsCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('LearnFeedInteractions', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      videoId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedVideos', key: 'id' }, onDelete: 'CASCADE' },
      type: { type: Sequelize.STRING(40), allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('LearnFeedFollows', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      followerId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      creatorId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('LearnFeedComments', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      videoId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedVideos', key: 'id' }, onDelete: 'CASCADE' },
      text: { type: Sequelize.TEXT, allowNull: false },
      likesCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      pinned: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'visible' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('LearnFeedLiveRooms', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      hostUserId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      title: { type: Sequelize.STRING(180), allowNull: false },
      subject: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'General' },
      emoji: { type: Sequelize.STRING(20), allowNull: false, defaultValue: '🔴' },
      viewers: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'live' },
      startedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      endedAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('LearnFeedMessages', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      fromUserId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      toUserId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      text: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'sent' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await create('LearnFeedSubscriptionPayments', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'LearnFeedUsers', key: 'id' }, onDelete: 'CASCADE' },
      planCode: { type: Sequelize.STRING(80), allowNull: false },
      planName: { type: Sequelize.STRING(120), allowNull: false },
      provider: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'manual' },
      amount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'KES' },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'pending' },
      internalReference: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      providerReference: { type: Sequelize.STRING(120), allowNull: true },
      checkoutUrl: { type: Sequelize.TEXT, allowNull: true },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await addIndex('LearnFeedUsers', ['email'], { name: 'learnfeed_users_email_unique', unique: true });
    await addIndex('LearnFeedUsers', ['handle'], { name: 'learnfeed_users_handle_unique', unique: true });
    await addIndex('LearnFeedVideos', ['status', 'visibility', 'createdAt'], { name: 'learnfeed_videos_feed_idx' });
    await addIndex('LearnFeedVideos', ['creatorId', 'status'], { name: 'learnfeed_videos_creator_idx' });
    await addIndex('LearnFeedInteractions', ['userId', 'videoId', 'type'], { name: 'learnfeed_interactions_unique', unique: true });
    await addIndex('LearnFeedInteractions', ['videoId', 'type'], { name: 'learnfeed_interactions_video_type_idx' });
    await addIndex('LearnFeedFollows', ['followerId', 'creatorId'], { name: 'learnfeed_follows_unique', unique: true });
    await addIndex('LearnFeedComments', ['videoId', 'status', 'createdAt'], { name: 'learnfeed_comments_video_idx' });
    await addIndex('LearnFeedLiveRooms', ['status', 'createdAt'], { name: 'learnfeed_live_rooms_status_idx' });
    await addIndex('LearnFeedMessages', ['toUserId', 'status', 'createdAt'], { name: 'learnfeed_messages_inbox_idx' });
    await addIndex('LearnFeedSubscriptionPayments', ['internalReference'], { name: 'learnfeed_subscription_ref_unique', unique: true });
    await addIndex('LearnFeedSubscriptionPayments', ['userId', 'status'], { name: 'learnfeed_subscription_user_status_idx' });
  },
  async down() {
    throw new Error('Irreversible migration 20260627000000-learnfeed-public-module.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
