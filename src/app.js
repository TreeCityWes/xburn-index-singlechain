const config = require('./config');
const logger = require('./logger');
const server = require('./server');
const { XBurnIndexer } = require('./indexer');

async function main() {
  const indexer = new XBurnIndexer();
  
  try {
    // Initialize and start indexer
    await indexer.initialize();
    indexer.start().catch(error => {
      logger.error('Fatal indexer error', { error: error.message });
      process.exit(1);
    });

    // API server is started automatically if enabled in config
    
    logger.info('XBurn indexer started successfully', {
      chain: config.chain.name,
      chainId: config.chain.id,
      apiEnabled: config.api.enabled
    });
  } catch (error) {
    logger.error('Failed to start indexer', { error: error.message });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down...');
  await indexer?.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal, shutting down...');
  await indexer?.stop();
  process.exit(0);
});

// Start the application
if (require.main === module) {
  main();
}
