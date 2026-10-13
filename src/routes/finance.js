// Modul Keuangan: COA, Jurnal Manual, Beban, Penerimaan Kas (piutang),
// Pembayaran Supplier (hutang)
const express = require('express');
const { auth, requireRole } = require('../lib/auth');
const { q, getPool } = require('../db');
const { nextCode, accountId, postJournal } = require('../lib/accounting');

const router = express.Router();
router.use(auth);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ================= CHART OF ACCOUNTS ================= */
router.get('/accounts', async (req, res, next) => {
  try {
    res.json(await q('SELECT * FROM chart_of_accounts WHERE tenant_id=? ORDER BY code', [req.user.tenantId]));
  } catch (e) { next(e); }
});

router.post('/accounts', requireRole('accounting'), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.code || !b.name || !b.type) return res.status(400).json({ error: 'code, name, type wajib' });
    const r = await q('INSERT INTO chart_of_accounts (tenant_id,code,name,type,subtype,is_header) VALUES (?,?,?,?,?,?)',
      [req.user.tenantId, b.code, b.name, b.type, b.subtype || '', b.is_header ? 1 : 0]);
    res.json({ id: r.insertId });
  } catch (e) { next(e); }
});

/* ================= JURNAL MANUAL ================= */
router.post('/journals', requireRole('accounting'), async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const b = req.body;
    if (!Array.isArray(b.lines) || b.lines.length < 2)
      return res.status(400).json({ error: 'Jurnal minimal 2 baris' });
    const lines = b.lines.map(l => ({
      account_id: Number(l.account_id),
      debit: round2(l.debit || 0), credit: round2(l.credit || 0), memo: l.memo || ''
    })).filter(l => l.debit > 0 || l.credit > 0);
    const td = round2(lines.reduce((a, l) => a + l.debit, 0));
    const tc = round2(lines.reduce((a, l) => a + l.credit, 0));
    if (Math.abs(td - tc) > 0.01) return res.status(400).json({ error: `Jurnal tidak balance (D ${td} vs K ${tc})` });
    const j = await postJournal({ tenantId: t, storeId: b.store_id || null, date: b.date,
      refType: 'manual', description: b.description || 'Jurnal manual', lines, userId: req.user.id });
    res.json(j);
  } catch (e) { next(e); }
});

/* ================= BEBAN / PENGELUARAN ================= */
router.get('/expenses', async (req, res, next) => {
  try {
    let sql = `SELECT e.*, s.name AS store_name, sp.name AS supplier_name
               FROM expenses e JOIN stores s ON s.id=e.store_id
               LEFT JOIN suppliers sp ON sp.id=e.supplier_id
               WHERE e.tenant_id=?`;
    const p = [req.user.tenantId];
    if (req.query.from) { sql += ' AND e.expense_date>=?'; p.push(req.query.from); }
    if (req.query.to) { sql += ' AND e.expense_date<=?'; p.push(req.query.to); }
    res.json(await q(sql + ' ORDER BY e.id DESC LIMIT 300', p));
  } catch (e) { next(e); }
});

