#!/bin/bash

# Script to start XBURN indexer with proper project isolation

# Get the chain name from .env file
if [ -f .env ]; then
    export $(cat .env | grep CHAIN_NAME | xargs)
else
    echo "Error: .env file not found!"
    exit 1
fi

if [ -z "$CHAIN_NAME" ]; then
    echo "Error: CHAIN_NAME not set in .env file!"
    exit 1
fi

echo "Starting $CHAIN_NAME indexer..."

# Use the chain name as the project name to ensure isolation
docker compose -p "${CHAIN_NAME}-xburn" up -d

echo ""
echo "✓ $CHAIN_NAME indexer started with project name: ${CHAIN_NAME}-xburn"
echo ""
echo "Check status: docker compose -p ${CHAIN_NAME}-xburn ps"
echo "View logs: docker compose -p ${CHAIN_NAME}-xburn logs -f"
echo "Stop: docker compose -p ${CHAIN_NAME}-xburn down"
echo "Stop and remove data: docker compose -p ${CHAIN_NAME}-xburn down -v" 