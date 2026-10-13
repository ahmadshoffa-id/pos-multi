// Modul Inventory: Purchase Order, Goods Receipt, Retur Pembelian,
// Transfer Antar Store, Stock Opname, Laporan Stok & HPP
const express = require('express');
const { auth, requireRole, resolveStore } = require('../lib/auth');
const { getPool, q } = require('../db');
const { nextCode, accountId, postJournal } = require('../lib/accounting');

const router = express.Router();
router.use(auth);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ================= PURCHASE ORDER ================= */
router.get('/purchase-orders', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    let sql = `SELECT po.*, s.name AS supplier_name, st.name AS store_name
               FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
               JOIN stores st ON st.id=po.store_id WHERE po.tenant_id=?`;
    const p = [t];
    if (req.query.status) { sql += ' AND po.status=?'; p.push(req.query.status); }
    res.json(await q(sql + ' ORDER BY po.id DESC LIMIT 300', p));
  } catch (e) { next(e); }
});

router.get('/purchase-orders/:id', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const [po] = await q('SELECT * FROM purchase_orders WHERE id=? AND tenant_id=?', [req.params.id, t]);
    if (!po) return res.status(404).json({ error: 'PO tidak ditemukan' });
    const items = await q(`SELECT poi.*, p.name, p.sku, p.unit FROM purchase_order_items poi
                           JOIN products p ON p.id=poi.product_id WHERE poi.po_id=?`, [po.id]);
    res.json({ po, items });
  } catch (e) { next(e); }
});

