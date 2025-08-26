const express = require('express');
const { optimizeController } = require('../controllers/optimize.controller');

const router = express.Router();
router.post('/optimize', optimizeController);

module.exports = router;
