// Master data: kategori, produk+stok, pelanggan, supplier, store, user
const express = require('express');
const { auth, requireRole, bcrypt } = require('../lib/auth');
const { q, getPool } = require('../db');

const router = express.Router();
router.use(auth);

const tid = (req) => req.user.role === 'superadmin' ? Number(req.query.tenant_id || 0) : req.user.tenantId;

// ---------------- KATEGORI ----------------
router.get('/categories', async (req, res, next) => {
  try { res.json(await q('SELECT * FROM categories WHERE tenant_id=? ORDER BY name', [tid(req)])); }
  catch (e) { next(e); }
});
router.post('/categories', requireRole('manager'), async (req, res, next) => {
  try {
    const r = await q('INSERT INTO categories (tenant_id,name) VALUES (?,?)', [tid(req), req.body.name]);
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});
router.put('/categories/:id', requireRole('manager'), async (req, res, next) => {
  try { await q('UPDATE categories SET name=? WHERE id=? AND tenant_id=?', [req.body.name, req.params.id, tid(req)]); res.json({ ok: true }); }
  catch (e) { next(e); }
});
router.delete('/categories/:id', requireRole('admin'), async (req, res, next) => {
  try { await q('DELETE FROM categories WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

// ---------------- PRODUK ----------------
router.get('/products', async (req, res, next) => {
  try {
    const kw = (req.query.q || '').trim();
    let sql = `SELECT p.*, c.name AS category_name FROM products p
               LEFT JOIN categories c ON c.id=p.category_id
               WHERE p.tenant_id=?`;
    const params = [tid(req)];
    if (kw) { sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'; params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`); }
    if (req.query.category_id) { sql += ' AND p.category_id=?'; params.push(req.query.category_id); }
    sql += ' ORDER BY p.name LIMIT 500';
    res.json(await q(sql, params));
  } catch (e) { next(e); }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const rows = await q('SELECT * FROM products WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]);
    if (!rows.length) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/products', requireRole('manager'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = tid(req);
    const { sku, name, category_id, barcode, unit, cost_price, sell_price, member_price, tax_rate, min_stock, store_id } = req.body;
    if (!sku || !name) return res.status(400).json({ error: 'SKU dan nama wajib diisi' });
    await conn.beginTransaction();
    const r = await conn.execute(
      `INSERT INTO products (tenant_id,category_id,sku,barcode,name,unit,cost_price,sell_price,member_price,tax_rate)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [t, category_id || null, sku, barcode || null, name, unit || 'pcs', cost_price || 0, sell_price || 0, member_price || null, tax_rate || 0]
    );
    // buat baris stok di store utama / store yg diminta
    let storesRows;
    if (store_id) storesRows = [{ id: store_id }];
    else storesRows = await conn.execute('SELECT id FROM stores WHERE tenant_id=?', [t]).then(a => a[0]);
    for (const s of storesRows) {
      await conn.execute(
        'INSERT IGNORE INTO stocks (tenant_id,store_id,product_id,qty,avg_cost,min_stock) VALUES (?,?,?,0,?,?,0)',
        [t, s.id, r[0].insertId, cost_price || 0, min_stock || 0]
      );
    }
    await conn.commit();
    res.json({ id: r[0].insertId });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

router.put('/products/:id', requireRole('manager'), async (req, res, next) => {
  try {
    const b = req.body;
    await q(
      `UPDATE products SET category_id=?,sku=?,barcode=?,name=?,unit=?,cost_price=?,sell_price=?,member_price=?,tax_rate=?,is_active=?
       WHERE id=? AND tenant_id=?`,
      [b.category_id || null, b.sku, b.barcode || null, b.name, b.unit || 'pcs',
       b.cost_price || 0, b.sell_price || 0, b.member_price || null, b.tax_rate || 0,
       b.is_active ?? 1, req.params.id, tid(req)]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/products/:id', requireRole('admin'), async (req, res, next) => {
  try { await q('UPDATE products SET is_active=0 WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

// ---------------- STOK ----------------
router.get('/stocks', async (req, res, next) => {
  try {
    let sql = `SELECT st.*, p.name, p.sku, p.unit, p.sell_price, s.name AS store_name
               FROM stocks st JOIN products p ON p.id=st.product_id JOIN stores s ON s.id=st.store_id
               WHERE st.tenant_id=?`;
    const params = [tid(req)];
    if (req.query.store_id) { sql += ' AND st.store_id=?'; params.push(req.query.store_id); }
    if (req.query.low) sql += ' AND st.qty <= st.min_stock';
    sql += ' ORDER BY s.name, p.name';
    res.json(await q(sql, params));
  } catch (e) { next(e); }
});

// Penyesuaian stok manual (untuk warehouse/manager) -> jurnal penyesuaian
router.post('/stocks/adjust', requireRole('warehouse'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = tid(req);
    const { store_id, product_id, qty_diff, note } = req.body;
    if (!qty_diff) return res.status(400).json({ error: 'qty_diff tidak boleh 0' });
    await conn.beginTransaction();
    const [sr] = await conn.execute('SELECT * FROM stocks WHERE tenant_id=? AND store_id=? AND product_id=? FOR UPDATE', [t, store_id, product_id]);
    if (!sr.length) throw Object.assign(new Error('Kombinasi store/produk tidak ada'), { status: 404 });
    const st = sr[0];
    const newQty = Number(st.qty) + Number(qty_diff);
    if (newQty < 0) throw Object.assign(new Error('Stok hasil penyesuaian tidak boleh negatif'), { status: 400 });
    await conn.execute('UPDATE stocks SET qty=? WHERE id=?', [newQty, st.id]);
    await conn.execute(
      'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,qty,cost,note,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [t, store_id, product_id, 'adjustment', 'manual', qty_diff, st.avg_cost, note || 'Penyesuaian manual', req.user.id]
    );
    // Jurnal: Dr/Cr Persediaan vs Beban lain-lain/Pendapatan lain
    const accInv = (await conn.execute("SELECT id FROM chart_of_accounts WHERE tenant_id=? AND code='1-1200'", [t]))[0][0];
    const accOtherExp = (await conn.execute("SELECT id FROM chart_of_accounts WHERE tenant_id=? AND code='5-1600'", [t]))[0][0];
    const accOtherInc = (await conn.execute("SELECT id FROM chart_of_accounts WHERE tenant_id=? AND code='4-1100'", [t]))[0][0];
    const amount = Math.abs(Number(qty_diff)) * Number(st.avg_cost);
    const codeJ = 'ADJ-' + Date.now();
    const [jr] = await conn.execute(
      'INSERT INTO journals (tenant_id,store_id,code,journal_date,ref_type,description,created_by) VALUES (?,?,?,?,?,?,?)',
      [t, store_id, codeJ, new Date(), 'manual', `Penyesuaian stok ${note || ''}`, req.user.id]
    );
    if (Number(qty_diff) > 0) {
      await conn.execute('INSERT INTO journal_lines (journal_id,account_id,debit,credit) VALUES (?,?,?,?),(?,?,?,?)',
        [jr[0].insertId, accInv.id, amount, 0, jr[0].insertId, accOtherExp.id, 0, amount]);
    } else {
      await conn.execute('INSERT INTO journal_lines (journal_id,account_id,debit,credit) VALUES (?,?,?,?),(?,?,?,?)',
        [jr[0].insertId, accOtherExp.id, amount, 0, jr[0].insertId, accInv.id, 0, amount]);
    }
    await conn.commit();
    res.json({ ok: true, new_qty: newQty });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

// ---------------- PELANGGAN ----------------
router.get('/customers', async (req, res, next) => {
  try {
    const kw = (req.query.q || '').trim();
    let sql = 'SELECT * FROM customers WHERE tenant_id=?';
    const params = [tid(req)];
    if (kw) { sql += ' AND (name LIKE ? OR phone LIKE ?)'; params.push(`%${kw}%`, `%${kw}%`); }
    res.json(await q(sql + ' ORDER BY name LIMIT 300', params));
  } catch (e) { next(e); }
});
router.post('/customers', requireRole('cashier'), async (req, res, next) => {
  try {
    const b = req.body;
    const r = await q('INSERT INTO customers (tenant_id,name,phone,email,address,member_level,credit_limit) VALUES (?,?,?,?,?,?,?)',
      [tid(req), b.name, b.phone || '', b.email || '', b.address || '', b.member_level || 'reguler', b.credit_limit || 0]);
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});
router.put('/customers/:id', requireRole('cashier'), async (req, res, next) => {
  try {
    const b = req.body;
    await q('UPDATE customers SET name=?,phone=?,email=?,address=?,member_level=?,credit_limit=? WHERE id=? AND tenant_id=?',
      [b.name, b.phone || '', b.email || '', b.address || '', b.member_level || 'reguler', b.credit_limit || 0, req.params.id, tid(req)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- SUPPLIER ----------------
router.get('/suppliers', async (req, res, next) => {
  try { res.json(await q('SELECT * FROM suppliers WHERE tenant_id=? ORDER BY name', [tid(req)])); }
  catch (e) { next(e); }
});
router.post('/suppliers', requireRole('manager'), async (req, res, next) => {
  try {
    const b = req.body;
    const r = await q('INSERT INTO suppliers (tenant_id,name,contact,phone,email,address,tax_npwp,terms_days) VALUES (?,?,?,?,?,?,?,?)',
      [tid(req), b.name, b.contact || '', b.phone || '', b.email || '', b.address || '', b.tax_npwp || '', b.terms_days || 30]);
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});
router.put('/suppliers/:id', requireRole('manager'), async (req, res, next) => {
  try {
    const b = req.body;
    await q('UPDATE suppliers SET name=?,contact=?,phone=?,email=?,address=?,tax_npwp=?,terms_days=? WHERE id=? AND tenant_id=?',
      [b.name, b.contact || '', b.phone || '', b.email || '', b.address || '', b.tax_npwp || '', b.terms_days || 30, req.params.id, tid(req)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- STORE (admin ke atas) ----------------
router.get('/stores', async (req, res, next) => {
  try {
    if (req.user.role === 'superadmin')
      return res.json(await q('SELECT s.*, t.name AS tenant_name FROM stores s JOIN tenants t ON t.id=s.tenant_id ORDER BY t.id, s.id'));
    res.json(await q('SELECT * FROM stores WHERE tenant_id=? ORDER BY is_main DESC, id', [req.user.tenantId]));
  } catch (e) { next(e); }
});
router.post('/stores', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const t = req.user.role === 'superadmin' ? Number(b.tenant_id) : req.user.tenantId;
    const r = await q('INSERT INTO stores (tenant_id,name,code,address,phone,email,is_main) VALUES (?,?,?,?,?,?,?)',
      [t, b.name, b.code, b.address || '', b.phone || '', b.email || '', b.is_main ? 1 : 0]);
    // inisialisasi stok untuk semua produk tenant di store baru
    await q(
      `INSERT IGNORE INTO stocks (tenant_id,store_id,product_id,qty,avg_cost)
       SELECT ?, ?, p.id, 0, p.cost_price FROM products p WHERE p.tenant_id=?`,
      [t, r.insertId, t]
    );
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});
router.put('/stores/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    await q('UPDATE stores SET name=?,code=?,address=?,phone=?,email=?,status=? WHERE id=? AND (tenant_id=? OR ?=1)',
      [b.name, b.code, b.address || '', b.phone || '', b.email || '', b.status || 'active', req.params.id, req.user.tenantId, req.user.role === 'superadmin' ? 1 : 0]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- USER (admin ke atas) ----------------
router.get('/users', requireRole('admin'), async (req, res, next) => {
  try {
    res.json(await q(`SELECT u.id,u.username,u.full_name,u.email,u.phone,u.store_id,u.status,r.name AS role
                      FROM users u JOIN roles r ON r.id=u.role_id
                      WHERE u.tenant_id=${tid(req)} ORDER BY u.username`));
  } catch (e) { next(e); }
});
router.post('/users', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const hash = await bcrypt.hash(b.password || 'changeme', 10);
    const [roles] = await q('SELECT id FROM roles WHERE name=?', [b.role || 'cashier']);
    const r = await q('INSERT INTO users (tenant_id,store_id,role_id,username,password_hash,full_name,email,phone) VALUES (?,?,?,?,?,?,?,?)',
      [tid(req), b.store_id || null, roles[0].id, b.username, hash, b.full_name, b.email || '', b.phone || '']);
    if (b.store_id) await q('INSERT IGNORE INTO user_stores (user_id,store_id) VALUES (?,?)', [r.insertId, b.store_id]);
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});
router.put('/users/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    await q('UPDATE users SET full_name=?,email=?,phone=?,store_id=?,status=? WHERE id=? AND tenant_id=?',
      [b.full_name, b.email || '', b.phone || '', b.store_id || null, b.status || 'active', req.params.id, tid(req)]);
    if (b.password) {
      const hash = await bcrypt.hash(b.password, 10);
      await q('UPDATE users SET password_hash=? WHERE id=? AND tenant_id=?', [hash, req.params.id, tid(req)]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