router.post('/purchase-orders', requireRole('warehouse'), async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const b = req.body;
    const storeId = await resolveStore(req, b.store_id);
    if (!b.supplier_id || !Array.isArray(b.items) || !b.items.length)
      return res.status(400).json({ error: 'Supplier & item wajib diisi' });
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const poCode = await nextCode(conn, 'purchase_orders', 'PO', t);
      let total = 0, tax = 0;
      for (const it of b.items) { total += round2(Number(it.qty) * Number(it.price)); }
      tax = round2(total * Number(b.tax_rate || 0) / 100);
      const [r] = await conn.execute(
        `INSERT INTO purchase_orders (tenant_id,store_id,supplier_id,code,order_date,expected_date,total,tax_amount,status,note,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [t, storeId, b.supplier_id, poCode, b.order_date || new Date(), b.expected_date || null,
         total, tax, b.status === 'approved' ? 'approved' : 'draft', b.note || '', req.user.id]);
      for (const it of b.items) {
        await conn.execute('INSERT INTO purchase_order_items (po_id,product_id,qty,price) VALUES (?,?,?,?)',
          [r[0].insertId, it.product_id, it.qty, it.price]);
      }
      await conn.commit();
      res.json({ id: r[0].insertId, code: poCode, total: round2(total + tax) });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  } catch (e) { next(e); }
});

router.post('/purchase-orders/:id/approve', requireRole('manager'), async (req, res, next) => {
  try {
    await q("UPDATE purchase_orders SET status='approved' WHERE id=? AND tenant_id=? AND status='draft'",
      [req.params.id, req.user.tenantId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= GOODS RECEIPT (penerimaan barang) =================
   Menambah stok + update moving average + jurnal: Dr Persediaan, Dr PPN Masukan, Cr Hutang Usaha
*/
router.post('/goods-receipts', requireRole('warehouse'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    const b = req.body;
    const storeId = await resolveStore(req, b.store_id);
    await conn.beginTransaction();
    let po = null;
    if (b.po_id) {
      const [pr] = await conn.execute("SELECT * FROM purchase_orders WHERE id=? AND tenant_id=? FOR UPDATE", [b.po_id, t]);
      if (!pr.length) throw Object.assign(new Error('PO tidak ditemukan'), { status: 404 });
      if (!['approved', 'partial'].includes(pr[0].status)) throw Object.assign(new Error('PO belum di-approve'), { status: 400 });
      po = pr[0];
    }
    const items = b.items || [];
    if (!items.length) throw Object.assign(new Error('Tidak ada item diterima'), { status: 400 });
    const supplierId = b.supplier_id || (po && po.supplier_id);
    const code = await nextCode(conn, 'goods_receipts', 'GR', t);
    let total = 0, taxAmount = 0;
    const prepared = [];
    for (const it of items) {
      const qty = Number(it.qty);
      if (!(qty > 0)) throw Object.assign(new Error('Qty penerimaan tidak valid'), { status: 400 });
      const price = round2(it.price);
      const rate = Number(it.tax_rate ?? 0);
      const amt = round2(qty * price);
      const tax = round2(amt * rate / 100);
      total += amt; taxAmount += tax;
      prepared.push({ ...it, qty, price, amt, tax });
    }
    total = round2(total); taxAmount = round2(taxAmount);
    const [gr] = await conn.execute(
      `INSERT INTO goods_receipts (tenant_id,store_id,po_id,supplier_id,code,receive_date,total,tax_amount,created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [t, storeId, b.po_id || null, supplierId, code, b.receive_date || new Date(), total, taxAmount, req.user.id]);
    const grId = gr[0].insertId;

    for (const it of prepared) {
      await conn.execute('INSERT INTO goods_receipt_items (gr_id,product_id,qty,price) VALUES (?,?,?,?)',
        [grId, it.product_id, it.qty, it.price]);
      // upsert stok dengan moving average
      const [st] = await conn.execute('SELECT * FROM stocks WHERE store_id=? AND product_id=? FOR UPDATE', [storeId, it.product_id]);
      if (st.length) {
        const s = st[0];
        const oldQty = Number(s.qty), oldCost = Number(s.avg_cost);
        const newQty = oldQty + it.qty;
        const newAvg = newQty > 0 ? round2((oldQty * oldCost + it.qty * it.price) / newQty) : it.price;
        await conn.execute('UPDATE stocks SET qty=?, avg_cost=? WHERE id=?', [newQty, newAvg, s.id]);
      } else {
        await conn.execute('INSERT INTO stocks (tenant_id,store_id,product_id,qty,avg_cost) VALUES (?,?,?,?,?)',
          [t, storeId, it.product_id, it.qty, it.price]);
      }
      await conn.execute(
        'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        [t, storeId, it.product_id, 'po_receive', 'goods_receipt', grId, it.qty, it.price, req.user.id]);
      if (b.po_id) {
        await conn.execute('UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE po_id=? AND product_id=?',
          [it.qty, b.po_id, it.product_id]);
      }
    }
    if (b.po_id) {
      const [rem] = await conn.execute(
        `SELECT SUM(qty - received_qty) AS sisa FROM purchase_order_items WHERE po_id=?`, [b.po_id]);
      await conn.execute("UPDATE purchase_orders SET status=? WHERE id=?",
        [Number(rem[0].sisa) <= 0.001 ? 'received' : 'partial', b.po_id]);
    }
    await conn.commit();

    // Jurnal pembelian: Dr Persediaan, Dr PPN Masukan, Cr Hutang Usaha
    const accInv = await accountId(t, '1-1200');
    const accTaxIn = await accountId(t, '1-1500');
    const accAP = await accountId(t, '2-1000');
    const jl = [
      { account_id: accInv, debit: total, credit: 0, memo: code },
      { account_id: accAP, debit: 0, credit: round2(total + taxAmount), memo: code },
    ];
    if (taxAmount > 0) jl.push({ account_id: accTaxIn, debit: taxAmount, credit: 0, memo: 'PPN masukan' });
    await postJournal({ tenantId: t, storeId, refType: 'po_receive', refId: grId,
      description: `Penerimaan barang ${code}`, lines: jl, userId: req.user.id });

    res.json({ id: grId, code, total: round2(total + taxAmount) });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

router.get('/goods-receipts', async (req, res, next) => {
  try {
    res.json(await q(`SELECT gr.*, s.name AS supplier_name, st.name AS store_name
                      FROM goods_receipts gr JOIN suppliers s ON s.id=gr.supplier_id
                      JOIN stores st ON st.id=gr.store_id
                      WHERE gr.tenant_id=? ORDER BY gr.id DESC LIMIT 300`, [req.user.tenantId]));
  } catch (e) { next(e); }
});

/* ================= RETUR PEMBELIAN ================= */
router.post('/purchase-returns', requireRole('warehouse'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    const b = req.body;
    const storeId = await resolveStore(req, b.store_id);
    if (!b.supplier_id || !Array.isArray(b.items) || !b.items.length)
      return res.status(400).json({ error: 'Supplier & item retur wajib diisi' });
    await conn.beginTransaction();
    const code = await nextCode(conn, 'purchase_returns', 'PRB', t);
    let total = 0;
    const [r] = await conn.execute(
      'INSERT INTO purchase_returns (tenant_id,store_id,gr_id,supplier_id,code,ret_date,total,reason,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [t, storeId, b.gr_id || null, b.supplier_id, code, b.ret_date || new Date(), 0, b.reason || '', req.user.id]);
    for (const it of b.items) {
      const qty = Number(it.qty), price = round2(it.price);
      if (!(qty > 0)) throw Object.assign(new Error('Qty retur tidak valid'), { status: 400 });
      const [st] = await conn.execute('SELECT * FROM stocks WHERE store_id=? AND product_id=? FOR UPDATE', [storeId, it.product_id]);
      if (!st.length || Number(st[0].qty) < qty) throw Object.assign(new Error('Stok untuk retur tidak cukup'), { status: 400 });
      await conn.execute('UPDATE stocks SET qty = qty - ? WHERE id=?', [qty, st[0].id]);
      await conn.execute('INSERT INTO purchase_return_items (pr_id,product_id,qty,price) VALUES (?,?,?,?)',
        [r[0].insertId, it.product_id, qty, price]);
      await conn.execute(
        'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        [t, storeId, it.product_id, 'return_out', 'purchase_return', r[0].insertId, -qty, price, req.user.id]);
      total += round2(qty * price);
    }
    await conn.execute('UPDATE purchase_returns SET total=? WHERE id=?', [round2(total), r[0].insertId]);
    await conn.commit();
    const accInv = await accountId(t, '1-1200');
    const accAP = await accountId(t, '2-1000');
    await postJournal({ tenantId: t, storeId, refType: 'purchase_return', refId: r[0].insertId,
      description: `Retur pembelian ${code}`,
      lines: [{ account_id: accAP, debit: round2(total), credit: 0, memo: code },
              { account_id: accInv, debit: 0, credit: round2(total), memo: code }], userId: req.user.id });
    res.json({ id: r[0].insertId, code, total: round2(total) });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/* ================= TRANSFER ANTAR STORE ================= */
router.get('/transfers', async (req, res, next) => {
  try {
    res.json(await q(`SELECT tr.*, sf.name AS from_name, s2.name AS to_name
                      FROM stock_transfers tr JOIN stores sf ON sf.id=tr.from_store_id
                      JOIN stores s2 ON s2.id=tr.to_store_id
                      WHERE tr.tenant_id=? ORDER BY tr.id DESC LIMIT 200`, [req.user.tenantId]));
  } catch (e) { next(e); }
});

router.post('/transfers', requireRole('warehouse'), async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const b = req.body;
    const from = await resolveStore(req, b.from_store_id);
    const to = await resolveStore(req, b.to_store_id);
    if (from === to) return res.status(400).json({ error: 'Store asal & tujuan sama' });
    if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'Item transfer kosong' });
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const code = await nextCode(conn, 'stock_transfers', 'TRF', t);
      const [r] = await conn.execute(
        'INSERT INTO stock_transfers (tenant_id,code,from_store_id,to_store_id,status,note,requested_by) VALUES (?,?,?,?,?,?,?)',
        [t, code, from, to, 'pending', b.note || '', req.user.id]);
      for (const it of b.items) {
        const [st] = await conn.execute('SELECT * FROM stocks WHERE store_id=? AND product_id=? FOR UPDATE', [from, it.product_id]);
        if (!st.length || Number(st[0].qty) < Number(it.qty))
          throw Object.assign(new Error(`Stok asal tidak cukup`), { status: 400 });
        await conn.execute('UPDATE stocks SET qty = qty - ? WHERE id=?', [Number(it.qty), st[0].id]);
        await conn.execute('INSERT INTO stock_transfer_items (transfer_id,product_id,qty) VALUES (?,?,?)',
          [r[0].insertId, it.product_id, it.qty]);
        await conn.execute(
          'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
          [t, from, it.product_id, 'transfer_out', 'transfer', r[0].insertId, -Number(it.qty), st[0].avg_cost, req.user.id]);
      }
      await conn.commit();
      res.json({ id: r[0].insertId, code });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  } catch (e) { next(e); }
});

router.post('/transfers/:id/receive', requireRole('warehouse'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    await conn.beginTransaction();
    const [tr] = await conn.execute("SELECT * FROM stock_transfers WHERE id=? AND tenant_id=? AND status IN ('pending','approved') FOR UPDATE", [req.params.id, t]);
    if (!tr.length) throw Object.assign(new Error('Transfer tidak ditemukan'), { status: 404 });
    const [items] = await conn.execute('SELECT * FROM stock_transfer_items WHERE transfer_id=?', [tr[0].id]);
    for (const it of items) {
      const [src] = await conn.execute('SELECT avg_cost FROM stocks WHERE store_id=? AND product_id=?', [tr[0].from_store_id, it.product_id]);
      const cost = src.length ? Number(src[0].avg_cost) : 0;
      const [st] = await conn.execute('SELECT * FROM stocks WHERE store_id=? AND product_id=? FOR UPDATE', [tr[0].to_store_id, it.product_id]);
      if (st.length) {
        const s = st[0];
        const newQty = Number(s.qty) + Number(it.qty);
        const newAvg = newQty > 0 ? round2((Number(s.qty) * Number(s.avg_cost) + Number(it.qty) * cost) / newQty) : cost;
        await conn.execute('UPDATE stocks SET qty=?, avg_cost=? WHERE id=?', [newQty, newAvg, s.id]);
      } else {
        await conn.execute('INSERT INTO stocks (tenant_id,store_id,product_id,qty,avg_cost) VALUES (?,?,?,?,?)',
          [t, tr[0].to_store_id, it.product_id, it.qty, cost]);
      }
      await conn.execute(
        'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        [t, tr[0].to_store_id, it.product_id, 'transfer_in', 'transfer', tr[0].id, Number(it.qty), cost, req.user.id]);
    }
    await conn.execute("UPDATE stock_transfers SET status='received', received_by=? WHERE id=?", [req.user.id, tr[0].id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/* ================= STOCK OPNAME ================= */
router.get('/opnames', async (req, res, next) => {
  try {
    res.json(await q(`SELECT o.*, s.name AS store_name FROM stock_opnames o JOIN stores s ON s.id=o.store_id
                      WHERE o.tenant_id=? ORDER BY o.id DESC LIMIT 200`, [req.user.tenantId]));
  } catch (e) { next(e); }
});

router.post('/opnames', requireRole('warehouse'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    const b = req.body;
    const storeId = await resolveStore(req, b.store_id);
    await conn.beginTransaction();
    const code = await nextCode(conn, 'stock_opnames', 'SOP', t);
    const [r] = await conn.execute(
      'INSERT INTO stock_opnames (tenant_id,store_id,code,opname_date,status,note,created_by) VALUES (?,?,?,?,?,?,?)',
      [t, storeId, code, b.opname_date || new Date(), 'draft', b.note || '', req.user.id]);
    let gain = 0, loss = 0;
    for (const it of (b.items || [])) {
      const [st] = await conn.execute('SELECT * FROM stocks WHERE store_id=? AND product_id=?', [storeId, it.product_id]);
      if (!st.length) continue;
      const sys = Number(st[0].qty), act = Number(it.actual_qty), diff = round2(act - sys);
      await conn.execute('INSERT INTO stock_opname_items (opname_id,product_id,system_qty,actual_qty,diff_qty,cost) VALUES (?,?,?,?,?,?)',
        [r[0].insertId, it.product_id, sys, act, diff, st[0].avg_cost]);
      const amt = Math.abs(diff) * Number(st[0].avg_cost);
      if (diff > 0) gain += amt; else loss += amt;
    }
    await conn.commit();

    // Posting opname: sesuaikan stok & jurnal selisih
    if (b.post) {
      const [items] = await conn.execute('SELECT * FROM stock_opname_items WHERE opname_id=?', [r[0].insertId]);
      await conn.beginTransaction();
      for (const it of items) {
        if (Number(it.diff_qty) === 0) continue;
        await conn.execute('UPDATE stocks SET qty=? WHERE store_id=? AND product_id=?',
          [Number(it.actual_qty), storeId, it.product_id]);
        await conn.execute(
          'INSERT INTO stock_movements (tenant_id,store_id,product_id,type,ref_type,ref_id,qty,cost,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
          [t, storeId, it.product_id, 'adjustment', 'opname', r[0].insertId, Number(it.diff_qty), it.cost, req.user.id]);
      }
      await conn.execute("UPDATE stock_opnames SET status='posted' WHERE id=?", [r[0].insertId]);
      await conn.commit();
      const accInv = await accountId(t, '1-1200');
      const accLoss = await accountId(t, '5-1600');
      const accGain = await accountId(t, '4-1100');
      const jl = [];
      if (loss > 0) jl.push({ account_id: accLoss, debit: round2(loss), credit: 0, memo: 'Selisih minus opname' },
                            { account_id: accInv, debit: 0, credit: round2(loss), memo: '' });
      if (gain > 0) jl.push({ account_id: accInv, debit: round2(gain), credit: 0, memo: 'Selisih plus opname' },
                            { account_id: accGain, debit: 0, credit: round2(gain), memo: '' });
      if (jl.length) await postJournal({ tenantId: t, storeId, refType: 'manual', refId: r[0].insertId,
        description: `Opname ${code}`, lines: jl, userId: req.user.id });
    }
    res.json({ id: r[0].insertId, code });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/* ================= LAPORAN STOK ================= */
router.get('/reports/valuation', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    let sql = `SELECT st.store_id, s.name AS store_name, COUNT(*) AS n_produk,
                      SUM(st.qty) AS total_qty, SUM(st.qty * st.avg_cost) AS nilai_persediaan
               FROM stocks st JOIN stores s ON s.id=st.store_id
               WHERE st.tenant_id=?`;
    const p = [t];
    if (req.query.store_id) { sql += ' AND st.store_id=?'; p.push(req.query.store_id); }
    sql += ' GROUP BY st.store_id, s.name';
    res.json(await q(sql, p));
  } catch (e) { next(e); }
});

router.get('/reports/movements', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    let sql = `SELECT m.*, p.name AS product_name, p.sku, s.name AS store_name
               FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN stores s ON s.id=m.store_id
               WHERE m.tenant_id=?`;
    const p = [t];
    if (req.query.store_id) { sql += ' AND m.store_id=?'; p.push(req.query.store_id); }
    if (req.query.product_id) { sql += ' AND m.product_id=?'; p.push(req.query.product_id); }
    if (req.query.from) { sql += ' AND DATE(m.created_at)>=?'; p.push(req.query.from); }
    if (req.query.to) { sql += ' AND DATE(m.created_at)<=?'; p.push(req.query.to); }
    sql += ' ORDER BY m.id DESC LIMIT 500';
    res.json(await q(sql, p));
  } catch (e) { next(e); }
});

module.exports = router;
