const knex = require('knex');
const config = require('./config');
const logger = require('./logger');

let db = null;

async function initializeSchema(db) {
  // Create tables if they don't exist
  const tables = [
    // Indexer state table
    db.schema.createTableIfNotExists('indexer_state', table => {
      table.string('chain_id', 32).primary();
      table.bigInteger('last_indexed_block').notNullable();
      table.timestamp('last_indexed_at').notNullable();
      table.integer('batch_size').notNullable();
      table.integer('retry_count').notNullable().defaultTo(0);
    }),

    // XEN burns table
    db.schema.createTableIfNotExists('xen_burns', table => {
      table.string('tx_hash', 66).notNullable();
      table.bigInteger('block_number').notNullable();
      table.integer('log_index').notNullable();
      table.timestamp('timestamp').notNullable();
      table.string('user', 42).notNullable();
      table.decimal('amount', 78, 0).notNullable();
      table.decimal('accumulated_amount', 78, 0).notNullable(); // 20% accumulated for swaps
      table.decimal('direct_burn_amount', 78, 0).notNullable(); // 80% directly burned
      table.string('chain_id', 32).notNullable();
      table.unique(['tx_hash', 'log_index', 'chain_id'], 'xen_burns_unique_event');
      table.index(['chain_id', 'block_number']);
      table.index(['timestamp'], 'idx_xen_burns_timestamp');
      table.index(['user', 'chain_id'], 'idx_xen_burns_user');
    }),

    // XBURN burns table
    db.schema.createTableIfNotExists('xburn_burns', table => {
      table.string('tx_hash', 66).notNullable();
      table.bigInteger('block_number').notNullable();
      table.integer('log_index').notNullable();
      table.timestamp('timestamp').notNullable();
      table.string('user_address', 42).notNullable();
      table.decimal('amount', 78, 0).notNullable();
      table.string('chain_id', 32).notNullable();
      table.unique(['tx_hash', 'log_index', 'chain_id'], 'xburn_burns_unique_event');
      table.index(['chain_id', 'block_number']);
      table.index(['timestamp'], 'idx_xburn_burns_timestamp');
      table.index(['user_address', 'chain_id'], 'idx_xburn_burns_user');
    }),

    // XBURN claims table
    db.schema.createTableIfNotExists('xburn_claims', table => {
      table.string('tx_hash', 66).notNullable();
      table.bigInteger('block_number').notNullable();
      table.integer('log_index').notNullable();
      table.timestamp('timestamp').notNullable();
      table.string('user_address', 42).notNullable();
      table.decimal('token_id', 78, 0).notNullable();
      table.decimal('base_amount', 78, 0).notNullable();
      table.decimal('bonus_amount', 78, 0).notNullable();
      table.decimal('total_amount', 78, 0).notNullable();
      table.string('chain_id', 32).notNullable();
      table.unique(['tx_hash', 'log_index', 'chain_id'], 'xburn_claims_unique_event');
      table.index(['chain_id', 'block_number']);
      table.index(['token_id', 'chain_id']);
      table.index(['timestamp'], 'idx_xburn_claims_timestamp');
      table.index(['user_address', 'chain_id'], 'idx_xburn_claims_user');
    }),

    // Burn NFTs table
    db.schema.createTableIfNotExists('burn_nfts', table => {
      table.decimal('token_id', 78, 0).notNullable();
      table.string('tx_hash', 66).notNullable();
      table.bigInteger('block_number').notNullable();
      table.integer('log_index').notNullable();
      table.timestamp('timestamp').notNullable();
      table.string('user', 42).notNullable();
      table.decimal('xen_amount', 78, 0).notNullable();
      table.integer('term_days').notNullable(); // Term in days for better querying
      table.timestamp('maturity_timestamp').notNullable(); // When the lock expires
      table.string('chain_id', 32).notNullable();
      table.boolean('claimed').notNullable().defaultTo(false);
      table.timestamp('claimed_at').nullable();
      table.string('claim_tx_hash', 66).nullable();
      table.boolean('burned').notNullable().defaultTo(false);
      table.timestamp('burned_at').nullable();
      table.string('burn_tx_hash', 66).nullable();
      table.boolean('early_burn').notNullable().defaultTo(false); // Track if burned before maturity
      table.unique(['tx_hash', 'log_index', 'chain_id'], 'burn_nfts_unique_event');
      table.unique(['token_id', 'chain_id']);
      table.index(['chain_id', 'block_number']);
      table.index(['term_days'], 'idx_burn_nfts_term');
      table.index(['maturity_timestamp'], 'idx_burn_nfts_maturity');
      table.index(['user', 'chain_id'], 'idx_burn_nfts_user');
      table.index(['timestamp'], 'idx_burn_nfts_timestamp');
    }),

    // NFT transfers table
    db.schema.createTableIfNotExists('nft_transfers', table => {
      table.string('tx_hash', 66).notNullable();
      table.bigInteger('block_number').notNullable();
      table.integer('log_index').notNullable();
      table.timestamp('timestamp').notNullable();
      table.decimal('token_id', 78, 0).notNullable();
      table.string('from_address', 42).notNullable();
      table.string('to_address', 42).notNullable();
      table.string('chain_id', 32).notNullable();
      table.unique(['tx_hash', 'log_index', 'chain_id'], 'nft_transfers_unique_event');
      table.index(['chain_id', 'block_number']);
      table.index(['token_id', 'chain_id']);
      table.index(['timestamp'], 'idx_nft_transfers_timestamp');
      table.index(['from_address', 'chain_id'], 'idx_nft_transfers_from');
      table.index(['to_address', 'chain_id'], 'idx_nft_transfers_to');
    }),

    // Raw events table
    db.schema.createTableIfNotExists('raw_events', table => {
      table.increments('id').primary();
      table.string('tx_hash', 66).notNullable().index();
      table.bigInteger('block_number').notNullable().index();
      table.integer('log_index').notNullable();
      table.string('address', 42).notNullable().index();
      table.jsonb('data').notNullable();
      table.string('event_type').nullable();
      table.string('chain_id', 32).notNullable().index();
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.unique(['tx_hash', 'log_index', 'chain_id'], 'raw_events_unique_event');
      table.index(['chain_id', 'block_number']);
      table.index(['created_at'], 'idx_raw_events_created');
    }),

    // Indexer metrics table
    db.schema.createTableIfNotExists('indexer_metrics', table => {
      table.increments('id').primary();
      table.string('chain_id', 32).notNullable().index();
      table.bigInteger('block_number').notNullable();
      table.bigInteger('last_indexed_block').notNullable();
      table.timestamp('timestamp').notNullable();
      table.integer('batch_size').notNullable();
      table.integer('events_processed').notNullable();
      table.integer('batch_time_ms').notNullable();
      table.float('memory_usage_mb').notNullable();
      table.index(['chain_id', 'timestamp']);
    }),

    // No static stats tables needed
  ];

  try {
    await Promise.all(tables);
    logger.info('Database schema initialized successfully');

    // Create views for common analytics
    await db.raw(`
      -- Active XLocks (NFTs not claimed or burned)
      CREATE OR REPLACE VIEW active_xlocks AS
      SELECT 
        user,
        token_id,
        xen_amount,
        term_days,
        timestamp as created_at,
        maturity_timestamp
      FROM burn_nfts
      WHERE claimed = false AND burned = false;

      -- Early burns (NFTs burned before maturity)
      CREATE OR REPLACE VIEW early_burns AS
      SELECT 
        b.*,
        maturity_timestamp - burned_at as time_remaining
      FROM burn_nfts b
      WHERE burned = true 
      AND burned_at < maturity_timestamp;

      -- Wallet statistics from events
      CREATE OR REPLACE VIEW wallet_stats AS
      SELECT 
        x.user as address,
        x.chain_id,
        SUM(x.amount) as total_xen_burned,
        COALESCE(SUM(c.total_amount), 0) as total_xburn_claimed,
        COUNT(DISTINCT CASE WHEN n.claimed = false AND n.burned = false THEN n.token_id END) as active_locks,
        COUNT(DISTINCT CASE WHEN n.claimed = true THEN n.token_id END) as completed_locks,
        COUNT(DISTINCT CASE WHEN n.burned = true AND n.early_burn = true THEN n.token_id END) as early_unlocks,
        MAX(GREATEST(x.timestamp, COALESCE(c.timestamp, '1970-01-01'), COALESCE(n.timestamp, '1970-01-01'))) as last_activity_at
      FROM xen_burns x
      LEFT JOIN xburn_claims c ON x.user = c.user_address AND x.chain_id = c.chain_id
      LEFT JOIN burn_nfts n ON x.user = n.user AND x.chain_id = n.chain_id
      GROUP BY x.user, x.chain_id;

      -- Term statistics from events
      CREATE OR REPLACE VIEW term_stats AS
      SELECT
        term_days,
        chain_id,
        COUNT(*) as total_locks,
        COUNT(CASE WHEN claimed = false AND burned = false THEN 1 END) as active_locks,
        SUM(xen_amount) as total_xen_burned,
        CASE 
          WHEN COUNT(*) > 0 THEN SUM(xen_amount) / COUNT(*)
          ELSE 0
        END as avg_xburn_reward
      FROM burn_nfts
      GROUP BY term_days, chain_id;

      -- Top burners by XEN amount
      CREATE OR REPLACE VIEW top_burners AS
      SELECT 
        user,
        SUM(xen_amount) as total_xen_burned,
        COUNT(*) as total_locks,
        AVG(term_days) as avg_term
      FROM burn_nfts
      GROUP BY user
      ORDER BY total_xen_burned DESC;
    `);

    logger.info('Analytics views created successfully');
  } catch (error) {
    logger.error('Error initializing database schema:', error);
    throw error;
  }
}

async function initializeDatabase() {
  if (db) return db;

  try {
    db = knex(config.database);
    
    // Test connection
    await db.raw('SELECT 1');
    logger.info(`Successfully connected to database ${config.database.connection.database}`);
    
    // Initialize schema when connecting
    await initializeSchema(db);

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
