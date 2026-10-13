// Rute autentikasi & profil user
const express = require('express');
const { login, auth, bcrypt } = require('../lib/auth');
const { q } = require('../db');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username & password wajib diisi' });
    const result = await login(username, password);
    if (!result) return res.status(401).json({ error: 'Username/password salah atau akun tidak aktif' });
    req.session.userId = result.user.id;
    req.session.tenantId = result.user.tenant_id;
    req.session.storeId = result.user.store_id;
    req.session.role = result.user.role_name;
    req.session.name = result.user.full_name;
    await q('UPDATE users SET last_login = NOW() WHERE id = ?', [result.user.id]);
    await q("INSERT INTO activity_logs (tenant_id,user_id,action,detail,ip) VALUES (?,?,?,?,?)",
      [result.user.tenant_id, result.user.id, 'login', `${username} masuk`, req.ip]);
    res.json({
      token: result.token,
      user: {
        id: result.user.id, username: result.user.username, full_name: result.user.full_name,
        role: result.user.role_name, tenant_id: result.user.tenant_id, store_id: result.user.store_id,
        tenant_name: result.user.tenant_name, plan: result.user.plan,
      }
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', auth, async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT u.id,u.username,u.full_name,u.email,u.phone,u.tenant_id,u.store_id,u.role_id,
              r.name AS role, t.name AS tenant_name, t.slug AS tenant_slug, t.plan
       FROM users u JOIN roles r ON r.id=u.role_id
       LEFT JOIN tenants t ON t.id=u.tenant_id WHERE u.id=?`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    // daftar store yang bisa diakses
    let stores;
    if (req.user.role === 'superadmin') {
      stores = await q('SELECT s.*, t.name AS tenant_name FROM stores s JOIN tenants t ON t.id=s.tenant_id ORDER BY s.id');
    } else {
      stores = await q('SELECT * FROM stores WHERE tenant_id = ? AND status="active" ORDER BY is_main DESC, id', [req.user.tenantId]);
    }
    res.json({ user: rows[0], stores });
  } catch (e) { next(e); }
});

router.post('/change-password', auth, async (req, res, next) => {
  try {
    const { old_password, new_password } = req.body || {};
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    const rows = await q('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!(await bcrypt.compare(old_password || '', rows[0].password_hash)))
      return res.status(400).json({ error: 'Password lama salah' });
    const hash = await bcrypt.hash(new_password, 10);
    await q('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
