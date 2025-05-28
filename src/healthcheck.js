const { getDatabase } = require('./database');

async function healthCheck() {
  try {
    const db = await getDatabase();
    
    // Check database connection
    await db.raw('SELECT 1');
    
    // Check indexer state
    const indexerState = await db('indexer_state')
      .where('chain_id', process.env.CHAIN_ID)
      .first();
      
    if (!indexerState) {
      throw new Error('No indexer state found');
    }
    
    // Check if indexer is stalled (no updates in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (new Date(indexerState.last_indexed_at) < fiveMinutesAgo) {
      throw new Error('Indexer appears to be stalled');
    }
    
    // All checks passed
    process.exit(0);
  } catch (error) {
    console.error('Health check failed:', error.message);
    process.exit(1);
  }
}

healthCheck();
