#!/bin/bash

# Script to connect Metabase to chain networks

echo "Connecting Metabase to chain networks..."

# Function to connect to a network if it exists
connect_to_network() {
    local network_name=$1
    
    # Check if network exists
    if docker network ls | grep -q "$network_name"; then
        echo "Connecting to $network_name..."
        docker network connect "$network_name" xburn-metabase 2>/dev/null || echo "Already connected to $network_name"
    else
        echo "Network $network_name not found, skipping..."
    fi
}

# Try to connect to networks with different naming patterns
# New pattern: <chain>_xburn_network
connect_to_network "base_xburn_network"
connect_to_network "ethereum_xburn_network"
connect_to_network "optimism_xburn_network"
connect_to_network "arbitrum_xburn_network"
connect_to_network "polygon_xburn_network"

# Old pattern: <directory>_xburn_network
connect_to_network "base-indexer_xburn_network"
connect_to_network "ethereum-indexer_xburn_network"
connect_to_network "optimism-indexer_xburn_network"
connect_to_network "xburn-index-singlechain_xburn_network"

# Generic pattern
connect_to_network "xburn_network"

echo "Done! Metabase is now connected to all available chain networks."
echo ""
echo "You can now add databases in Metabase using these connection details:"
echo "  Host: <chain>-xburn-postgres (e.g., base-xburn-postgres)"
echo "  Port: 5432"
echo "  Database: <chain>_xburn_index (e.g., base_xburn_index)"
echo "  Username: postgres"
echo "  Password: postgres" 