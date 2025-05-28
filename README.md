# XBurn Single-Chain Indexer

A production-grade, Dockerized event indexer for XBurn contracts, designed to run one chain per container with maximum reliability and performance.

## Features

- 🔗 **Single Chain Focus**: One container = one chain for maximum reliability
- 🔄 **Never Miss an Event**: Includes reorg handling and automatic retries
- 🚀 **Production Ready**: Health checks, metrics, and graceful shutdown
- 📊 **Full Audit Trail**: Raw event logging for complete traceability
- ⚡ **Performance Optimized**: Smart batching and caching
- 🔌 **Easy Chain Switching**: Change chains via ENV variables only

## Quick Start

1. Clone the repository
2. Copy `.env.example` to `.env` and configure your environment
3. Run with Docker Compose:

```bash
docker-compose up -d
```

## Configuration

### Environment Variables

```env
# Chain Configuration
CHAIN_ID=8453                  # Chain ID (e.g., 8453 for Base)
CHAIN_NAME=base               # Chain name
START_BLOCK=29190000         # Starting block number
BATCH_SIZE=200               # Number of blocks per batch
RPC_URL=https://...          # Primary RPC endpoint
BACKUP_RPC_URLS=https://... # Comma-separated backup RPCs

# Contract Addresses
XEN_CONTRACT=0x...           # XEN token contract
XBURN_MINTER_CONTRACT=0x...  # XBurn minter contract
XBURN_NFT_CONTRACT=0x...     # XBurn NFT contract

# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=xburn_index
DB_USER=postgres
DB_PASSWORD=postgres

# Indexer Configuration
ENABLE_API=true              # Enable health check API
API_PORT=3000               # API port
LOG_LEVEL=info             # Logging level
```

### Switching Chains

To index a different chain:

1. Update the chain-specific ENV variables
2. Restart the container:

```bash
docker-compose down
docker-compose up -d
```

## Health Checks

The indexer exposes a `/health` endpoint (if enabled) that returns:

```json
{
  "status": "ok",
  "chainId": "8453",
  "chainName": "base",
  "lastIndexedBlock": 29190500,
  "lastIndexedAt": "2025-05-28T04:00:00.000Z",
  "metrics": {
    "batchSize": 200,
    "eventsProcessed": 150,
    "batchTimeMs": 2500,
    "memoryUsageMb": 256
  }
}
```

## Database Schema

The indexer maintains several tables:

- `xen_burns`: XEN token burn events
- `burn_nfts`: NFT mint and lifecycle events
- `xburn_claims`: NFT claim events
- `xburn_burns`: NFT burn events
- `nft_transfers`: NFT transfer events
- `raw_events`: Complete event log for auditing
- `indexer_metrics`: Performance metrics

## Production Deployment

### Docker

Build and run:

```bash
# Build image
docker build -t xburn-indexer .

# Run with environment file
docker run -d --env-file .env --name xburn-indexer xburn-indexer
```

### Kubernetes

Example deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: xburn-indexer-base
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: indexer
        image: xburn-indexer:latest
        envFrom:
        - configMapRef:
            name: xburn-base-config
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
```

## Monitoring

- Use the `/health` endpoint for basic health monitoring
- Check `indexer_metrics` table for detailed performance data
- Monitor `raw_events` table for complete event audit trail

## Development

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Docker and Docker Compose (optional)

### Local Setup

```bash
# Install dependencies
npm install

# Run migrations
npm run migrate

# Start indexer
npm start
```

### Running Tests

```bash
npm test
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT

## Support

For support, please open an issue in the GitHub repository.