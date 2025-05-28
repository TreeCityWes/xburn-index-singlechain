const { ethers } = require('ethers');
const config = require('./config');
const logger = require('./logger');
const { getDatabase } = require('./database');
const { schema, createSchema } = require('./schema');

// Load contract ABIs
const minterAbi = require('../abis/XBurnMinter.json');
const nftAbi = require('../abis/XBurnNFT.json');

// Cache for block timestamps
const blockTimestampCache = new Map();
const REORG_BUFFER_BLOCKS = 10;
const MAX_RETRIES = 5;
const INITIAL_BATCH_SIZE = config.chain.batchSize;

class XBurnIndexer {
  constructor() {
    this.provider = null;
    this.db = null;
    this.contracts = {};
    this.isRunning = false;
    this.currentProvider = 0;
    this.batchSize = INITIAL_BATCH_SIZE;
    this.retryCount = 0;
    this.blockTimestamps = new Map();
  }

  async initialize() {
    logger.info('Initializing XBurn Indexer', {
      chain: config.chain.name,
      chainId: config.chain.id,
      startBlock: config.chain.startBlock,
      batchSize: this.batchSize
    });

    // Initialize database and run migrations
    this.db = await getDatabase();
    await createSchema(this.db);

    // Initialize provider with failover support
    await this.initializeProvider();

    // Initialize contracts with full ABIs
    this.contracts = {
      nft: new ethers.Contract(config.contracts.xburnNft, nftAbi, this.provider),
      minter: new ethers.Contract(config.contracts.xburnMinter, minterAbi, this.provider)
    };

    // Validate contracts
    await Promise.all(Object.values(this.contracts).map(async (contract) => {
      try {
        await contract.provider.getCode(contract.address);
      } catch (error) {
        throw new Error(`Contract validation failed at ${contract.address}: ${error.message}`);
      }
    }));
  }

  async initializeProvider() {
    const allRpcs = [config.chain.rpcUrl, ...config.chain.backupRpcUrls];
    this.provider = new ethers.providers.JsonRpcProvider(allRpcs[this.currentProvider]);
    try {
      await this.provider.getNetwork();
      logger.info('Connected to RPC provider', { url: allRpcs[this.currentProvider] });
    } catch (error) {
      logger.error('Failed to connect to RPC provider', { error: error.message });
      this.currentProvider = (this.currentProvider + 1) % allRpcs.length;
      if (this.currentProvider !== 0) {
        return this.initializeProvider();
      }
      throw new Error('All RPC providers failed');
    }
  }

  async getLastIndexedBlock() {
    const state = await this.db('indexer_state')
      .where('chain_id', config.chain.id)
      .first();
    return state ? state.last_indexed_block : config.chain.startBlock;
  }

  async updateLastIndexedBlock(blockNumber) {
    await this.db('indexer_state')
      .insert({
        chain_id: config.chain.id,
        last_indexed_block: blockNumber,
        last_indexed_at: new Date(),
        batch_size: this.batchSize,
        retry_count: this.retryCount
      })
      .onConflict('chain_id')
      .merge(['last_indexed_block', 'last_indexed_at', 'batch_size', 'retry_count']);
  }

  async switchProvider() {
    this.currentProvider = (this.currentProvider + 1) % (config.chain.backupRpcUrls.length + 1);
    logger.info('Switching to backup RPC provider', { providerIndex: this.currentProvider });
    await this.initializeProvider();
  }

