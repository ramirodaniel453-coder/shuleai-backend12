'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'message';`).catch(() => {});
    await sequelize.query(`ALTER TYPE "enum_Alerts_type" ADD VALUE IF NOT EXISTS 'career';`).catch(() => {});
    await sequelize.query(`CREATE INDEX IF NOT EXISTS "alerts_user_target_idx" ON "Alerts" ("userId", "targetUserId", "role", "createdAt");`).catch(() => {});
    await sequelize.query(`CREATE INDEX IF NOT EXISTS "messages_sender_receiver_idx" ON "Messages" ("senderId", "receiverId", "createdAt");`).catch(() => {});
    await sequelize.query(`CREATE INDEX IF NOT EXISTS "messages_metadata_conversation_idx" ON "Messages" USING GIN ("metadata");`).catch(() => {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "messages_metadata_conversation_idx";`).catch(() => {});
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "messages_sender_receiver_idx";`).catch(() => {});
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "alerts_user_target_idx";`).catch(() => {});
  }
};
