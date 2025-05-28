require('dotenv').config();
const knex = require('knex');
const logger = require('../logger');
const { schema, createSchema } = require('../schema');

const config = {
  client: 'postgresql',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: __dirname
  }
};

async function createTables(db) {
  try {
    await createSchema(db);
    logger.info('Database schema created successfully');
  } catch (error) {
    logger.error('Error creating database schema:', error);
    throw error;
  }
}

async function runMigrations() {
  const db = knex(config);
  try {
    logger.info('Running database migrations...');
    await createTables(db);
    logger.info('Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', { error: error.message });
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  runMigrations();
}
