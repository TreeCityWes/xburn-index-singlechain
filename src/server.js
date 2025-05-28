const express = require('express');
const config = require('./config');
const { getDatabase } = require('./database');
const logger = require('./logger');

const app = express();
const port = config.api.port;

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const db = await getDatabase();
    
    // Get indexer state
    const state = await db('indexer_state')
      .where('chain_id', config.chain.id)
      .first();
      
    if (!state) {
      return res.status(503).json({
        status: 'error',
        message: 'No indexer state found',
        chainId: config.chain.id,
        chainName: config.chain.name
      });
    }

    // Check if indexer is stalled (no updates in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (new Date(state.last_indexed_at) < fiveMinutesAgo) {
      return res.status(503).json({
        status: 'error',
        message: 'Indexer appears to be stalled',
        chainId: config.chain.id,
        chainName: config.chain.name,
        lastIndexedBlock: state.last_indexed_block,
        lastIndexedAt: state.last_indexed_at
      });
    }

    // Get latest metrics
    const latestMetrics = await db('indexer_metrics')
      .where('chain_id', config.chain.id)
      .orderBy('created_at', 'desc')
      .first();

    // Return healthy status
    return res.json({
      status: 'ok',
      chainId: config.chain.id,
      chainName: config.chain.name,
      lastIndexedBlock: state.last_indexed_block,
      lastIndexedAt: state.last_indexed_at,
      metrics: latestMetrics ? {
        batchSize: latestMetrics.batch_size,
        eventsProcessed: latestMetrics.events_processed,
        batchTimeMs: latestMetrics.batch_time_ms,
        memoryUsageMb: latestMetrics.memory_usage_mb
      } : null
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    return res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Start server if enabled
if (config.api.enabled) {
  app.listen(port, config.api.host, () => {
    logger.info(`Health check API listening`, { 
      port,
      host: config.api.host
    });
  });
}

module.exports = app;
