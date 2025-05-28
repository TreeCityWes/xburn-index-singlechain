/**
 * Add unique constraints and raw events table for production reliability
 */
async function up(knex) {
  await knex.schema.alterTable('xen_burns', table => {
    table.integer('log_index').notNullable();
    table.unique(['tx_hash', 'log_index', 'chain_id'], 'xen_burns_unique_event');
  });

  await knex.schema.alterTable('burn_nfts', table => {
    table.integer('log_index').notNullable();
    table.unique(['tx_hash', 'log_index', 'chain_id'], 'burn_nfts_unique_event');
  });

  await knex.schema.alterTable('xburn_claims', table => {
    table.integer('log_index').notNullable();
    table.unique(['tx_hash', 'log_index', 'chain_id'], 'xburn_claims_unique_event');
  });

  await knex.schema.alterTable('xburn_burns', table => {
    table.integer('log_index').notNullable();
    table.unique(['tx_hash', 'log_index', 'chain_id'], 'xburn_burns_unique_event');
  });

  await knex.schema.alterTable('nft_transfers', table => {
    table.integer('log_index').notNullable();
    table.unique(['tx_hash', 'log_index', 'chain_id'], 'nft_transfers_unique_event');
  });

  // Raw events table for auditing and unknown events
  await knex.schema.createTable('raw_events', table => {
    table.increments('id').primary();
    table.string('tx_hash', 66).notNullable().index();
    table.bigInteger('block_number').notNullable().index();
    table.integer('log_index').notNullable();
    table.string('address', 42).notNullable().index();
    table.jsonb('data').notNullable();
    table.string('event_type').nullable();
    table.string('chain_id', 32).notNullable().index();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['tx_hash', 'log_index', 'chain_id'], 'raw_events_unique_event');
    table.index(['chain_id', 'block_number']);
    table.comment('Raw event logs for auditing and unknown events');
  });

  // Add indexer metrics table
  await knex.schema.createTable('indexer_metrics', table => {
    table.increments('id').primary();
    table.string('chain_id', 32).notNullable().index();
    table.bigInteger('last_indexed_block').notNullable();
    table.integer('batch_size').notNullable();
    table.integer('events_processed').notNullable();
    table.integer('batch_time_ms').notNullable();
    table.float('memory_usage_mb').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index(['chain_id', 'created_at']);
    table.comment('Indexer performance metrics');
  });
}

async function down(knex) {
  await knex.schema.dropTableIfExists('raw_events');
  await knex.schema.dropTableIfExists('indexer_metrics');
  
  // Remove unique constraints
  const tables = ['xen_burns', 'burn_nfts', 'xburn_claims', 'xburn_burns', 'nft_transfers'];
  for (const table of tables) {
    await knex.schema.alterTable(table, table => {
      table.dropColumn('log_index');
      table.dropUnique(null, `${table}_unique_event`);
    });
  }
}

module.exports = { up, down };
