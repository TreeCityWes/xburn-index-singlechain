const { ethers } = require('ethers');

const schema = {
  // Indexer state table
  indexer_state: {
    chain_id: { type: 'string', maxLength: 32, notNull: true },
    last_indexed_block: { type: 'bigint', notNull: true },
    last_indexed_at: { type: 'timestamp', notNull: true },
    batch_size: { type: 'integer', notNull: true },
    retry_count: { type: 'integer', notNull: true, default: 0 }
  },

  // XEN burns table
  xen_burns: {
    tx_hash: { type: 'string', maxLength: 66, notNull: true },
    block_number: { type: 'bigint', notNull: true },
    log_index: { type: 'integer', notNull: true },
    timestamp: { type: 'timestamp', notNull: true },
    user: { type: 'string', maxLength: 42, notNull: true },
    amount: { type: 'numeric', notNull: true },
    chain_id: { type: 'string', maxLength: 32, notNull: true }
  },

  // Burn NFTs table
  burn_nfts: {
    token_id: { type: 'numeric', notNull: true },
    tx_hash: { type: 'string', maxLength: 66, notNull: true },
    block_number: { type: 'bigint', notNull: true },
    log_index: { type: 'integer', notNull: true },
    timestamp: { type: 'timestamp', notNull: true },
    user: { type: 'string', maxLength: 42, notNull: true },
    xen_amount: { type: 'numeric', notNull: true },
    term: { type: 'numeric', notNull: true },
    chain_id: { type: 'string', maxLength: 32, notNull: true }
  },

  // Raw events table
  raw_events: {
    chain_id: { type: 'string', maxLength: 32, notNull: true },
    block_number: { type: 'bigint', notNull: true },
    tx_hash: { type: 'string', maxLength: 66, notNull: true },
    log_index: { type: 'integer', notNull: true },
    address: { type: 'string', maxLength: 42, notNull: true },
    event_type: { type: 'string', maxLength: 64, notNull: true },
    data: { type: 'jsonb', notNull: true }
  },

  // Indexer metrics table
  indexer_metrics: {
    chain_id: { type: 'string', maxLength: 32, notNull: true },
    block_number: { type: 'bigint', notNull: true },
    last_indexed_block: { type: 'bigint', notNull: true },
    timestamp: { type: 'timestamp', notNull: true },
    batch_size: { type: 'integer', notNull: true },
    batch_time_ms: { type: 'integer', notNull: true },
    events_processed: { type: 'integer', notNull: true },
    memory_usage_mb: { type: 'float', notNull: true }
  }
};

async function createSchema(db) {
  for (const [tableName, tableSchema] of Object.entries(schema)) {
    if (!(await db.schema.hasTable(tableName))) {
      await db.schema.createTable(tableName, table => {
        if (!tableSchema.id === false) {
          table.increments('id').primary();
        }
        
        for (const [columnName, columnDef] of Object.entries(tableSchema)) {
          if (columnName === 'id') continue;
          
          if (!columnDef || typeof columnDef !== 'object' || !columnDef.type) {
            throw new Error(`Invalid column definition for ${columnName} in table ${tableName}`);
          }
          
          let column;
          const columnType = columnDef.type.toLowerCase();
          switch (columnType) {
            case 'string':
              column = table.string(columnName, columnDef.maxLength);
              break;
            case 'bigint':
              column = table.bigInteger(columnName);
              break;
            case 'integer':
              column = table.integer(columnName);
              break;
            case 'numeric':
              column = table.decimal(columnName, 30, 0);
              break;
            case 'timestamp':
              column = table.timestamp(columnName);
              break;
            case 'float':
              column = table.float(columnName);
              break;
            case 'jsonb':
              column = table.jsonb(columnName);
              break;
            default:
              throw new Error(`Unknown column type: ${columnType} for column ${columnName} in table ${tableName}`);
          }
          
          if (columnDef.notNull) {
            column.notNullable();
          }

          if (columnDef.unique) {
            column.unique();
          }

          if (columnDef.default !== undefined) {
            column.defaultTo(columnDef.default);
          }
        }
        
        // Add indexes
        if (tableName === 'indexer_state') {
          table.unique(['chain_id']);
        } else if (tableName !== 'knex_migrations' && tableName !== 'knex_migrations_lock') {
          table.index(['chain_id', 'block_number']);
          if (tableName !== 'indexer_metrics') {
            table.unique(['tx_hash', 'log_index', 'chain_id']);
          }
        }
      });
    }
  }
}

module.exports = {
  schema,
  createSchema,
};
