const AWSXRay = require('aws-xray-sdk');
// Capture PostgreSQL client for AWS X-Ray tracing
const pg = AWSXRay.capturePostgres(require('pg'));

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'xray_game_db',
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('[RDS Postgres Pool Error]', err);
});

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`[SQL Query Executed] duration: ${duration}ms | rows: ${res.rowCount}`);
    return res;
  } catch (error) {
    console.error(`[SQL Query Error]`, error.message);
    throw error;
  }
}

async function initDb() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      wins INT DEFAULT 0,
      losses INT DEFAULT 0,
      draws INT DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      opponent_name VARCHAR(100) DEFAULT 'AWS Lambda AI',
      winner VARCHAR(50) NOT NULL,
      moves_count INT DEFAULT 0,
      board_history TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    console.log('[DB Init] Checking and creating database tables on AWS RDS...');
    await query(createTableQuery);
    console.log('[DB Init] Database tables (users & matches) verified.');
  } catch (err) {
    console.warn('[DB Init Warning] Could not initialize DB tables:', err.message);
  }
}

module.exports = {
  query,
  pool,
  initDb
};
