// Laporan: Laba Rugi, Neraca, Trial Balance, Penjualan, Stok, Hutang/Piutang
const express = require('express');
const { auth } = require('../lib/auth');
const { q } = require('../db');
const { accountBalances } = require('../lib/accounting');

const router = express.Router();
router.use(auth);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ---------- TRIAL BALANCE (neraca saldo) ---------- */
router.get('/trial-balance', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const { from, to } = req.query;
    const bals = await accountBalances(t, from || null, to || null);
    let td = 0, tc = 0;
    const rows = bals.map(b => {
      const debit = b.balance > 0 && (b.type === 'asset' || b.type === 'expense') ? b.balance :
                    b.balance < 0 && (b.type === 'liability' || b.type === 'equity' || b.type === 'revenue') ? -b.balance : 0;
      const credit = b.balance > 0 && (b.type === 'liability' || b.type === 'equity' || b.type === 'revenue') ? b.balance :
                     b.balance < 0 && (b.type === 'asset' || b.type === 'expense') ? -b.balance : 0;
      td += debit; tc += credit;
      return { code: b.code, name: b.name, type: b.type, debit: r2(debit), credit: r2(credit) };
    });
    res.json({ rows, total_debit: r2(td), total_credit: r2(tc), balanced: Math.abs(td - tc) < 0.5 });
  } catch (e) { next(e); }
});

/* ---------- LABA RUGI ---------- */
router.get('/profit-loss', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'Parameter from & to (tanggal) wajib' });
    const bals = await accountBalances(t, from, to);
    const rev = bals.filter(b => b.type === 'revenue');
    const exp = bals.filter(b => b.type === 'expense');
    const totalRevenue = r2(rev.reduce((a, b) => a + b.balance, 0));
    const cogsRow = exp.find(b => b.subtype === 'cogs');
    const cogs = r2(cogsRow ? cogsRow.balance : 0);
    const opex = r2(exp.filter(b => b.subtype !== 'cogs').reduce((a, b) => a + b.balance, 0));
    const grossProfit = r2(totalRevenue - cogs);
    const netProfit = r2(grossProfit - opex);
    res.json({
      period: { from, to },
      revenue: rev.map(b => ({ code: b.code, name: b.name, amount: r2(b.balance) })),
      total_revenue: totalRevenue,
      cogs,
      gross_profit: grossProfit,
      expenses: exp.filter(b => b.subtype !== 'cogs').map(b => ({ code: b.code, name: b.name, amount: r2(b.balance) })),
      total_opex: opex,
      net_profit: netProfit,
    });
  } catch (e) { next(e); }
});

/* ---------- NERACA ---------- */
router.get('/balance-sheet', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const asOf = req.query.to || new Date().toISOString().slice(0, 10);
    // Laba berjalan sampai tanggal tsb dihitung dari seluruh jurnal s/d asOf
    const bals = await accountBalances(t, null, asOf);
    const assets = bals.filter(b => b.type === 'asset');
    const liab = bals.filter(b => b.type === 'liability');
    const equity = bals.filter(b => b.type === 'equity');
    const retainedEarnings = r2(
      bals.filter(b => b.type === 'revenue').reduce((a, b) => a + b.balance, 0) -
      bals.filter(b => b.type === 'expense').reduce((a, b) => a + b.balance, 0));
    const totalAssets = r2(assets.reduce((a, b) => a + b.balance, 0));
    const totalLiab = r2(liab.reduce((a, b) => a + b.balance, 0));
    const totalEquity = r2(equity.reduce((a, b) => a + b.balance, 0) + retainedEarnings);
    res.json({
      as_of: asOf,
      assets: assets.map(b => ({ code: b.code, name: b.name, amount: r2(b.balance) })),
      total_assets: totalAssets,
      liabilities: liab.map(b => ({ code: b.code, name: b.name, amount: r2(b.balance) })),
      total_liabilities: totalLiab,
      equity: equity.map(b => ({ code: b.code, name: b.name, amount: r2(b.balance) })),
      retained_earnings: retainedEarnings,
      total_equity: totalEquity,
      balanced: Math.abs(totalAssets - (totalLiab + totalEquity)) < 0.5,
    });
  } catch (e) { next(e); }
});

