// src/routes/demo.routes.js
const express = require('express');
const {
  sharpeController,
  frontierController,
  qaoaBitsController,
  allocationController,
  evolutionController,
  stressController,
} = require('../controllers/demo.controller');

const router = express.Router();

router.get('/sharpe', sharpeController);           // mirrors fetchSharpeComparison()
router.post('/frontier', frontierController);      // mirrors fetchEfficientFrontier()
router.post('/qaoa/bits', qaoaBitsController);     // mirrors runQAOASelection()
router.post('/allocation', allocationController);  // mirrors fetchAllocation()
router.post('/evolution', evolutionController);    // mirrors backtestEvolution()
router.post('/stress', stressController);          // mirrors stressSim()

module.exports = router;
