# XBURN Protocol Indexer

A one-shot Docker setup for indexing XBURN smart contract events with Metabase analytics.

## Features

- **Real-time Event Indexing**: Indexes all XBURN protocol events from both XBurnMinter and XBurnNFT contracts
- **SQL Views for Analytics**: Pre-configured views for common queries like "total XEN burned", "top burners", etc.
- **Metabase Integration**: Visual analytics dashboard for exploring the data
- **Docker Compose Setup**: One command to run everything
- **Multi-Chain Support**: Run multiple instances for different chains with unique container names

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd xburn-index-singlechain
   ```

2. **Configure environment variables**
   
   The `.env` file is already configured for Base mainnet. If you need to index a different chain, update the values accordingly.

3. **Start the services**
   ```bash
   docker-compose up -d
   ```

4. **Access Metabase**
   - Open http://localhost:3001 in your browser
   - Follow the setup guide in `metabase-setup.md`

## Running Multiple Chains

To run indexers for multiple chains simultaneously:

1. Set the `CHAIN_NAME` and `DB_NAME` environment variables in your `.env` file
2. Each instance will have containers named: `{CHAIN_NAME}-xburn-postgres`, `{CHAIN_NAME}-xburn-indexer`, `{CHAIN_NAME}-xburn-metabase`
3. Make sure to use different ports for each instance

See `MULTI_CHAIN_SETUP.md` for detailed instructions on running multiple chain instances.

## Architecture

The system consists of three main components:

1. **PostgreSQL Database**: Stores all indexed events and provides SQL views for analytics
2. **Node.js Indexer**: Continuously syncs blockchain events to the database
3. **Metabase**: Provides a web interface for data visualization and analytics

## Available Analytics Views

- `total_xen_burned`: Total XEN burned, unique burners, and burn count
- `top_xen_burners`: Top burners ranked by total amount
- `daily_burn_activity`: Daily burn statistics
- `emergency_ends_summary`: Emergency end stake statistics
- `active_burn_locks`: Currently active (unclaimed) locks
- `matured_burn_locks`: Locks that have reached maturity
- `claimed_vs_unclaimed_locks`: Comparison of claimed vs unclaimed locks
- `average_lock_duration`: Average lock duration statistics

## Database Schema

### Event Tables
- `xen_burns`: XEN burn events
- `burn_nft_minted`: NFT minting events
- `xburn_claimed`: XBURN claim events
- `emergency_ends`: Emergency end stake events
- `xburn_burned`: XBURN burn events
- `liquidity_initialized`: Liquidity initialization events
- `burn_lock_created`: Burn lock creation events
- `lock_claimed`: Lock claim events
- `lock_burned`: Lock burn events

### Sync State
- `sync_state`: Tracks the last synced block for each contract

## Monitoring

Check indexer status:
```bash
docker-compose logs -f indexer
```

Check database content:
```bash
docker exec xburn-index-singlechain-postgres-1 psql -U postgres -d xburn_index -c "SELECT * FROM total_xen_burned;"
```

## Troubleshooting

If the indexer stops or encounters errors:

1. Check logs: `docker-compose logs indexer`
2. Restart the indexer: `docker-compose restart indexer`
3. Reset and start fresh:
   ```bash
   docker-compose down -v
   docker-compose up -d
   ```

## Configuration

All configuration is done through the `.env` file:

- `RPC_URL`: Ethereum RPC endpoint
- `XBURN_MINTER_CONTRACT`: XBurnMinter contract address
- `XBURN_NFT_CONTRACT`: XBurnNFT contract address
- `START_BLOCK`: Block number to start indexing from
- `CHAIN_ID`: Chain ID (8453 for Base)

## License

MIT

## Visualization with Metabase

For data visualization across all chains, you can run a separate Metabase instance:

```bash
# Start Metabase
docker compose -f docker-compose.metabase.yml up -d

# Connect to chain networks
./connect-metabase.sh
```

Access Metabase at http://localhost:3000 and add your chain databases. See [METABASE_SETUP.md](METABASE_SETUP.md) for detailed instructions.

## Querying the Database

Connect to PostgreSQL to run queries:

```bash
# Connect to database
docker exec -it base-xburn-postgres psql -U postgres -d base_xburn_index

# Example queries
SELECT * FROM total_xen_burned;
SELECT * FROM top_xen_burners LIMIT 10;
SELECT * FROM emergency_end_stats;
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Blockchain    │────▶│    Indexer      │
│   (RPC Node)    │     │   (Node.js)     │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   PostgreSQL    │
                        │   (Database)    │
                        └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │    Metabase     │
                        │ (Visualization) │
                        └─────────────────┘
```

## Troubleshooting

### Indexer keeps restarting
- Check RPC URL is valid: `docker compose logs indexer`
- Verify contract addresses are correct for your chain
- Ensure database is healthy: `docker compose ps`

### Database connection errors
- Check if PostgreSQL is running: `docker ps | grep postgres`
- Verify database name matches in `.env`
- Check port availability if running multiple instances

### Slow indexing
- Reduce batch size in `src/EventIndexer.js` (default: 500 blocks)
- Check RPC rate limits
- Monitor system resources: `docker stats`

## Development

### Project Structure
```
├── src/
│   ├── index.js          # Main entry point
│   └── EventIndexer.js   # Core indexing logic
├── init.sql              # Database schema
├── docker-compose.yml    # Main services
├── docker-compose.metabase.yml  # Metabase setup
├── Dockerfile            # Indexer container
└── example.env           # Configuration template
```

### Adding New Events
1. Add event ABI to `src/EventIndexer.js`
2. Create handler function for the event
3. Add corresponding table in `init.sql`
4. Update aggregate views if needed

## License

MIT

## Contributing

Pull requests are welcome! Please open an issue first to discuss major changes.

## Support

For questions or issues:
- Open a GitHub issue
- Check existing documentation
- Review logs with `docker compose logs`