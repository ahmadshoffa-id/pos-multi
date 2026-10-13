// Konfigurasi & koneksi MySQL (mysql2/promise)
require('./lib/env'); // memuat .env bila ada

const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pos_saas',
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: false,
  decimalNumbers: true,
};

let pool = null;
function getPool() {
  if (!pool) pool = mysql.createPool(config);
  return pool;
}

async function q(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

module.exports = { getPool, q, config };
