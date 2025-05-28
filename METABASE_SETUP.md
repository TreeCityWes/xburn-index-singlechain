# Metabase Setup Guide

This guide explains how to set up a single Metabase instance to visualize data from all your XBURN indexers.

## Quick Start

1. **Start Metabase**
```bash
docker compose -f docker-compose.metabase.yml up -d
```

2. **Connect to Chain Networks**
```bash
chmod +x connect-metabase.sh
./connect-metabase.sh
```

3. **Access Metabase**
- URL: http://localhost:3000
- First time setup: Create an admin account

## Adding Chain Databases

Once Metabase is running, add each chain's database:

1. Go to **Settings** → **Admin** → **Databases**
2. Click **Add database**
3. Configure each chain:

### Base Chain
- **Database type**: PostgreSQL
- **Name**: Base XBURN Index
- **Host**: base-xburn-postgres
- **Port**: 5432
- **Database name**: base_xburn_index
- **Username**: postgres
- **Password**: postgres

### Ethereum Chain
- **Database type**: PostgreSQL
- **Name**: Ethereum XBURN Index
- **Host**: ethereum-xburn-postgres
- **Port**: 5432
- **Database name**: ethereum_xburn_index
- **Username**: postgres
- **Password**: postgres

### Optimism Chain
- **Database type**: PostgreSQL
- **Name**: Optimism XBURN Index
- **Host**: optimism-xburn-postgres
- **Port**: 5432
- **Database name**: optimism_xburn_index
- **Username**: postgres
- **Password**: postgres

## Pre-built Dashboards

After adding databases, you can create dashboards with these queries:

### Total XEN Burned (All Chains)
```sql
-- Base
SELECT 'Base' as chain, total_burned FROM base_xburn_index.total_xen_burned
UNION ALL
-- Ethereum
SELECT 'Ethereum' as chain, total_burned FROM ethereum_xburn_index.total_xen_burned
UNION ALL
-- Optimism
SELECT 'Optimism' as chain, total_burned FROM optimism_xburn_index.total_xen_burned
```

### Top Burners Across All Chains
```sql
SELECT 
    'Base' as chain,
    user_address,
    total_burned,
    burn_count
FROM base_xburn_index.top_xen_burners
LIMIT 10

UNION ALL

SELECT 
    'Ethereum' as chain,
    user_address,
    total_burned,
    burn_count
FROM ethereum_xburn_index.top_xen_burners
LIMIT 10

ORDER BY total_burned DESC
LIMIT 20
```

### Daily Activity Comparison
```sql
SELECT 
    date,
    SUM(CASE WHEN chain = 'Base' THEN daily_burned ELSE 0 END) as base_burned,
    SUM(CASE WHEN chain = 'Ethereum' THEN daily_burned ELSE 0 END) as ethereum_burned,
    SUM(CASE WHEN chain = 'Optimism' THEN daily_burned ELSE 0 END) as optimism_burned
FROM (
    SELECT 'Base' as chain, date, daily_burned FROM base_xburn_index.daily_burn_activity
    UNION ALL
    SELECT 'Ethereum' as chain, date, daily_burned FROM ethereum_xburn_index.daily_burn_activity
    UNION ALL
    SELECT 'Optimism' as chain, date, daily_burned FROM optimism_xburn_index.daily_burn_activity
) combined
GROUP BY date
ORDER BY date DESC
```

## Managing Metabase

### Stop Metabase
```bash
docker compose -f docker-compose.metabase.yml down
```

### View Logs
```bash
docker compose -f docker-compose.metabase.yml logs -f
```

### Backup Metabase Data
```bash
docker run --rm -v xburn-index-singlechain_metabase_data:/data -v $(pwd):/backup alpine tar czf /backup/metabase-backup.tar.gz -C /data .
```

### Restore Metabase Data
```bash
docker run --rm -v xburn-index-singlechain_metabase_data:/data -v $(pwd):/backup alpine tar xzf /backup/metabase-backup.tar.gz -C /data
```

## Troubleshooting

### Cannot connect to database
1. Make sure the chain indexer is running: `docker ps | grep <chain>-xburn`
2. Ensure Metabase is connected to the network: `./connect-metabase.sh`
3. Check network connectivity: `docker network inspect <chain>_xburn_network`

### Metabase is slow
- Increase memory allocation in docker-compose.metabase.yml:
```yaml
environment:
  JAVA_OPTS: "-Xmx2g"  # Increase to 2GB
```

### Port 3000 already in use
Change the port in docker-compose.metabase.yml or use environment variable:
```bash
METABASE_PORT=3001 docker compose -f docker-compose.metabase.yml up -d
```

## Advanced Configuration

### Using External PostgreSQL
If you prefer to use an external PostgreSQL for better performance:

1. Update docker-compose.metabase.yml to use external database
2. Configure connection string in environment variables
3. Ensure network connectivity between Metabase and databases

### SSL/HTTPS Setup
For production, use a reverse proxy (nginx/traefik) to add SSL:
```nginx
server {
    listen 443 ssl;
    server_name metabase.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
``` 