/* ---------- LAPORAN PENJUALAN ---------- */
router.get('/sales-summary', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const { from, to, store_id } = req.query;
    let sql = `SELECT DATE(s.created_at) AS day, st.name AS store_name, COUNT(*) AS transaksi,
                      SUM(s.subtotal) AS subtotal, SUM(s.discount) AS discount,
                      SUM(s.tax_amount) AS tax, SUM(s.total) AS omset,
                      SUM((SELECT COALESCE(SUM(si.qty*si.cost),0) FROM sale_items si WHERE si.sale_id=s.id)) AS hpp
               FROM sales s JOIN stores st ON st.id=s.store_id
               WHERE s.tenant_id=? AND s.status='completed'`;
    const p = [t];
    if (from) { sql += ' AND DATE(s.created_at)>=?'; p.push(from); }
    if (to) { sql += ' AND DATE(s.created_at)<=?'; p.push(to); }
    if (store_id) { sql += ' AND s.store_id=?'; p.push(store_id); }
    sql += ' GROUP BY day, st.name ORDER BY day DESC LIMIT 365';
    const rows = await q(sql, p);
    // produk terlaris
    let sql2 = `SELECT p.name, p.sku, SUM(si.qty) AS qty, SUM(si.qty*si.price) AS revenue
                FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id
                WHERE s.tenant_id=? AND s.status='completed'`;
    const p2 = [t];
    if (from) { sql2 += ' AND DATE(s.created_at)>=?'; p2.push(from); }
    if (to) { sql2 += ' AND DATE(s.created_at)<=?'; p2.push(to); }
    if (store_id) { sql2 += ' AND s.store_id=?'; p2.push(store_id); }
    sql2 += ' GROUP BY p.id ORDER BY qty DESC LIMIT 20';
    const top = await q(sql2, p2);
    res.json({ daily: rows, top_products: top });
  } catch (e) { next(e); }
});

/* ---------- HUTANG SUPPLIER ---------- */
router.get('/supplier-balances', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const apAcc = await q("SELECT id FROM chart_of_accounts WHERE tenant_id=? AND code='2-1000'", [t]);
    if (!apAcc.length) return res.json([]);
    const rows = await q(
      `SELECT sp.id, sp.name, sp.phone,
              COALESCE((SELECT SUM(jl.credit)-SUM(jl.debit) FROM journal_lines jl
                        JOIN journals j ON j.id=jl.journal_id
                        WHERE jl.account_id=? AND j.tenant_id=? AND j.ref_type IN ('po_receive','purchase_return')),0) AS saldo_hutang
       FROM suppliers sp WHERE sp.tenant_id=?`,
      [apAcc[0].id, t, t]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---------- PIUTANG PELANGGAN ---------- */
router.get('/customer-balances', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const arAcc = await q("SELECT id FROM chart_of_accounts WHERE tenant_id=? AND code='1-1100'", [t]);
    if (!arAcc.length) return res.json([]);
    const rows = await q(
      `SELECT c.id, c.name, c.phone, c.credit_limit,
              COALESCE((SELECT SUM(jl.debit)-SUM(jl.credit) FROM journal_lines jl
                        JOIN journals j ON j.id=jl.journal_id
                        WHERE jl.account_id=? AND j.tenant_id=? AND j.ref_type IN ('sale','payment_in')),0) AS saldo_piutang
       FROM customers c WHERE c.tenant_id=?`,
      [arAcc[0].id, t, t]);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---------- DASHBOARD ---------- */
router.get('/dashboard', async (req, res, next) => {
  try {
    const t = req.user.tenantId;
    const today = new Date().toISOString().slice(0, 10);
    const monthFrom = today.slice(0, 8) + '01';
    const [[omsetToday]] = await q(
      "SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE tenant_id=? AND status='completed' AND DATE(created_at)=?", [t, today]);
    const [[omsetMonth]] = await q(
      "SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE tenant_id=? AND status='completed' AND DATE(created_at)>=?", [t, monthFrom]);
    const [[stokValue]] = await q(
      'SELECT COALESCE(SUM(qty*avg_cost),0) AS v FROM stocks WHERE tenant_id=?', [t]);
    const lowStock = await q(
      `SELECT p.name, s.qty, s.min_stock, st.name AS store_name FROM stocks s
       JOIN products p ON p.id=s.product_id JOIN stores st ON st.id=s.store_id
       WHERE s.tenant_id=? AND s.qty <= s.min_stock AND s.min_stock > 0 ORDER BY s.qty LIMIT 20`, [t]);
    const pl = await accountBalances(t, monthFrom, today);
    const revenue = pl.filter(b => b.type === 'revenue').reduce((a, b) => a + b.balance, 0);
    const expense = pl.filter(b => b.type === 'expense').reduce((a, b) => a + b.balance, 0);
    const recent = await q(
      `SELECT s.code, s.total, s.payment_method, s.created_at, st.name AS store_name
       FROM sales s JOIN stores st ON st.id=s.store_id
       WHERE s.tenant_id=? ORDER BY s.id DESC LIMIT 10`, [t]);
    res.json({
      omset_today: r2(omsetToday.v), omset_month: r2(omsetMonth.v),
      stock_value: r2(stokValue.v),
      month_revenue: r2(revenue), month_expense: r2(expense), month_profit: r2(revenue - expense),
      low_stock: lowStock, recent_sales: recent,
    });
  } catch (e) { next(e); }
});

module.exports = router;
