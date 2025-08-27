const express = require('express');
const router = express.Router();
const { rebalanceHandler } = require('../controllers/rebalance.controller');

router.post('/', rebalanceHandler); // POST /api/rebalance

module.exports = router;
