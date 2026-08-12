'use strict';

/**
 * V200.5 dashboard/profile/followers migration integrated from
 * shule-ai-learnfeed-db-migrations-dashboard-profile-followers(1).zip
 * Additive and idempotent: alters existing LearnFeed profile table if present
 * and creates followers, dashboard snapshots, and profile activity tables.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;
    await sequelize.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS learnfeed_user_follows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        follower_user_id UUID NOT NULL,
        following_user_id UUID NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT learnfeed_user_follows_not_self CHECK (follower_user_id <> following_user_id),
        CONSTRAINT learnfeed_user_follows_unique UNIQUE (follower_user_id, following_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_learnfeed_user_follows_follower ON learnfeed_user_follows (follower_user_id, status);
      CREATE INDEX IF NOT EXISTS idx_learnfeed_user_follows_following ON learnfeed_user_follows (following_user_id, status);

      CREATE TABLE IF NOT EXISTS learnfeed_dashboard_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        role VARCHAR(40) NOT NULL,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        modules JSONB NOT NULL DEFAULT '[]'::jsonb,
        content JSONB NOT NULL DEFAULT '[]'::jsonb,
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT learnfeed_dashboard_snapshots_unique UNIQUE (user_id, role)
      );
      CREATE INDEX IF NOT EXISTS idx_learnfeed_dashboard_snapshots_user_role ON learnfeed_dashboard_snapshots (user_id, role);

      CREATE TABLE IF NOT EXISTS learnfeed_profile_activity_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        actor_user_id UUID,
        event_type VARCHAR(80) NOT NULL,
        entity_type VARCHAR(80),
        entity_id UUID,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_learnfeed_profile_activity_user ON learnfeed_profile_activity_events (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learnfeed_profile_activity_actor ON learnfeed_profile_activity_events (actor_user_id, created_at DESC);
    `);
    await sequelize.query(`
      ALTER TABLE learnfeed_user_profiles
        ADD COLUMN IF NOT EXISTS school_name VARCHAR(220),
        ADD COLUMN IF NOT EXISTS class_name VARCHAR(120),
        ADD COLUMN IF NOT EXISTS subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS phone VARCHAR(40),
        ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(40) NOT NULL DEFAULT 'public';
    `).catch(()=>{});
  },
  async down(queryInterface) {
    const { sequelize } = queryInterface;
    await sequelize.query(`DROP TABLE IF EXISTS learnfeed_profile_activity_events;`);
    await sequelize.query(`DROP TABLE IF EXISTS learnfeed_dashboard_snapshots;`);
    await sequelize.query(`DROP TABLE IF EXISTS learnfeed_user_follows;`);
  }
};
