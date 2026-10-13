// Middleware & helper autentikasi (session + JWT)
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { q } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

async function login(username, password) {
  const rows = await q(
    `SELECT u.*, r.name AS role_name, r.level AS role_level,
            t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status, t.plan
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.username = ? AND u.status = 'active' LIMIT 1`,
    [username]
  );
  if (!rows.length) return null;
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  // superadmin (tenant_id NULL) bebas; tenant lain harus aktif/trial
  if (user.tenant_id && user.tenant_status === 'suspended') return null;
  const token = jwt.sign(
    { id: user.id, tid: user.tenant_id, sid: user.store_id, role: user.role_name },
    JWT_SECRET, { expiresIn: '12h' }
  );
  return { user, token };
}

// Autentikasi untuk route API: cek session ATAU header Bearer token
async function auth(req, res, next) {
  let payload = null;
  if (req.session && req.session.userId) {
    payload = { id: req.session.userId, tid: req.session.tenantId, sid: req.session.storeId, role: req.session.role };
  } else {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) {
      try { payload = jwt.verify(h.slice(7), JWT_SECRET); } catch (e) { /* ignore */ }
    }
  }
  if (!payload) return res.status(401).json({ error: 'Belum login / token tidak valid' });
  req.user = { id: payload.id, tenantId: payload.tid ?? null, storeId: payload.sid ?? null, role: payload.role };
  next();
}

// Batasi akses berdasarkan peran. Level: makin kecil makin tinggi.
const LEVELS = { superadmin: 0, owner: 1, admin: 2, manager: 3, accounting: 3, warehouse: 4, cashier: 4 };
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin') return next();
    const need = Math.min(...roles.map(r => LEVELS[r] ?? 9));
    const have = LEVELS[req.user.role] ?? 9;
    if (have <= need) return next();
    return res.status(403).json({ error: 'Tidak punya hak akses untuk aksi ini' });
  };
}

// Validasi store milik tenant; kembalikan storeId yang sah
async function resolveStore(req, requestedStoreId) {
  if (req.user.role === 'superadmin') {
    const rows = await q('SELECT id FROM stores WHERE id = ?', [requestedStoreId]);
    if (!rows.length) throw Object.assign(new Error('Store tidak ditemukan'), { status: 404 });
    return Number(requestedStoreId);
  }
  let sql = 'SELECT id FROM stores WHERE tenant_id = ? AND id = ? AND status = "active"';
  const params = [req.user.tenantId, requestedStoreId];
  const rows = await q(sql, params);
  if (!rows.length) throw Object.assign(new Error('Store tidak valid / bukan milik Anda'), { status: 403 });
  // pembatasan user_stores bila diisi
  const limits = await q('SELECT store_id FROM user_stores WHERE user_id = ?', [req.user.id]);
  if (limits.length && !limits.some(l => Number(l.store_id) === Number(requestedStoreId))) {
    throw Object.assign(new Error('Anda tidak ditugaskan di store ini'), { status: 403 });
  }
  return Number(requestedStoreId);
}

module.exports = { login, auth, requireRole, resolveStore, bcrypt, JWT_SECRET };
