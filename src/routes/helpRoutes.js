// src/routes/helpRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const helpController = require('../controllers/helpController');

router.use(protect);

router.get('/articles', helpController.getArticles);
router.get('/search', helpController.searchArticles);
router.get('/articles/:id', helpController.getArticle);

module.exports = router;
