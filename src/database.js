const knex = require('knex');
const config = require('./config');
const logger = require('./logger');

let db = null;

async function initializeDatabase() {
  if (db) return db;

  try {
    db = knex(config.database);
    
    // Test connection
    await db.raw('SELECT 1');
    logger.info(`Successfully connected to database ${config.database.connection.database}`);
    
    return db;
  } catch (error) {
    logger.error('Failed to initialize database connection:', error);
    throw error;
  }
}

async function closeDatabase() {
  if (db) {
    await db.destroy();
    db = null;
    logger.info('Database connection closed');
  }
}

// Get database instance (initializes if needed)
async function getDatabase() {
  if (!db) {
    await initializeDatabase();
  }
  return db;
}

module.exports = {
  initializeDatabase,
  closeDatabase,
  getDatabase
};
