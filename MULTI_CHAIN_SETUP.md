# Multi-Chain Setup Guide

This guide explains how to run multiple XBURN indexers for different chains on the same server.

## Overview

Each chain runs as an independent Docker Compose stack with:
- Its own PostgreSQL database
- Its own indexer instance
- Unique container names and networks
- Different ports to avoid conflicts

## Setup Instructions

### 1. Base Chain (First Instance)

```bash
# Clone the repository
git clone https://github.com/TreeCityWes/xburn-index-singlechain.git base-indexer
cd base-indexer

# Configure for Base
cp example.env .env
# Edit .env with Base configuration
# Keep POSTGRES_PORT=5432 (default)

# Start the indexer
docker compose up -d
```

### 2. Ethereum Chain (Second Instance)

```bash
# Clone into a new directory
cd ~
git clone https://github.com/TreeCityWes/xburn-index-singlechain.git ethereum-indexer
cd ethereum-indexer

# Configure for Ethereum
cp example.env .env
nano .env
```

Update the following in `.env`:
```env
CHAIN_NAME=ethereum
CHAIN_ID=1
DB_NAME=ethereum_xburn_index
POSTGRES_PORT=5433  # Different port!
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-api-key
XEN_CONTRACT=0x06450dEe7FD2Fb8E39061434BAbCFC05599a6Fb8
XBURN_MINTER_CONTRACT=0x3d5320821bfca19fb0b5428f2c79d63bd5246f89
XBURN_NFT_CONTRACT=0x0a252663DBCc0b073063D6420a40319e438Cfa59
START_BLOCK=20000000
```

```bash
# Start the indexer
docker compose up -d
```

### 3. Optimism Chain (Third Instance)

```bash
# Clone into a new directory
cd ~
git clone https://github.com/TreeCityWes/xburn-index-singlechain.git optimism-indexer
cd optimism-indexer

# Configure for Optimism
cp example.env .env
nano .env
```

Update the following in `.env`:
```env
CHAIN_NAME=optimism
CHAIN_ID=10
DB_NAME=optimism_xburn_index
POSTGRES_PORT=5434  # Different port!
RPC_URL=https://opt-mainnet.g.alchemy.com/v2/your-api-key
XEN_CONTRACT=0xeB585163DEbB1E637c6D617de3bEF99347cd75c8
XBURN_MINTER_CONTRACT=0x3d5320821bfca19fb0b5428f2c79d63bd5246f89
XBURN_NFT_CONTRACT=0x0a252663DBCc0b073063D6420a40319e438Cfa59
START_BLOCK=125000000
```

```bash
# Start the indexer
docker compose up -d
```

## Port Allocation Strategy

| Chain     | PostgreSQL Port | Container Prefix |
|-----------|----------------|------------------|
| Base      | 5432           | base-            |
| Ethereum  | 5433           | ethereum-        |
| Optimism  | 5434           | optimism-        |
| Arbitrum  | 5435           | arbitrum-        |
| Polygon   | 5436           | polygon-         |

## Managing Multiple Instances

### View all running indexers:
```bash
docker ps | grep xburn
```

### Check logs for a specific chain:
```bash
# Base logs
cd ~/base-indexer
docker compose logs -f

# Ethereum logs
cd ~/ethereum-indexer
docker compose logs -f
```

### Stop a specific chain:
```bash
cd ~/base-indexer
docker compose down
```

### Restart a specific chain:
```bash
cd ~/ethereum-indexer
docker compose restart
```

## Connecting to Databases

Each chain has its own PostgreSQL instance accessible on different ports:

```bash
# Connect to Base database
psql -h localhost -p 5432 -U postgres -d base_xburn_index

# Connect to Ethereum database
psql -h localhost -p 5433 -U postgres -d ethereum_xburn_index

# Connect to Optimism database
psql -h localhost -p 5434 -U postgres -d optimism_xburn_index
```

## Setting up Metabase (Optional)

You can run a single Metabase instance to visualize all chains:

```bash
# Run Metabase separately
docker run -d \
  --name metabase \
  -p 3000:3000 \
  -e MB_DB_TYPE=postgres \
  -e MB_DB_DBNAME=metabase_app \
  -e MB_DB_PORT=5432 \
  -e MB_DB_USER=postgres \
  -e MB_DB_PASS=postgres \
  -e MB_DB_HOST=host.docker.internal \
  metabase/metabase:latest
```

Then add each chain's database as a data source in Metabase:
- Base: localhost:5432
- Ethereum: localhost:5433
- Optimism: localhost:5434

## Troubleshooting

### Container name conflicts
If you see "container name already in use" errors, make sure each `.env` file has a unique `CHAIN_NAME`.

### Port conflicts
If you see "port already allocated" errors, make sure each `.env` file has a unique `POSTGRES_PORT`.

### Database connection issues
If the indexer can't connect to the database, check:
1. The database container is running: `docker ps`
2. The database name in `.env` matches what PostgreSQL created
3. The network exists: `docker network ls`

## Resource Requirements

Each chain instance requires approximately:
- 1GB RAM minimum
- 20GB disk space (grows over time)
- 1 CPU core

Plan your server resources accordingly when running multiple chains. 