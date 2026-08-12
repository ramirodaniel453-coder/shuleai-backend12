'use strict';

/**
 * V200.4 integrated uploaded LearnFeed database migration.
 * Source upload: shule-ai-learnfeed-db-migrations-separate(1).zip
 * Purpose: add full LearnFeed mobile functionality support tables without replacing
 * the existing runtime LearnFeed models/tables. This migration is idempotent.
 */
const SQL = String.raw`-- Shule AI LearnFeed full mobile functionality support
-- Date: 2026-06-29
-- Database: PostgreSQL
-- Purpose: backend tables for the bulletproof mobile app functions.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS learnfeed_user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  handle TEXT,
  role TEXT CHECK (role IN ('student','teacher','creator','admin','super_admin')) DEFAULT 'student',
  avatar TEXT,
  bio TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_school_linked BOOLEAN NOT NULL DEFAULT FALSE,
  access_active BOOLEAN NOT NULL DEFAULT FALSE,
  subscription_status TEXT DEFAULT 'free',
  subscription_plan_code TEXT DEFAULT 'free',
  learnfeed_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  private_account BOOLEAN NOT NULL DEFAULT FALSE,
  allow_comments BOOLEAN NOT NULL DEFAULT TRUE,
  allow_duet BOOLEAN NOT NULL DEFAULT TRUE,
  allow_stitch BOOLEAN NOT NULL DEFAULT TRUE,
  allow_downloads BOOLEAN NOT NULL DEFAULT TRUE,
  notification_likes BOOLEAN NOT NULL DEFAULT TRUE,
  notification_comments BOOLEAN NOT NULL DEFAULT TRUE,
  notification_live BOOLEAN NOT NULL DEFAULT TRUE,
  content_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocked_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  creator_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT DEFAULT 'GENERAL',
  class_name TEXT DEFAULT 'Public',
  topic TEXT,
  visibility TEXT CHECK (visibility IN ('Public','Followers','Private')) DEFAULT 'Public',
  sound_title TEXT,
  effect_name TEXT,
  visual_emoji TEXT DEFAULT '🎓',
  video_url TEXT,
  thumbnail_url TEXT,
  ai_context TEXT,
  quiz_question TEXT,
  quiz_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  quiz_answer_index INTEGER DEFAULT 0,
  allow_comments BOOLEAN NOT NULL DEFAULT TRUE,
  allow_duet BOOLEAN NOT NULL DEFAULT TRUE,
  allow_stitch BOOLEAN NOT NULL DEFAULT TRUE,
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  saves_count INTEGER NOT NULL DEFAULT 0,
  shares_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_video_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('like','save','share','follow','not_interested','download','story')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, video_id, action_type)
);

CREATE TABLE IF NOT EXISTS learnfeed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  parent_comment_id TEXT,
  user_name TEXT,
  avatar TEXT,
  body TEXT NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_comment_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('like','report')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, comment_id, action_type)
);

CREATE TABLE IF NOT EXISTS learnfeed_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id TEXT,
  video_id TEXT,
  comment_id TEXT,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  moderator_user_id TEXT,
  moderation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_ai_tutor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  video_id TEXT,
  question TEXT NOT NULL,
  answer TEXT,
  source TEXT DEFAULT 'backend_ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  selected_answer_index INTEGER NOT NULL,
  correct_answer_index INTEGER,
  is_correct BOOLEAN,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_live_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT DEFAULT 'General',
  emoji TEXT DEFAULT '🔴',
  status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('scheduled','live','ended')),
  allow_gifts BOOLEAN NOT NULL DEFAULT TRUE,
  allow_join_requests BOOLEAN NOT NULL DEFAULT TRUE,
  viewers_count INTEGER NOT NULL DEFAULT 0,
  hearts_count INTEGER NOT NULL DEFAULT 0,
  gifts_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_live_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  message_type TEXT NOT NULL DEFAULT 'chat' CHECK (message_type IN ('chat','system','join_request')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_live_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  host_user_id TEXT,
  gift_id TEXT NOT NULL,
  gift_name TEXT DEFAULT 'Creator Gift',
  amount_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a TEXT NOT NULL,
  participant_b TEXT NOT NULL,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (participant_a, participant_b)
);

CREATE TABLE IF NOT EXISTS learnfeed_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  attachment_url TEXT,
  attachment_type TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'KES',
  balance_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_earned_kes NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('gift_income','subscription_income','bonus','withdrawal','refund','adjustment')),
  amount_kes NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  provider TEXT,
  provider_reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_payout_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'mpesa',
  account_name TEXT,
  phone TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  route_type TEXT,
  route_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_creator_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','recording','published','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_remixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  new_video_id TEXT,
  remix_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_sounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  creator TEXT,
  icon TEXT DEFAULT 'musical-notes',
  uses_count INTEGER NOT NULL DEFAULT 0,
  audio_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learnfeed_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  color TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lf_videos_user_id ON learnfeed_videos(user_id);
CREATE INDEX IF NOT EXISTS idx_lf_videos_subject ON learnfeed_videos(subject);
CREATE INDEX IF NOT EXISTS idx_lf_video_actions_user_video ON learnfeed_video_actions(user_id, video_id);
CREATE INDEX IF NOT EXISTS idx_lf_comments_video_id ON learnfeed_comments(video_id);
CREATE INDEX IF NOT EXISTS idx_lf_reports_status ON learnfeed_reports(status);
CREATE INDEX IF NOT EXISTS idx_lf_quiz_user_video ON learnfeed_quiz_attempts(user_id, video_id);
CREATE INDEX IF NOT EXISTS idx_lf_live_rooms_status ON learnfeed_live_rooms(status);
CREATE INDEX IF NOT EXISTS idx_lf_live_messages_room ON learnfeed_live_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_lf_messages_to_user ON learnfeed_messages(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lf_wallet_transactions_user ON learnfeed_wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lf_notifications_user ON learnfeed_notifications(user_id, created_at DESC);

INSERT INTO learnfeed_sounds (title, creator, icon, uses_count)
VALUES
  ('Original Sound - Study Beat', 'LearnFeed', 'musical-notes', 18200),
  ('Soft Revision Lofi', 'Shule AI', 'headset', 9400),
  ('Exam Focus Timer', 'Creator Tools', 'timer', 4100),
  ('Teacher Voiceover', 'Public Creators', 'mic', 12700)
ON CONFLICT DO NOTHING;

INSERT INTO learnfeed_effects (name, icon, color)
VALUES
  ('Green Screen Notes', 'albums-outline', '#00C2BA'),
  ('Auto Captions', 'text-outline', '#FFD700'),
  ('Quiz Sticker', 'help-circle-outline', '#FF3B5C'),
  ('Whiteboard', 'create-outline', '#7B5CF6'),
  ('Formula Overlay', 'calculator-outline', '#00C875'),
  ('Beauty / Light', 'sparkles-outline', '#3DD8D2')
ON CONFLICT (name) DO NOTHING;
`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(SQL);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS learnfeed_effects;
      DROP TABLE IF EXISTS learnfeed_sounds;
      DROP TABLE IF EXISTS learnfeed_stories;
      DROP TABLE IF EXISTS learnfeed_remixes;
      DROP TABLE IF EXISTS learnfeed_creator_calendar;
      DROP TABLE IF EXISTS learnfeed_notifications;
      DROP TABLE IF EXISTS learnfeed_payout_accounts;
      DROP TABLE IF EXISTS learnfeed_wallet_transactions;
      DROP TABLE IF EXISTS learnfeed_wallets;
      DROP TABLE IF EXISTS learnfeed_messages;
      DROP TABLE IF EXISTS learnfeed_conversations;
      DROP TABLE IF EXISTS learnfeed_live_gifts;
      DROP TABLE IF EXISTS learnfeed_live_messages;
      DROP TABLE IF EXISTS learnfeed_live_rooms;
      DROP TABLE IF EXISTS learnfeed_quiz_attempts;
      DROP TABLE IF EXISTS learnfeed_ai_tutor_logs;
      DROP TABLE IF EXISTS learnfeed_reports;
      DROP TABLE IF EXISTS learnfeed_comment_actions;
      DROP TABLE IF EXISTS learnfeed_comments;
      DROP TABLE IF EXISTS learnfeed_video_actions;
      DROP TABLE IF EXISTS learnfeed_videos;
      DROP TABLE IF EXISTS learnfeed_user_settings;
      DROP TABLE IF EXISTS learnfeed_user_profiles;
    `);
  }
};
