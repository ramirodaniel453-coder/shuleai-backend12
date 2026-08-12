const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const searchController = require('../controllers/searchController');

router.get('/', protect, searchController.globalSearch);

module.exports = router;
