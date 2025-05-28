#!/bin/bash

# Script to prune and restart XBURN indexers

echo "XBURN Indexer Pruning Script"
echo "============================"
echo ""

# Function to prune and restart an indexer
prune_indexer() {
    local chain_name=$1
    local directory=$2
    
    if [ -d "$directory" ]; then
        echo "Processing $chain_name indexer..."
        cd "$directory"
        
        # Stop and remove containers and volumes
        echo "  - Stopping containers..."
        docker compose down -v
        
        # Optional: Remove the Docker image to force rebuild
        # docker rmi ${chain_name}-indexer 2>/dev/null || true
        
        # Start fresh
        echo "  - Starting fresh..."
        docker compose up -d
        
        echo "  ✓ $chain_name indexer pruned and restarted"
        echo ""
    else
        echo "  ⚠ Directory $directory not found, skipping $chain_name"
        echo ""
    fi
}

# Check if specific chain is provided as argument
if [ $# -eq 1 ]; then
    case $1 in
        base)
            prune_indexer "base" "$HOME/base-indexer"
            ;;
        ethereum)
            prune_indexer "ethereum" "$HOME/ethereum-indexer"
            ;;
        optimism)
            prune_indexer "optimism" "$HOME/optimism-indexer"
            ;;
        *)
            echo "Unknown chain: $1"
            echo "Usage: $0 [base|ethereum|optimism|all]"
            exit 1
            ;;
    esac
else
    # Prune all indexers
    echo "Pruning all indexers..."
    echo ""
    
    prune_indexer "base" "$HOME/base-indexer"
    prune_indexer "ethereum" "$HOME/ethereum-indexer"
    prune_indexer "optimism" "$HOME/optimism-indexer"
    prune_indexer "arbitrum" "$HOME/arbitrum-indexer"
    prune_indexer "polygon" "$HOME/polygon-indexer"
fi

echo "All done!"
echo ""
echo "Check status with: docker ps | grep xburn"
echo "View logs with: cd ~/<chain>-indexer && docker compose logs -f" 