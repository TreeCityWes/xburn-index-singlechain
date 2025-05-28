const { ethers } = require('ethers');

class EventIndexer {
  constructor({ contractAddress, contractABI, provider, pool, logger, startBlock, contractName }) {
    this.contractAddress = contractAddress;
    this.contractABI = contractABI;
    this.provider = provider;
    this.pool = pool;
    this.logger = logger;
    this.startBlock = startBlock;
    this.contractName = contractName;
    this.contract = new ethers.Contract(contractAddress, contractABI, provider);
    this.batchSize = 500; // Alchemy limit is 500 blocks per request
    this.eventHandlers = this.setupEventHandlers();
  }

  setupEventHandlers() {
    const handlers = {};
    
    // XBurnMinter events
    handlers['XENBurned'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO xen_burns (transaction_hash, block_number, block_timestamp, log_index, user_address, amount)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.user.toLowerCase(), event.amount.toString()]
      );
    };

    handlers['BurnNFTMinted'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO burn_nft_minted (transaction_hash, block_number, block_timestamp, log_index, user_address, token_id, xen_amount, term_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.user.toLowerCase(), event.tokenId.toString(), event.xenAmount.toString(), Number(event.termDays)]
      );
    };

    handlers['XBURNClaimed'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO xburn_claimed (transaction_hash, block_number, block_timestamp, log_index, user_address, base_amount, bonus_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.user.toLowerCase(), event.baseAmount.toString(), event.bonusAmount.toString()]
      );
    };

    handlers['EmergencyEnd'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO emergency_ends (transaction_hash, block_number, block_timestamp, log_index, user_address, base_amount)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.user.toLowerCase(), event.baseAmount.toString()]
      );
    };

    handlers['XBURNBurned'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO xburn_burned (transaction_hash, block_number, block_timestamp, log_index, user_address, amount)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.user.toLowerCase(), event.amount.toString()]
      );
    };

    handlers['LiquidityInitialized'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO liquidity_initialized (transaction_hash, block_number, block_timestamp, log_index, amount_xburn, amount_xen, liquidity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.amountXBURN.toString(), event.amountXEN.toString(), event.liquidity.toString()]
      );
    };

    // XBurnNFT events
    handlers['BurnLockCreated'] = async (event, log) => {
      const maturityTimestamp = new Date(Number(event.maturityTimestamp) * 1000);
      await this.pool.query(
        `INSERT INTO burn_lock_created (transaction_hash, block_number, block_timestamp, log_index, token_id, user_address, amount, term_days, maturity_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.tokenId.toString(), event.user.toLowerCase(), event.amount.toString(), Number(event.termDays), maturityTimestamp]
      );
    };

    handlers['LockClaimed'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO lock_claimed (transaction_hash, block_number, block_timestamp, log_index, token_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.tokenId.toString()]
      );
    };

    handlers['LockBurned'] = async (event, log) => {
      await this.pool.query(
        `INSERT INTO lock_burned (transaction_hash, block_number, block_timestamp, log_index, token_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
        [log.transactionHash, log.blockNumber, new Date(event.blockTimestamp * 1000), log.index, event.tokenId.toString()]
      );
    };

    return handlers;
  }

  async getLastSyncedBlock() {
    const result = await this.pool.query(
      'SELECT last_block_number FROM sync_state WHERE contract_address = $1',
      [this.contractAddress]
    );
    
    if (result.rows.length > 0) {
      const lastBlock = parseInt(result.rows[0].last_block_number);
      // Ensure we don't have an invalid block number
      if (lastBlock > 0 && lastBlock < Number.MAX_SAFE_INTEGER) {
        return lastBlock;
      }
    }
    
    // Initialize sync state with the start block
    await this.pool.query(
      'INSERT INTO sync_state (contract_address, last_block_number) VALUES ($1, $2) ON CONFLICT (contract_address) DO UPDATE SET last_block_number = $2',
      [this.contractAddress, this.startBlock]
    );
    
    return this.startBlock;
  }

  async updateSyncState(blockNumber) {
    await this.pool.query(
      'UPDATE sync_state SET last_block_number = $1, updated_at = NOW() WHERE contract_address = $2',
      [blockNumber, this.contractAddress]
    );
  }

  async processEvents(fromBlock, toBlock) {
    this.logger.info(`${this.contractName}: Processing blocks ${fromBlock} to ${toBlock}`);
    
    // Get all events in the block range
    const filter = {
      address: this.contractAddress,
      fromBlock,
      toBlock
    };
    
    const logs = await this.provider.getLogs(filter);
    this.logger.info(`${this.contractName}: Found ${logs.length} events`);
    
    // Get block timestamps
    const blockNumbers = [...new Set(logs.map(log => log.blockNumber))];
    const blockTimestamps = {};
    
    for (const blockNumber of blockNumbers) {
      const block = await this.provider.getBlock(blockNumber);
      blockTimestamps[blockNumber] = block.timestamp;
    }
    
    // Process each log
    for (const log of logs) {
      try {
        const parsedLog = this.contract.interface.parseLog(log);
        if (!parsedLog) continue;
        
        const eventName = parsedLog.name;
        const handler = this.eventHandlers[eventName];
        
        if (handler) {
          // Create event data object with proper field names
          const eventData = {};
          
          // Map the parsed args to expected field names
          if (eventName === 'XENBurned' || eventName === 'XBURNBurned') {
            eventData.user = parsedLog.args[0]; // user address
            eventData.amount = parsedLog.args[1]; // amount
          } else if (eventName === 'BurnNFTMinted') {
            eventData.user = parsedLog.args[0]; // user address
            eventData.tokenId = parsedLog.args[1]; // token ID
            eventData.xenAmount = parsedLog.args[2]; // XEN amount
            eventData.termDays = parsedLog.args[3]; // term days
          } else if (eventName === 'XBURNClaimed') {
            eventData.user = parsedLog.args[0]; // user address
            eventData.baseAmount = parsedLog.args[1]; // base amount
            eventData.bonusAmount = parsedLog.args[2]; // bonus amount
          } else if (eventName === 'EmergencyEnd') {
            eventData.user = parsedLog.args[0]; // user address
            eventData.baseAmount = parsedLog.args[1]; // base amount
          } else if (eventName === 'LiquidityInitialized') {
            eventData.amountXBURN = parsedLog.args[0]; // XBURN amount
            eventData.amountXEN = parsedLog.args[1]; // XEN amount
            eventData.liquidity = parsedLog.args[2]; // liquidity
          } else if (eventName === 'BurnLockCreated') {
            eventData.tokenId = parsedLog.args[0]; // token ID
            eventData.user = parsedLog.args[1]; // user address
            eventData.amount = parsedLog.args[2]; // amount
            eventData.termDays = parsedLog.args[3]; // term days
            eventData.maturityTimestamp = parsedLog.args[4]; // maturity timestamp
          } else if (eventName === 'LockClaimed' || eventName === 'LockBurned') {
            eventData.tokenId = parsedLog.args[0]; // token ID
          } else {
            // For any other events, copy all args
            Object.assign(eventData, parsedLog.args);
          }
          
          eventData.blockTimestamp = blockTimestamps[log.blockNumber];
          
          await handler(eventData, log);
          this.logger.info(`${this.contractName}: Processed ${eventName} event`);
        }
      } catch (error) {
        this.logger.error(`${this.contractName}: Error processing log:`, error);
        this.logger.error(`Log details:`, JSON.stringify(log));
      }
    }
    
    // Update sync state
    await this.updateSyncState(toBlock);
  }

  async start() {
    this.logger.info(`${this.contractName}: Starting indexer for ${this.contractAddress}`);
    
    while (true) {
      try {
        const lastSyncedBlock = await this.getLastSyncedBlock();
        const currentBlock = await this.provider.getBlockNumber();
        
        if (lastSyncedBlock >= currentBlock) {
          // Wait for new blocks
          await new Promise(resolve => setTimeout(resolve, 12000)); // 12 seconds
          continue;
        }
        
        // Process in batches
        const fromBlock = lastSyncedBlock + 1;
        const toBlock = Math.min(fromBlock + this.batchSize - 1, currentBlock);
        
        await this.processEvents(fromBlock, toBlock);
        
      } catch (error) {
        this.logger.error(`${this.contractName}: Error in indexing loop:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
      }
    }
  }
}

module.exports = EventIndexer; 