  async indexBlocks(fromBlock, toBlock) {
    logger.info('Indexing blocks', { fromBlock, toBlock, batchSize: this.batchSize, retryCount: this.retryCount });

    const startTime = Date.now();
    let eventsProcessed = 0;

    try {
      // Get logs for XBurn contracts only
      const logs = await this.provider.getLogs({
        fromBlock,
        toBlock,
        address: [
          this.contracts.minter.address,
          this.contracts.nft.address
        ],
        topics: [
          [
            this.contracts.minter.interface.getEventTopic('XBURNBurned'),
            this.contracts.minter.interface.getEventTopic('XENBurned'),
            this.contracts.nft.interface.getEventTopic('BurnMinted'),
            this.contracts.nft.interface.getEventTopic('BurnClaimed'),
            this.contracts.nft.interface.getEventTopic('BurnBurned'),
            this.contracts.nft.interface.getEventTopic('Transfer')
          ]
        ]
      });

      if (logs.length > 0) {
        // Cache block timestamps for all blocks with events
        const blockNumbers = [...new Set(logs.map(log => log.blockNumber))];
        await this.cacheBlockTimestamps(blockNumbers);

        // Process events in a transaction
        await this.db.transaction(async (trx) => {
          for (const log of logs) {
            await this.processEvent(log, trx);
            eventsProcessed++;
          }

          // Log metrics every batch
          const batchTimeMs = Date.now() - startTime;
          await this.logMetrics(fromBlock, toBlock, eventsProcessed, batchTimeMs, trx);
        });
      }

      // Update indexer state
      await this.updateLastIndexedBlock(toBlock);

      // Reset retry count and gradually increase batch size on success
      this.retryCount = 0;
      if (this.batchSize < INITIAL_BATCH_SIZE) {
        this.batchSize = Math.min(this.batchSize * 1.5, INITIAL_BATCH_SIZE);
      }
    } catch (error) {
      this.retryCount++;
      logger.error('Error indexing blocks', {
        error: error.message,
        fromBlock,
        toBlock,
        retryCount: this.retryCount
      });

      if (this.retryCount < MAX_RETRIES) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
        throw error;
      } else {
        logger.error('Max retries exceeded, skipping batch', {
          fromBlock,
          toBlock,
          error: error.message
        });
        // Reset retry count but keep reduced batch size
        this.retryCount = 0;
      }
    }
  }

  async cacheBlockTimestamps(blockNumbers) {
    const uncachedBlocks = blockNumbers.filter(bn => !this.blockTimestamps.has(bn));
    if (uncachedBlocks.length === 0) return;
    const blocks = await Promise.all(
      uncachedBlocks.map(bn => this.provider.getBlock(bn))
    );
    blocks.forEach(block => {
      this.blockTimestamps.set(block.number, block.timestamp);
    });
  }

  async logRawEvent(event, trx) {
    await trx('raw_events').insert({
      chain_id: config.chain.id,
      block_number: event.blockNumber,
      tx_hash: event.transactionHash,
      log_index: event.logIndex,
      address: event.address,
      event_type: event.eventType || 'unknown',
      data: JSON.stringify(event)
    })
    .onConflict(['tx_hash', 'log_index', 'chain_id'])
    .ignore();
  }

  async logMetrics(fromBlock, toBlock, eventsProcessed, batchTimeMs, trx) {
    const memoryUsage = process.memoryUsage();
    await trx('indexer_metrics').insert({
      chain_id: config.chain.id,
      block_number: toBlock,
      last_indexed_block: toBlock,
      timestamp: new Date(),
      batch_size: toBlock - fromBlock + 1,
      events_processed: eventsProcessed,
      batch_time_ms: batchTimeMs,
      memory_usage_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024)
    });
  }

  async processEvent(event, trx) {
    const timestamp = this.blockTimestamps.get(event.blockNumber);
    if (!timestamp) {
      throw new Error(`No timestamp found for block ${event.blockNumber}`);
    }

    let parsed;
    let eventType = 'unknown';
    try {
      // Log raw event with "unknown" type initially
      await this.logRawEvent({ ...event, eventType }, trx);

      if (event.address.toLowerCase() === this.contracts.minter.address.toLowerCase()) {
        parsed = this.contracts.minter.interface.parseLog(event);
        eventType = parsed.name;
        if (parsed.name === 'XBURNBurned') {
          await this.processXburnBurned(parsed, event, timestamp, trx);
        } else if (parsed.name === 'XENBurned') {
          await this.processXenBurned(parsed, event, timestamp, trx);
        }
      } else if (event.address.toLowerCase() === this.contracts.nft.address.toLowerCase()) {
        parsed = this.contracts.nft.interface.parseLog(event);
        eventType = parsed.name;
        switch (parsed.name) {
          case 'BurnMinted':
            await this.processNftMint(parsed, event, timestamp, trx);
            break;
          case 'BurnClaimed':
            await this.processNftClaim(parsed, event, timestamp, trx);
            break;
          case 'BurnBurned':
            await this.processNftBurn(parsed, event, timestamp, trx);
            break;
          case 'Transfer':
            await this.processNftTransfer(parsed, event, timestamp, trx);
            break;
        }
      }

      // Update raw event with the correct event type
      if (eventType !== 'unknown') {
        await trx('raw_events')
          .where({
            chain_id: config.chain.id,
            tx_hash: event.transactionHash,
            log_index: event.logIndex
          })
          .update({ event_type: eventType });
      }
    } catch (err) {
      logger.error('Event processing error', {
        error: err.message,
        address: event.address,
        blockNumber: event.blockNumber,
        tx: event.transactionHash
      });
    }
  }

  // XBURNBurned event (from XBurnMinter)
  async processXburnBurned(parsed, event, timestamp, trx) {
    await trx('xburn_burns').insert({
      log_index: event.logIndex,
      tx_hash: event.transactionHash,
      block_number: event.blockNumber,
      timestamp: new Date(timestamp * 1000),
      user_address: parsed.args.user,
      amount: parsed.args.amount.toString(),
      chain_id: config.chain.id
    });
  }

  // XENBurned event (if needed, or remove if not in ABI)
  async processXenBurned(parsed, event, timestamp, trx) {
    // Implement if you want to track this event. Otherwise, remove this handler and event from topics.
  }

  // BurnMinted event
  async processNftMint(parsed, event, timestamp, trx) {
    await trx('burn_nfts').insert({
      log_index: event.logIndex,
      token_id: parsed.args.tokenId.toString(),
      tx_hash: event.transactionHash,
      block_number: event.blockNumber,
      timestamp: new Date(timestamp * 1000),
      user: parsed.args.user,
      xen_amount: parsed.args.xenAmount.toString(),
      term: parsed.args.term.toString(),
      chain_id: config.chain.id
    });
  }

  // BurnClaimed event
  async processNftClaim(parsed, event, timestamp, trx) {
    await trx('xburn_claims').insert({
      log_index: event.logIndex,
      tx_hash: event.transactionHash,
      block_number: event.blockNumber,
      timestamp: new Date(timestamp * 1000),
      user_address: parsed.args.user,
      token_id: parsed.args.tokenId.toString(),
      base_amount: parsed.args.baseReward.toString(),
      bonus_amount: parsed.args.bonus.toString(),
      total_amount: parsed.args.baseReward.add(parsed.args.bonus).toString(),
      chain_id: config.chain.id
    });
    await trx('burn_nfts')
      .where({ token_id: parsed.args.tokenId.toString(), chain_id: config.chain.id })
      .update({
        claimed: true,
        claimed_at: new Date(timestamp * 1000),
        claim_tx_hash: event.transactionHash
      });
  }

  // BurnBurned event
  async processNftBurn(parsed, event, timestamp, trx) {
    await trx('burn_nfts')
      .where({ token_id: parsed.args.tokenId.toString(), chain_id: config.chain.id })
      .update({
        burned: true,
        burned_at: new Date(timestamp * 1000),
        burn_tx_hash: event.transactionHash
      });
  }

  // Transfer event
  async processNftTransfer(parsed, event, timestamp, trx) {
    await trx('nft_transfers').insert({
      log_index: event.logIndex,
      tx_hash: event.transactionHash,
      block_number: event.blockNumber,
      timestamp: new Date(timestamp * 1000),
      token_id: parsed.args.tokenId.toString(),
      from_address: parsed.args.from,
      to_address: parsed.args.to,
      chain_id: config.chain.id
    });
    // Update NFT ownership if not a mint or burn
    if (
      parsed.args.from !== ethers.constants.AddressZero &&
      parsed.args.to !== ethers.constants.AddressZero
    ) {
      await trx('burn_nfts')
        .where({ token_id: parsed.args.tokenId.toString(), chain_id: config.chain.id })
        .update({ user: parsed.args.to });
    }
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      while (this.isRunning) {
        const lastIndexed = await this.getLastIndexedBlock();
        const currentBlock = await this.provider.getBlockNumber();

        if (lastIndexed < currentBlock) {
          // Consider reorg buffer when determining start block
          const startBlock = Math.max(
            lastIndexed + 1 - REORG_BUFFER_BLOCKS,
            config.chain.startBlock
          );

          const toBlock = Math.min(
            startBlock + this.batchSize - 1,
            currentBlock
          );

          await this.indexBlocks(startBlock, toBlock);

          // Log progress periodically
          if (toBlock % 1000 === 0) {
            logger.info('Indexing progress', {
              currentBlock: toBlock,
              totalBlocks: currentBlock - config.chain.startBlock,
              percentComplete: ((toBlock - config.chain.startBlock) / (currentBlock - config.chain.startBlock) * 100).toFixed(2)
            });
          }
        } else {
          // Wait for new blocks
          await new Promise(resolve => setTimeout(resolve, config.indexer.interval));

          // Clear old timestamps from cache periodically
          const oldestRelevantBlock = currentBlock - 1000;
          for (const [blockNum] of this.blockTimestamps) {
            if (blockNum < oldestRelevantBlock) {
              this.blockTimestamps.delete(blockNum);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Fatal indexer error', { error: error.message });
      this.isRunning = false;
      throw error;
    }
  }

  async stop() {
    this.isRunning = false;
  }
}

// Start indexer
async function main() {
  const indexer = new XBurnIndexer();
  try {
    await indexer.initialize();
    await indexer.start();
  } catch (error) {
    logger.error('Fatal error', { error: error.message });
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

// Start the indexer
if (require.main === module) {
  main();
}
