// Modul SaaS (platform): tenant & subscription - khusus superadmin
const express = require('express');
const bcrypt = require('bcryptjs');
const { auth } = require('../lib/auth');
const { q } = require('../db');

const router = express.Router();
router.use(auth);

// Guard: hanya superadmin
router.use((req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Hanya superadmin platform' });
  next();
});

/* ---------------- TENANT ---------------- */
router.get('/tenants', async (req, res, next) => {
  try {
    const rows = await q(`SELECT t.*,
      (SELECT COUNT(*) FROM stores s WHERE s.tenant_id=t.id) AS n_stores,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id) AS n_users
      FROM tenants t ORDER BY t.id`);
    res.json(rows);
  } catch (e) { next(e); }
});

/** Buat tenant baru + user owner-nya + COA standar + store utama */
router.post('/tenants', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.slug || !b.owner_username || !b.owner_password)
      return res.status(400).json({ error: 'name, slug, owner_username, owner_password wajib' });
    const r = await q('INSERT INTO tenants (name,slug,domain,plan,status,contact_email,contact_phone) VALUES (?,?,?,?,?,?,?)',
      [b.name, b.slug.toLowerCase(), b.domain || null, b.plan || 'free', b.status || 'trial', b.email || '', b.phone || '']);
    const tid = r.insertId;
    // store utama
    await q('INSERT INTO stores (tenant_id,name,code,is_main) VALUES (?,?,?,1)',
      [tid, b.store_name || (b.name + ' - Pusat'), b.store_code || (b.slug.slice(0, 5).toUpperCase() + '-01')]);
    // owner user
    const [role] = await q("SELECT id FROM roles WHERE name='owner'");
    const hash = await bcrypt.hash(b.owner_password, 10);
    await q('INSERT INTO users (tenant_id,role_id,username,password_hash,full_name,email) VALUES (?,?,?,?,?,?)',
      [tid, role[0].id, b.owner_username, hash, b.owner_name || 'Owner', b.email || '']);
    // langganan
    const price = { free: 0, basic: 199000, pro: 499000, enterprise: 1499000 }[b.plan || 'free'] || 0;
    await q('INSERT INTO subscriptions (tenant_id,plan,price,start_date,end_date) VALUES (?,?,?,?,?)',
      [tid, b.plan || 'free', price, new Date(), new Date(Date.now() + 30 * 864e5)]);
    // COA standar otomatis
    await seedCOA(tid);
    res.json({ id: tid });
  } catch (e) { next(e); }
});

router.put('/tenants/:id', async (req, res, next) => {
  try {
    const b = req.body;
    await q('UPDATE tenants SET name=?,plan=?,status=?,contact_email=?,contact_phone=? WHERE id=?',
      [b.name, b.plan, b.status, b.email || '', b.phone || '', req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------- SUBSCRIPTION ---------------- */
router.get('/subscriptions', async (req, res, next) => {
  try {
    res.json(await q(`SELECT s.*, t.name AS tenant_name FROM subscriptions s
                      JOIN tenants t ON t.id=s.tenant_id ORDER BY s.end_date ASC LIMIT 300`));
  } catch (e) { next(e); }
});

router.post('/subscriptions', async (req, res, next) => {
  try {
    const b = req.body;
    const price = { free: 0, basic: 199000, pro: 499000, enterprise: 1499000 }[b.plan] ?? Number(b.price || 0);
    const r = await q('INSERT INTO subscriptions (tenant_id,plan,price,start_date,end_date,status) VALUES (?,?,?,?,?,?)',
      [b.tenant_id, b.plan, price, b.start_date, b.end_date, 'active']);
    await q('UPDATE tenants SET plan=? WHERE id=?', [b.plan, b.tenant_id]);
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});

async function seedCOA(tenantId) {
  const coa = [
    ['1-1000', 'Kas & Bank', 'asset', 'cash', 1],
    ['1-1010', 'Kas Kecil', 'asset', 'cash', 0],
    ['1-1020', 'Bank BCA', 'asset', 'cash', 0],
    ['1-1100', 'Piutang Usaha', 'asset', 'receivable', 0],
    ['1-1200', 'Persediaan Barang Dagang', 'asset', 'inventory', 0],
    ['1-1500', 'Pajak Masukan (PPN)', 'asset', 'tax', 0],
    ['2-1000', 'Hutang Usaha', 'liability', 'payable', 0],
    ['2-1100', 'Hutang Pajak (PPN Keluaran)', 'liability', 'tax', 0],
    ['3-1000', 'Modal Pemilik', 'equity', 'capital', 0],
    ['3-1100', 'Laba Ditahan', 'equity', 'retained', 0],
    ['4-1000', 'Pendapatan Penjualan', 'revenue', 'sales', 0],
    ['4-1100', 'Pendapatan Lain-lain', 'revenue', 'other', 0],
    ['4-1200', 'Potongan Penjualan', 'revenue', 'contra', 0],
    ['5-1000', 'Harga Pokok Penjualan', 'expense', 'cogs', 0],
    ['5-1100', 'Beban Gaji & Upah', 'expense', 'opex', 0],
    ['5-1200', 'Beban Sewa', 'expense', 'opex', 0],
    ['5-1300', 'Beban Listrik & Air', 'expense', 'opex', 0],
    ['5-1600', 'Beban Operasional Lainnya', 'expense', 'opex', 0],
  ];
  for (const c of coa) {
    await q('INSERT IGNORE INTO chart_of_accounts (tenant_id,code,name,type,subtype,is_header) VALUES (?,?,?,?,?,?)',
      [tenantId, ...c]);
  }
}

module.exports = router;
