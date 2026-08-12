'use strict';

const { reconcileModels } = require('./lib/canonical-model-reconciler');

module.exports = {
  async up(queryInterface, Sequelize) {
    const models = queryInterface.sequelize.modelManager.models;
    if (!models.length) throw new Error('Full schema verification cannot run because no Sequelize models are registered');
    await reconcileModels(queryInterface, Sequelize, models);
  },
  async down() {
    throw new Error('Irreversible migration 20260722010000-v2037-full-model-schema-verification.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
