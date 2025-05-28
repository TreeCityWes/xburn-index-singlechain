const { ethers } = require('ethers');
const { Pool } = require('pg');
const winston = require('winston');
const EventIndexer = require('./EventIndexer');
const XBurnMinterABI = require('../abis/XBurnMinter.json');
const XBurnNFTABI = require('../abis/XBurnNFT.json');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Blockchain provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Contract addresses
const XBURN_MINTER_ADDRESS = process.env.XBURN_MINTER_ADDRESS;
const XBURN_NFT_ADDRESS = process.env.XBURN_NFT_ADDRESS;
const START_BLOCK = parseInt(process.env.START_BLOCK || '0');

async function main() {
  logger.info('Starting XBURN Indexer...');
  
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    logger.info('Database connected successfully');
    
    // Test RPC connection
    const blockNumber = await provider.getBlockNumber();
    logger.info(`Connected to blockchain. Current block: ${blockNumber}`);
    
    // Create indexers for both contracts
    const minterIndexer = new EventIndexer({
      contractAddress: XBURN_MINTER_ADDRESS,
      contractABI: XBurnMinterABI,
      provider,
      pool,
      logger,
      startBlock: START_BLOCK,
      contractName: 'XBurnMinter'
    });
    
    const nftIndexer = new EventIndexer({
      contractAddress: XBURN_NFT_ADDRESS,
      contractABI: XBurnNFTABI,
      provider,
      pool,
      logger,
      startBlock: START_BLOCK,
      contractName: 'XBurnNFT'
    });
    
    // Start indexing
    await Promise.all([
      minterIndexer.start(),
      nftIndexer.start()
    ]);
    
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

// Start the indexer
main(); 