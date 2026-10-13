// Modul Penjualan / POS: transaksi, riwayat, retur, shift kasir
const express = require('express');
const { auth, requireRole, resolveStore } = require('../lib/auth');
const { getPool, q } = require('../db');
const { nextCode, accountId, postJournal } = require('../lib/accounting');

const router = express.Router();
router.use(auth);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * POST /api/sales  { store_id, customer_id, items:[{product_id, qty, price?, discount?}],
 *                    discount_total, payment_method, paid, note }
 * Dalam satu transaksi DB: validasi stok -> kurangi stok (moving average cost) ->
 * simpan sale+items+payments -> posting jurnal:
 *   Dr Kas/Piutang, Cr Penjualan, Cr PPN Keluaran ; Dr HPP, Cr Persediaan
 */
router.post('/', async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId || Number(req.body.tenant_id);
    if (!t) return res.status(400).json({ error: 'tenant_id wajib untuk superadmin' });
    const storeId = await resolveStore({ ...req, user: { ...req.user, tenantId: t } }, req.body.store_id);
    const b = req.body;
    if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'Keranjang kosong' });

    await conn.beginTransaction();

    let subtotal = 0, taxAmount = 0, totalCost = 0;
    const lines = [];
    for (const it of b.items) {
      const [pr] = await conn.execute('SELECT * FROM products WHERE id=? AND tenant_id=? AND is_active=1', [it.product_id, t]);
      if (!pr.length) throw Object.assign(new Error(`Produk ${it.product_id} tidak ditemukan`), { status: 400 });
      const p = pr[0];
      const [st] = await conn.execute('SELECT * FROM stocks WHERE store_id=? AND product_id=? FOR UPDATE', [storeId, p.id]);
      if (!st.length) throw Object.assign(new Error(`Produk ${p.name} belum terdaftar di store ini`), { status: 400 });
      const qty = Number(it.qty);
      if (!(qty > 0)) throw Object.assign(new Error('Qty harus > 0'), { status: 400 });
      if (Number(st.qty) < qty) throw Object.assign(new Error(`Stok ${p.name} tidak cukup (sisa ${st.qty})`), { status: 400 });

      const price = round2(it.price ?? (b.customer_id && p.member_price ? p.member_price : p.sell_price));
      const disc = round2(it.discount || 0);
      const lineNet = round2(price * qty - disc);
      const lineTax = round2(lineNet * Number(p.tax_rate) / 100);
      subtotal += lineNet; taxAmount += lineTax;
      const unitCost = Number(st.avg_cost) || Number(p.cost_price);
      totalCost += round2(unitCost * qty);

      lines.push({ product: p, stock: st[0], qty, price, disc, lineNet, lineTax, unitCost, tax_rate: Number(p.tax_rate) });
    }
    subtotal = round2(subtotal); taxAmount = round2(taxAmount); totalCost = round2(totalCost);
    const discTotal = round2(b.discount_total || 0);
    const total = round2(subtotal + taxAmount - discTotal);
    const paid = round2(b.paid ?? total);
    if (paid < total && (b.payment_method || 'cash') === 'cash')
      throw Object.assign(new Error('Uang tunai kurang dari total'), { status: 400 });

    const code = await nextCode(conn, 'sales', 'INV', t);
    const [sr] = await conn.execute(
      `INSERT INTO sales (tenant_id,store_id,code,customer_id,cashier_id,shift_id,subtotal,discount,tax_amount,total,paid,change_amount,payment_method,note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t, storeId, code, b.customer_id || null, req.user.id, b.shift_id || null,
       subtotal, discTotal, taxAmount, total, paid, round2(Math.max(0, paid - total)),
       b.payment_method || 'cash', b.note || '']
    );
    const saleId = sr[0].insertId;

    // item + kurangi stok + catat pergerakan
    for (const l of lines) {
      await conn.execute(
        'INSERT INTO sale_items (sale_id,product_id,qty,price,discount,tax_rate,cost) VALUES (?,?,?,?,?,?,?)',
        [saleId, l.product.id, l.qty, l.price, l.disc, l.tax_rate, l.unitCost]
      );
      const newQty = round2(Number(l.stock.qty) - l.qty);
      await conn.execute('UPDATE stocks SET qty=? WHERE id=?', [newQty, l.stock.id]);
      await conn.execute(
        'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        [t, storeId, l.product.id, 'sale', 'sale', saleId, -l.qty, l.unitCost, req.user.id]
      );
    }
    await conn.execute('INSERT INTO sale_payments (sale_id,method,amount) VALUES (?,?,?)',
      [saleId, b.payment_method || 'cash', paid >= total ? total : paid]);

    await conn.commit();

    // ---- Posting jurnal (di luar transaksi stok agar commit stok tidak gagal karena COA) ----
    const isCredit = ['credit', 'tempo'].includes(b.payment_method);
    const accCash = await accountId(t, '1-1010');
    const accAR = await accountId(t, '1-1100');
    const accSales = await accountId(t, '4-1000');
    const accTaxOut = await accountId(t, '2-1100');
    const accCogs = await accountId(t, '5-1000');
    const accInv = await accountId(t, '1-1200');
    const jlines = [
      { account_id: isCredit ? accAR : accCash, debit: total, credit: 0, memo: code },
      { account_id: accSales, debit: 0, credit: round2(subtotal - discTotal), memo: code },
    ];
    if (taxAmount > 0) jlines.push({ account_id: accTaxOut, debit: 0, credit: taxAmount, memo: 'PPN keluaran' });
    if (totalCost > 0) jlines.push(
      { account_id: accCogs, debit: totalCost, credit: 0, memo: 'HPP' },
      { account_id: accInv, debit: 0, credit: totalCost, memo: 'HPP' });
    await postJournal({
      tenantId: t, storeId, date: new Date(), refType: 'sale', refId: saleId,
      description: `Penjualan ${code}`, lines: jlines, userId: req.user.id,
    });

    res.json({ id: saleId, code, subtotal, discount: discTotal, tax_amount: taxAmount, total, paid, change: round2(Math.max(0, paid - total)) });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/** Riwayat penjualan */
router.get('/', async (req, res, next) => {
  try {
    const t = req.user.tenantId || Number(req.query.tenant_id);
    let sql = `SELECT s.*, st.name AS store_name, c.name AS customer_name, u.full_name AS cashier_name
               FROM sales s JOIN stores st ON st.id=s.store_id
               LEFT JOIN customers c ON c.id=s.customer_id
               LEFT JOIN users u ON u.id=s.cashier_id
               WHERE s.tenant_id=?`;
    const params = [t];
    if (req.query.store_id) { sql += ' AND s.store_id=?'; params.push(req.query.store_id); }
    if (req.query.from) { sql += ' AND DATE(s.created_at) >= ?'; params.push(req.query.from); }
    if (req.query.to) { sql += ' AND DATE(s.created_at) <= ?'; params.push(req.query.to); }
    sql += ' ORDER BY s.created_at DESC LIMIT 300';
    res.json(await q(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const t = req.user.tenantId || Number(req.query.tenant_id);
    const [sale] = await q('SELECT * FROM sales WHERE id=? AND tenant_id=?', [req.params.id, t]);
    if (!sale) return res.status(404).json({ error: 'Penjualan tidak ditemukan' });
    const items = await q(
      `SELECT si.*, p.name, p.sku, p.unit FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`,
      [req.params.id]);
    res.json({ sale, items });
  } catch (e) { next(e); }
});

/** Void penjualan (kembalikan stok + jurnal pembalik) */
router.post('/:id/void', requireRole('manager'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    await conn.beginTransaction();
    const [sales] = await conn.execute('SELECT * FROM sales WHERE id=? AND tenant_id=? FOR UPDATE', [req.params.id, t]);
    if (!sales.length) throw Object.assign(new Error('Penjualan tidak ditemukan'), { status: 404 });
    const sale = sales[0];
    if (sale.status !== 'completed') throw Object.assign(new Error('Hanya transaksi completed bisa dibatalkan'), { status: 400 });
    const [items] = await conn.execute('SELECT * FROM sale_items WHERE sale_id=?', [sale.id]);
    for (const it of items) {
      await conn.execute('UPDATE stocks SET qty = qty + ? WHERE store_id=? AND product_id=?', [it.qty, sale.store_id, it.product_id]);
      await conn.execute(
        'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        [t, sale.store_id, it.product_id, 'return_in', 'sale_void', sale.id, it.qty, it.cost, req.user.id]);
    }
    await conn.execute("UPDATE sales SET status='voided' WHERE id=?", [sale.id]);
    await conn.commit();
    // jurnal pembalik
    const accCash = await accountId(t, '1-1010');
    const accSales = await accountId(t, '4-1000');
    const accTaxOut = await accountId(t, '2-1100');
    const accCogs = await accountId(t, '5-1000');
    const accInv = await accountId(t, '1-1200');
    const totalCost = items.reduce((a, i) => a + round2(Number(i.cost) * Number(i.qty)), 0);
    const jl = [
      { account_id: accSales, debit: round2(Number(sale.subtotal) - Number(sale.discount)), credit: 0, memo: `Void ${sale.code}` },
      { account_id: accCash, debit: 0, credit: Number(sale.total), memo: `Void ${sale.code}` },
    ];
    if (Number(sale.tax_amount) > 0) jl.splice(1, 0, { account_id: accTaxOut, debit: Number(sale.tax_amount), credit: 0, memo: 'PPN' });
    if (totalCost > 0) jl.push({ account_id: accInv, debit: totalCost, credit: 0, memo: 'Pembatalan HPP' },
                               { account_id: accCogs, debit: 0, credit: totalCost, memo: 'Pembatalan HPP' });
    await postJournal({ tenantId: t, storeId: sale.store_id, refType: 'manual', refId: sale.id,
      description: `Pembatalan penjualan ${sale.code}`, lines: jl, userId: req.user.id });
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/** Retur sebagian: { sale_id, items:[{sale_item_id, qty}], reason } */
router.post('/returns', requireRole('cashier'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    const { sale_id, items, reason } = req.body;
    if (!sale_id || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Data retur tidak lengkap' });
    await conn.beginTransaction();
    const [sales] = await conn.execute("SELECT * FROM sales WHERE id=? AND tenant_id=? AND status='completed'", [sale_id, t]);
    if (!sales.length) throw Object.assign(new Error('Penjualan tidak ditemukan/ tidak aktif'), { status: 404 });
    const sale = sales[0];
    const code = await nextCode(conn, 'returns', 'RET', t);
    let refund = 0;
    const [retRes] = await conn.execute(
      'INSERT INTO returns (tenant_id,store_id,sale_id,code,reason,total_refund,created_by) VALUES (?,?,?,?,?,?,?)',
      [t, sale.store_id, sale_id, code, reason || '', 0, req.user.id]);
    const retId = retRes[0].insertId;
    for (const ri of items) {
      const [si] = await conn.execute('SELECT * FROM sale_items WHERE id=? AND sale_id=?', [ri.sale_item_id, sale_id]);
      if (!si.length) throw Object.assign(new Error('Item penjualan tidak ditemukan'), { status: 400 });
      const qty = Number(ri.qty);
      if (qty <= 0 || qty > Number(si[0].qty)) throw Object.assign(new Error('Qty retur tidak valid'), { status: 400 });
      const amt = round2(Number(si[0].price) * qty * (1 + Number(si[0].tax_rate) / 100));
      refund += amt;
      await conn.execute('INSERT INTO return_items (return_id,sale_item_id,product_id,qty,price) VALUES (?,?,?,?,?)',
        [retId, si[0].id, si[0].product_id, qty, si[0].price]);
      await conn.execute('UPDATE stocks SET qty = qty + ? WHERE store_id=? AND product_id=?',
        [qty, sale.store_id, si[0].product_id]);
      await conn.execute(
        'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        [t, sale.store_id, si[0].product_id, 'return_in', 'return', retId, qty, si[0].cost, req.user.id]);
      await conn.execute('UPDATE sale_items SET qty = qty - ? WHERE id=?', [qty, si[0].id]);
    }
    await conn.execute('UPDATE returns SET total_refund=? WHERE id=?', [round2(refund), retId]);
    await conn.commit();

    const accCash = await accountId(t, '1-1010');
    const accSales = await accountId(t, '4-1200'); // Potongan penjualan
    const accTaxOut = await accountId(t, '2-1100');
    const accCogs = await accountId(t, '5-1000');
    const accInv = await accountId(t, '1-1200');
    const jl = [
      { account_id: accSales, debit: round2(refund), credit: 0, memo: code },
      { account_id: accCash, debit: 0, credit: round2(refund), memo: code },
    ];
    await postJournal({ tenantId: t, storeId: sale.store_id, refType: 'manual', refId: retId,
      description: `Retur penjualan ${code}`, lines: jl, userId: req.user.id });
    res.json({ id: retId, code, refund: round2(refund) });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/* ---------------- SHIFT KASIR ---------------- */
router.get('/shifts/current', async (req, res, next) => {
  try {
    const rows = await q("SELECT * FROM shifts WHERE cashier_id=? AND status='open' ORDER BY id DESC LIMIT 1", [req.user.id]);
    res.json(rows[0] || null);
  } catch (e) { next(e); }
});

router.post('/shifts/open', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const storeId = await resolveStore(req, req.body.store_id);
    const [cur] = await q("SELECT id FROM shifts WHERE cashier_id=? AND status='open'", [req.user.id]);
    if (cur.length) return res.status(400).json({ error: 'Masih ada shift yang terbuka' });
    const r = await q('INSERT INTO shifts (tenant_id,store_id,cashier_id,opening_cash) VALUES (?,?,?,?)',
      [t, storeId, req.user.id, req.body.opening_cash || 0]);
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.post('/shifts/:id/close', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const [sh] = await q('SELECT * FROM shifts WHERE id=? AND tenant_id=? AND status="open"', [req.params.id, t]);
    if (!sh) return res.status(404).json({ error: 'Shift tidak ditemukan / sudah ditutup' });
    const [agg] = await q(
      `SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0) AS cash_sales
       FROM sales WHERE shift_id=? AND status='completed'`, [sh.id]);
    const expected = round2(Number(sh.opening_cash) + Number(agg[0].cash_sales));
    const counted = round2(req.body.counted_cash || 0);
    await q(`UPDATE shifts SET close_at=NOW(), expected_cash=?, counted_cash=?, difference=?, status='closed', note=? WHERE id=?`,
      [expected, counted, round2(counted - expected), req.body.note || '', sh.id]);
    res.json({ expected, counted, difference: round2(counted - expected) });
  } catch (e) { next(e); }
});

module.exports = router;
