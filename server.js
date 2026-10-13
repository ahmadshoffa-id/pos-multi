#!/usr/bin/env node
// Entry point aplikasi POS SaaS Multi-Store
require('./src/lib/env');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---- API routes ----
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/master', require('./src/routes/master'));   // kategori/produk/stok/pelanggan/supplier/store/user
app.use('/api/sales', require('./src/routes/sales'));     // modul penjualan / POS
app.use('/api/inv', require('./src/routes/inventory'));   // modul inventory / pembelian
app.use('/api/finance', require('./src/routes/finance')); // modul keuangan
app.use('/api/reports', require('./src/routes/reports')); // akuntansi & laporan
app.use('/api/saas', require('./src/routes/saas'));       // tenant & subscription (superadmin)

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Error handler terpusat
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Terjadi kesalahan server' });
});

// Cek koneksi DB saat start (tidak memaksa: tetap jalan bila DB belum siap)
const { getPool } = require('./src/db');
getPool().query('SELECT 1').then(() => console.log('[DB] Terhubung ke MySQL')).catch(e =>
  console.warn('[DB] Belum terhubung:', e.message, '- jalankan `npm run db:init` setelah MySQL aktif.'));

app.listen(PORT, () => console.log(`POS SaaS berjalan di http://localhost:${PORT}`));
