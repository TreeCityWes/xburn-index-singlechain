# Running Multiple Chain Instances

This guide explains how to run multiple XBURN indexer instances for different chains.

## Setup Steps

### 1. Create separate directories for each chain

```bash
# Create directories
mkdir xburn-index-base
mkdir xburn-index-optimism
mkdir xburn-index-ethereum

# Copy the indexer to each directory
cp -r . xburn-index-base/
cp -r . xburn-index-optimism/
cp -r . xburn-index-ethereum/
```

### 2. Configure each instance

For each chain directory, create a `.env` file with the appropriate configuration:

#### Base (.env in xburn-index-base/)
```env
CHAIN_NAME=base
CHAIN_ID=8453
DB_NAME=base_xburn_index
START_BLOCK=29190000
RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
XEN_CONTRACT=0xffcbF84650cE02DaFE96926B37a0ac5E34932fa5
XBURN_MINTER_CONTRACT=0xe89AFDeFeBDba033f6e750615f0A0f1A37C78c4A
XBURN_NFT_CONTRACT=0x305c60d2fef49fadfee67ec530de98f67bac861d
```

#### Optimism (.env in xburn-index-optimism/)
```env
CHAIN_NAME=optimism
CHAIN_ID=10
DB_NAME=optimism_xburn_index
START_BLOCK=0  # Update with actual deployment block
RPC_URL=https://opt-mainnet.g.alchemy.com/v2/YOUR_API_KEY
XEN_CONTRACT=0x...  # Add actual addresses
XBURN_MINTER_CONTRACT=0x...
XBURN_NFT_CONTRACT=0x...
```

#### Ethereum (.env in xburn-index-ethereum/)
```env
CHAIN_NAME=ethereum
CHAIN_ID=1
DB_NAME=ethereum_xburn_index
START_BLOCK=0  # Update with actual deployment block
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
XEN_CONTRACT=0x06450dEe7FD2Fb8E39061434BAbCFC05599a6Fb8
XBURN_MINTER_CONTRACT=0x...  # Add actual addresses
XBURN_NFT_CONTRACT=0x...
```

### 3. Update ports in docker-compose.yml for each instance

Edit the `docker-compose.yml` in each directory to use different ports:

#### Base (default ports)
- PostgreSQL: 5432
- Metabase: 3001

#### Optimism
```yaml
ports:
  - "5433:5432"  # PostgreSQL
  - "3002:3000"  # Metabase
```

#### Ethereum
```yaml
ports:
  - "5434:5432"  # PostgreSQL
  - "3003:3000"  # Metabase
```

### 4. Start each instance

```bash
# Start Base indexer
cd xburn-index-base
docker-compose up -d

# Start Optimism indexer
cd ../xburn-index-optimism
docker-compose up -d

# Start Ethereum indexer
cd ../xburn-index-ethereum
docker-compose up -d
```

## Container Names

With the CHAIN_NAME environment variable, containers will be named:
- `base-xburn-postgres`, `base-xburn-indexer`, `base-xburn-metabase`
- `optimism-xburn-postgres`, `optimism-xburn-indexer`, `optimism-xburn-metabase`
- `ethereum-xburn-postgres`, `ethereum-xburn-indexer`, `ethereum-xburn-metabase`

## Monitoring

Check the status of all containers:
```bash
docker ps | grep xburn
```

View logs for a specific chain:
```bash
docker logs base-xburn-indexer -f
docker logs optimism-xburn-indexer -f
docker logs ethereum-xburn-indexer -f
```

## Access Points

- Base Metabase: http://localhost:3001
- Optimism Metabase: http://localhost:3002
- Ethereum Metabase: http://localhost:3003

## Database Access

Each chain has its own database:
- Base: `base_xburn_index`
- Optimism: `optimism_xburn_index`
- Ethereum: `ethereum_xburn_index`

Connect to a specific database:
```bash
docker exec base-xburn-postgres psql -U postgres -d base_xburn_index
docker exec optimism-xburn-postgres psql -U postgres -d optimism_xburn_index
docker exec ethereum-xburn-postgres psql -U postgres -d ethereum_xburn_index
```

## Stopping Services

Stop a specific chain:
```bash
cd xburn-index-base
docker-compose down

# Or stop containers by name
docker stop base-xburn-indexer base-xburn-postgres base-xburn-metabase
```

## Tips

1. Make sure each instance uses different ports to avoid conflicts
2. Use descriptive CHAIN_NAME values for easy identification
3. Monitor disk space as each instance maintains its own database
4. Consider using a shared RPC endpoint with rate limiting across instances 