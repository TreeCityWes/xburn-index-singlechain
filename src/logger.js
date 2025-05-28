const winston = require('winston');
const config = require('./config');

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'xburn-indexer',
    chain: config.chain.name,
    chainId: config.chain.id
  },
  transports: []
});

// Add console transport if enabled
if (config.logging.console) {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Add file transport if enabled
if (config.logging.file) {
  logger.add(new winston.transports.File({
    filename: config.logging.filename,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));
}

module.exports = logger;
