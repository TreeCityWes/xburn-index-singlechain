/**
 * Configuration management for XBurn Indexer
 * Supports environment variables and config file loading
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Default configuration
const defaultConfig = {
  // Chain configuration
  chain: {
    id: process.env.CHAIN_ID || '1',
    name: process.env.CHAIN_NAME || 'ethereum',
    startBlock: process.env.START_BLOCK ? parseInt(process.env.START_BLOCK, 10) : 0,
    batchSize: process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE, 10) : 500,
    rpcUrl: process.env.RPC_URL || 'https://eth.llamarpc.com',
    backupRpcUrls: (process.env.BACKUP_RPC_URLS || '').split(',').filter(Boolean),
  },
  
  // Contract addresses
  contracts: {
    xenCrypto: process.env.XEN_CONTRACT || '0x06450dEe7FD2Fb8E39061434BAbCFC05599a6Fb8',
    xburnMinter: process.env.XBURN_MINTER_CONTRACT || '0x0598dd8aCaBD947e2df48E1368779849D07f8483',
    xburnNft: process.env.XBURN_NFT_CONTRACT || '0xCB7d2A11d3271D2793E76C37Ad06ddEEb514C1fa',
  },
  
  // Database configuration
  database: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'xburn',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    },
    pool: {
      min: parseInt(process.env.DB_POOL_MIN || 2, 10),
      max: parseInt(process.env.DB_POOL_MAX || 10, 10),
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: path.join(__dirname, 'migrations'),
    },
  },
  
  // API configuration (if enabled)
  api: {
    enabled: process.env.ENABLE_API === 'true',
    port: parseInt(process.env.API_PORT || 3000, 10),
    host: process.env.API_HOST || '0.0.0.0',
  },
  
  // Indexer configuration
  indexer: {
    interval: parseInt(process.env.INDEXER_INTERVAL_MS || 15000, 10),
    maxRetries: parseInt(process.env.INDEXER_MAX_RETRIES || 5, 10),
    retryDelay: parseInt(process.env.INDEXER_RETRY_DELAY_MS || 5000, 10),
    updateStatsInterval: parseInt(process.env.UPDATE_STATS_INTERVAL || 50, 10),
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    console: process.env.LOG_CONSOLE !== 'false',
    file: process.env.LOG_FILE === 'true',
    filename: process.env.LOG_FILENAME || 'xburn-indexer.log',
  },
};

// Try to load external config file if specified
function loadConfigFile() {
  const configPath = process.env.CONFIG_FILE_PATH || path.join(process.cwd(), 'config', 'chain.config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      console.log(`Loading config from ${configPath}`);
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return fileConfig;
    }
  } catch (error) {
    console.error(`Error loading config file from ${configPath}:`, error.message);
  }
  
  return {};
}

// Merge configuration sources with precedence:
// 1. Environment variables (highest)
// 2. Config file
// 3. Default values (lowest)
const fileConfig = loadConfigFile();
const mergedConfig = {
  ...defaultConfig,
  ...fileConfig,
  chain: { ...defaultConfig.chain, ...(fileConfig.chain || {}) },
  contracts: { ...defaultConfig.contracts, ...(fileConfig.contracts || {}) },
  database: { 
    ...defaultConfig.database, 
    ...(fileConfig.database || {}),
    connection: { 
      ...defaultConfig.database.connection, 
      ...((fileConfig.database || {}).connection || {}) 
    }
  },
  api: { ...defaultConfig.api, ...(fileConfig.api || {}) },
  indexer: { ...defaultConfig.indexer, ...(fileConfig.indexer || {}) },
  logging: { ...defaultConfig.logging, ...(fileConfig.logging || {}) },
};

module.exports = mergedConfig;
