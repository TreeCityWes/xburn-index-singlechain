const { ethers } = require('ethers');
const config = require('./config');
const logger = require('./logger');
const { getDatabase } = require('./database');

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
    this.chainId = null;
    this.isRunning = false;
    this.logger = logger;
  }

  // Stats are now calculated via database views
  }
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

    // Initialize database
    this.db = await getDatabase();

    // Initialize provider with failover support
    await this.initializeProvider();

    // Initialize contracts with full ABIs and normalized addresses
    const normalizedNftAddress = ethers.utils.getAddress(config.contracts.xburnNft);
    const normalizedMinterAddress = ethers.utils.getAddress(config.contracts.xburnMinter);
    
    this.contracts = {
      nft: new ethers.Contract(normalizedNftAddress, nftAbi, this.provider),
      minter: new ethers.Contract(normalizedMinterAddress, minterAbi, this.provider)
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
      // Query logs for each contract separately
      const minterLogs = await this.provider.getLogs({
        fromBlock,
        toBlock,
        address: this.contracts.minter.address,
        topics: [
          [
            this.contracts.minter.interface.getEventTopic('BurnNFTMinted'),
            this.contracts.minter.interface.getEventTopic('XBURNBurned'),
            this.contracts.minter.interface.getEventTopic('XENBurned'),
            this.contracts.minter.interface.getEventTopic('XBURNClaimed')
          ]
        ]
      });

      const nftLogs = await this.provider.getLogs({
        fromBlock,
        toBlock,
        address: this.contracts.nft.address,
        topics: [
          [
            this.contracts.nft.interface.getEventTopic('Transfer'),
            this.contracts.nft.interface.getEventTopic('BurnLockCreated')
          ]
        ]
      });

      // Combine logs from both contracts
      const logs = [...minterLogs, ...nftLogs];

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
        switch (parsed.name) {
          case 'BurnNFTMinted':
            await this.processNftMint(parsed, event, timestamp, trx);
            break;
          case 'XBURNBurned':
            await this.processXburnBurned(parsed, event, timestamp, trx);
            break;
          case 'XENBurned':
            await this.processXenBurned(parsed, event, timestamp, trx);
            break;
          case 'XBURNClaimed':
            await this.processNftClaim(parsed, event, timestamp, trx);
            break;
        }
      } else if (event.address.toLowerCase() === this.contracts.nft.address.toLowerCase()) {
        parsed = this.contracts.nft.interface.parseLog(event);
        eventType = parsed.name;
        switch (parsed.name) {
          case 'Transfer':
            await this.processNftTransfer(parsed, event, timestamp, trx);
            break;
          case 'BurnLockCreated':
            await this.processBurnLockCreated(parsed, event, timestamp, trx);
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
  async processXenBurned(parsed, event, timestamp, trx) {
    const { user, amount } = parsed.args;
    const accumulatedAmount = amount.mul(20).div(100); // 20% for accumulation
    const directBurnAmount = amount.sub(accumulatedAmount); // 80% direct burn
    
    await trx('xen_burns').insert({
      log_index: event.logIndex,
      tx_hash: event.transactionHash,
      block_number: event.blockNumber,
      timestamp: new Date(timestamp * 1000),
      user: user.toLowerCase(),
      amount: amount.toString(),
      accumulated_amount: accumulatedAmount.toString(),
      direct_burn_amount: directBurnAmount.toString(),
      chain_id: config.chain.id
    }).onConflict(['tx_hash', 'log_index', 'chain_id']).ignore();

    // Update wallet stats
    await this._updateWalletStats(user.toLowerCase(), {
      total_xen_burned: amount.toString()
    });
  },

  async processNftClaim(parsed, event, timestamp, trx) {
    const { tokenId, baseAmount, bonusAmount, totalAmount } = parsed.args;
    
    // Get NFT info first
    const nft = await trx('burn_nfts')
      .where({ token_id: tokenId.toString(), chain_id: config.chain.id })
      .first();
    
    if (!nft) {
      this.logger.warn(`NFT ${tokenId.toString()} not found for claim event`);
      return;
    }

    // Update burn_nfts table
    await trx('burn_nfts')
      .where({ token_id: tokenId.toString(), chain_id: config.chain.id })
      .update({
        claimed: true,
        claimed_at: new Date(timestamp * 1000),
        claim_tx_hash: event.transactionHash
      });

    // Insert claim record
    await trx('xburn_claims').insert({
      tx_hash: event.transactionHash,
      block_number: event.blockNumber,
      log_index: event.logIndex,
      timestamp: new Date(timestamp * 1000),
      user_address: event.from.toLowerCase(),
      token_id: tokenId.toString(),
      base_amount: baseAmount.toString(),
      bonus_amount: bonusAmount.toString(),
      total_amount: totalAmount.toString(),
      chain_id: config.chain.id
    }).onConflict(['tx_hash', 'log_index', 'chain_id']).ignore();

    // Update wallet stats
    await this._updateWalletStats(event.from.toLowerCase(), {
      active_locks: -1,
      completed_locks: 1,
      total_xburn_claimed: totalAmount.toString()
    });

    // Update term stats
    await this._updateTermStats(nft.term_days, {
      active_locks: -1
    });
  },

  async processNftBurn(parsed, event, timestamp, trx) {
    const { tokenId } = parsed.args;
    
    // Get NFT info first
    const nft = await trx('burn_nfts')
      .where({ token_id: tokenId.toString(), chain_id: config.chain.id })
      .first();
    
    if (!nft) {
      this.logger.warn(`NFT ${tokenId.toString()} not found for burn event`);
      return;
    }

    const burnTime = new Date(timestamp * 1000);
    const earlyBurn = burnTime < nft.maturity_timestamp;

    await trx('burn_nfts')
      .where({ token_id: tokenId.toString(), chain_id: config.chain.id })
      .update({
        burned: true,
        burned_at: burnTime,
        burn_tx_hash: event.transactionHash,
        early_burn: earlyBurn
      });

    // Update wallet stats
    await this._updateWalletStats(nft.user, {
      active_locks: -1,
      early_unlocks: earlyBurn ? 1 : 0
    });

    // Update term stats
    await this._updateTermStats(nft.term_days, {
      active_locks: -1
    });
  },

  async processNftTransfer(parsed, event, timestamp, trx) {
    const { from, to, tokenId } = parsed.args;
    
    await trx('nft_transfers').insert({
      tx_hash: event.transactionHash,
      block_number: event.blockNumber,
      log_index: event.logIndex,
      timestamp: new Date(timestamp * 1000),
      token_id: tokenId.toString(),
      from_address: from.toLowerCase(),
      to_address: to.toLowerCase(),
      chain_id: config.chain.id
    }).onConflict(['tx_hash', 'log_index', 'chain_id']).ignore();

    // Get NFT info first
    const nft = await trx('burn_nfts')
      .where({ token_id: tokenId.toString(), chain_id: config.chain.id })
      .first();
    
    if (!nft || nft.burned || nft.claimed) return;

    // Update owner in burn_nfts if not burned/claimed
    await trx('burn_nfts')
      .where({
        token_id: tokenId.toString(),
        chain_id: config.chain.id,
        burned: false,
        claimed: false
      })
      .update({ user: to.toLowerCase() });

    // Update wallet stats for both parties
    await Promise.all([
      this._updateWalletStats(from.toLowerCase(), {
        active_locks: -1
      }),
      this._updateWalletStats(to.toLowerCase(), {
        active_locks: 1
      })
    ]);
  },

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

module.exports = { XBurnIndexer };
