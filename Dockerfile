FROM node:18-slim

# Create app directory
WORKDIR /app

# Install app dependencies
# Copy package.json and package-lock.json to optimize Docker caching
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# Create volume mount points
VOLUME /app/config

# Expose API port (if running API)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node /app/src/healthcheck.js || exit 1

# Set environment variables
ENV NODE_ENV=production

# Create an entrypoint script to handle migrations and starting the indexer
RUN echo '#!/bin/sh\n\
echo "Running database migrations..."\n\
node src/migrations/run.js\n\
\n\
echo "Starting XBurn indexer for chain: $CHAIN_NAME (ID: $CHAIN_ID)"\n\
exec node src/indexer.js\n\
' > /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Set the entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]
