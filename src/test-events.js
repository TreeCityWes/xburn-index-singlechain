const { ethers } = require('ethers');
require('dotenv').config();

async function testContracts() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  
  console.log('Testing XBurn contracts on Base chain...\n');
  
  // Contract addresses
  const contracts = {
    xen: process.env.XEN_CONTRACT,
    minter: process.env.XBURN_MINTER_CONTRACT,
    nft: process.env.XBURN_NFT_CONTRACT
  };
  
  // Check if contracts exist
  for (const [name, address] of Object.entries(contracts)) {
    try {
      const code = await provider.getCode(address);
      console.log(`${name.toUpperCase()} contract at ${address}: ${code.length > 2 ? '✓ EXISTS' : '✗ NOT FOUND'}`);
    } catch (error) {
      console.log(`${name.toUpperCase()} contract at ${address}: ✗ ERROR - ${error.message}`);
    }
  }
  
  console.log('\nChecking for recent events...');
  
  // Get current block
  const currentBlock = await provider.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);
  
  // Check last 10000 blocks for any events
  const fromBlock = currentBlock - 10000;
  const toBlock = currentBlock;
  
  try {
    // Check for any events from the minter contract
    const minterLogs = await provider.getLogs({
      fromBlock,
      toBlock,
      address: contracts.minter
    });
    
    console.log(`\nMinter contract events in last 10k blocks: ${minterLogs.length}`);
    
    // Check for any events from the NFT contract
    const nftLogs = await provider.getLogs({
      fromBlock,
      toBlock,
      address: contracts.nft
    });
    
    console.log(`NFT contract events in last 10k blocks: ${nftLogs.length}`);
    
    // Show sample events
    if (minterLogs.length > 0) {
      console.log('\nSample minter events:');
      minterLogs.slice(0, 3).forEach(log => {
        console.log(`- Block ${log.blockNumber}, Tx: ${log.transactionHash.slice(0, 10)}...`);
      });
    }
    
    if (nftLogs.length > 0) {
      console.log('\nSample NFT events:');
      nftLogs.slice(0, 3).forEach(log => {
        console.log(`- Block ${log.blockNumber}, Tx: ${log.transactionHash.slice(0, 10)}...`);
      });
    }
    
  } catch (error) {
    console.error('Error checking events:', error.message);
  }
}

testContracts().catch(console.error); 