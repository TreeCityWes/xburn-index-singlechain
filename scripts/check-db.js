const knex = require('knex');
require('dotenv').config();

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'xburn_index',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  }
});

async function checkDatabase() {
  try {
    console.log('Checking database contents...\n');

    // Check indexer state
    const state = await db('indexer_state').first();
    console.log('Indexer State:', state);

    // Check table counts
    const tables = [
      'raw_events',
      'xen_burns', 
      'xburn_burns',
      'burn_nfts',
      'xburn_claims',
      'nft_transfers',
      'indexer_metrics'
    ];

    for (const table of tables) {
      const count = await db(table).count('* as count');
      console.log(`${table}: ${count[0].count} records`);
    }

    // Show recent events
    const recentEvents = await db('raw_events')
      .orderBy('block_number', 'desc')
      .limit(5);
    
    if (recentEvents.length > 0) {
      console.log('\nRecent events:');
      recentEvents.forEach(event => {
        console.log(`- Block ${event.block_number}: ${event.event_type} at ${event.address}`);
      });
    }

    // Show recent burns
    const recentBurns = await db('burn_nfts')
      .orderBy('block_number', 'desc')
      .limit(5);
    
    if (recentBurns.length > 0) {
      console.log('\nRecent NFT burns:');
      recentBurns.forEach(burn => {
        console.log(`- Token #${burn.token_id}: ${burn.xen_amount} XEN, ${burn.term} days`);
      });
    }

  } catch (error) {
    console.error('Error checking database:', error);
  } finally {
    await db.destroy();
  }
}

checkDatabase(); 