router.post('/expenses', requireRole('accounting'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    const b = req.body;
    if (!b.amount || !b.store_id || !b.account_id)
      return res.status(400).json({ error: 'store_id, account_id, amount wajib' });
    await conn.beginTransaction();
    const code = await nextCode(conn, 'expenses', 'BEB', t);
    const [r] = await conn.execute(
      `INSERT INTO expenses (tenant_id,store_id,code,expense_date,category,account_id,supplier_id,amount,pay_method,description,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [t, b.store_id, code, b.expense_date || new Date(), b.category || '', b.account_id,
       b.supplier_id || null, round2(b.amount), b.pay_method || 'cash', b.description || '', req.user.id]);
    await conn.commit();
    // jurnal: Dr Beban, Cr Kas/Bank
    const accCashCode = b.pay_method === 'transfer' ? '1-1020' : '1-1010';
    const accCash = await accountId(t, accCashCode);
    await postJournal({ tenantId: t, storeId: b.store_id, refType: 'expense', refId: r[0].insertId,
      description: `Beban ${code}: ${b.description || b.category || ''}`,
      lines: [{ account_id: Number(b.account_id), debit: round2(b.amount), credit: 0, memo: code },
              { account_id: accCash, debit: 0, credit: round2(b.amount), memo: code }], userId: req.user.id });
    res.json({ id: r[0].insertId, code });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/* ================= PEMBAYARAN PELANGGAN (piutang) ================= */
router.get('/payments-in', async (req, res, next) => {
  try {
    res.json(await q(`SELECT pi.*, c.name AS customer_name FROM payments_in pi
                      JOIN customers c ON c.id=pi.customer_id
                      WHERE pi.tenant_id=? ORDER BY pi.id DESC LIMIT 300`, [req.user.tenantId]));
  } catch (e) { next(e); }
});

router.post('/payments-in', requireRole('accounting'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    const b = req.body;
    if (!b.customer_id || !b.amount) return res.status(400).json({ error: 'customer_id & amount wajib' });
    await conn.beginTransaction();
    const code = await nextCode(conn, 'payments_in', 'MSK', t);
    const [r] = await conn.execute(
      `INSERT INTO payments_in (tenant_id,store_id,code,customer_id,pay_date,amount,pay_method,reference,description,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [t, b.store_id || null, code, b.customer_id, b.pay_date || new Date(), round2(b.amount),
       b.pay_method || 'cash', b.reference || '', b.description || '', req.user.id]);
    await conn.commit();
    const accAR = await accountId(t, '1-1100');
    const accCash = await accountId(t, b.pay_method === 'transfer' ? '1-1020' : '1-1010');
    await postJournal({ tenantId: t, storeId: b.store_id || null, refType: 'payment_in', refId: r[0].insertId,
      description: `Pembayaran pelanggan ${code}`,
      lines: [{ account_id: accCash, debit: round2(b.amount), credit: 0, memo: code },
              { account_id: accAR, debit: 0, credit: round2(b.amount), memo: code }], userId: req.user.id });
    res.json({ id: r[0].insertId, code });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/* ================= PEMBAYARAN SUPPLIER (hutang) ================= */
router.get('/payments-out', async (req, res, next) => {
  try {
    res.json(await q(`SELECT po.*, s.name AS supplier_name FROM payments_out po
                      JOIN suppliers s ON s.id=po.supplier_id
                      WHERE po.tenant_id=? ORDER BY po.id DESC LIMIT 300`, [req.user.tenantId]));
  } catch (e) { next(e); }
});

router.post('/payments-out', requireRole('accounting'), async (req, res, next) => {
  const conn = await getPool().getConnection();
  try {
    const t = req.user.tenantId;
    const b = req.body;
    if (!b.supplier_id || !b.amount) return res.status(400).json({ error: 'supplier_id & amount wajib' });
    await conn.beginTransaction();
    const code = await nextCode(conn, 'payments_out', 'OUT', t);
    const [r] = await conn.execute(
      `INSERT INTO payments_out (tenant_id,store_id,code,supplier_id,gr_id,pay_date,amount,pay_method,reference,description,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [t, b.store_id || null, code, b.supplier_id, b.gr_id || null, b.pay_date || new Date(),
       round2(b.amount), b.pay_method || 'transfer', b.reference || '', b.description || '', req.user.id]);
    await conn.commit();
    const accAP = await accountId(t, '2-1000');
    const accCash = await accountId(t, b.pay_method === 'transfer' ? '1-1020' : '1-1010');
    await postJournal({ tenantId: t, storeId: b.store_id || null, refType: 'manual', refId: r[0].insertId,
      description: `Pembayaran supplier ${code}`,
      lines: [{ account_id: accAP, debit: round2(b.amount), credit: 0, memo: code },
              { account_id: accCash, debit: 0, credit: round2(b.amount), memo: code }], userId: req.user.id });
    res.json({ id: r[0].insertId, code });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
});

/* ================= BUKTI JURNAL: daftar & detail ================= */
router.get('/journals', async (req, res, next) => {
  try {
    let sql = `SELECT j.*, u.full_name AS created_by_name,
                      (SELECT SUM(debit) FROM journal_lines WHERE journal_id=j.id) AS total_debit
               FROM journals j LEFT JOIN users u ON u.id=j.created_by
               WHERE j.tenant_id=?`;
    const p = [req.user.tenantId];
    if (req.query.from) { sql += ' AND j.journal_date>=?'; p.push(req.query.from); }
    if (req.query.to) { sql += ' AND j.journal_date<=?'; p.push(req.query.to); }
    if (req.query.ref_type) { sql += ' AND j.ref_type=?'; p.push(req.query.ref_type); }
    sql += ' ORDER BY j.journal_date DESC, j.id DESC LIMIT 300';
    res.json(await q(sql, p));
  } catch (e) { next(e); }
});

router.get('/journals/:id', async (req, res, next) => {
  try {
    const [j] = await q('SELECT * FROM journals WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenantId]);
    if (!j) return res.status(404).json({ error: 'Jurnal tidak ditemukan' });
    const lines = await q(`SELECT jl.*, ca.code AS account_code, ca.name AS account_name
                           FROM journal_lines jl JOIN chart_of_accounts ca ON ca.id=jl.account_id
                           WHERE jl.journal_id=?`, [j.id]);
    res.json({ journal: j, lines });
  } catch (e) { next(e); }
});

module.exports = router;
