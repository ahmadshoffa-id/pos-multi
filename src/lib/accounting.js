// Helper akuntansi: buat nomor dokumen, posting jurnal, laporan
const { q, getPool } = require('../db');

async function nextCode(conn, table, prefix, tenantId) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS c FROM \`${table}\` WHERE tenant_id = ?`, [tenantId]
  );
  const d = new Date();
  const ymd = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0');
  return `${prefix}-${ymd}-${String(rows[0].c + 1).padStart(5, '0')}`;
}

// Ambil id akun berdasarkan kode untuk tenant
async function accountId(tenantId, code) {
  const rows = await q('SELECT id FROM chart_of_accounts WHERE tenant_id = ? AND code = ?', [tenantId, code]);
  if (!rows.length) throw Object.assign(new Error(`Akun ${code} tidak ditemukan pada COA tenant`), { status: 500 });
  return rows[0].id;
}

/**
 * Posting jurnal double-entry.
 * lines: [{account_id, debit, credit, memo}]
 */
async function postJournal({ tenantId, storeId = null, date, refType, refId = null, description, lines, userId }, conn = null) {
  const own = !conn;
  if (own) { conn = await getPool().getConnection(); await conn.beginTransaction(); }
  try {
    const code = await nextCode(conn, 'journals', 'JRN', tenantId);
    const jdate = date || new Date().toISOString().slice(0, 10);
    const [res] = await conn.execute(
      'INSERT INTO journals (tenant_id, store_id, code, journal_date, ref_type, ref_id, description, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [tenantId, storeId, code, jdate, refType, refId, description, userId]
    );
    const jid = res.insertId;
    let totalD = 0, totalC = 0;
    for (const l of lines) {
      const d = Number(l.debit || 0), c = Number(l.credit || 0);
      if (d === 0 && c === 0) continue;
      totalD += d; totalC += c;
      await conn.execute(
        'INSERT INTO journal_lines (journal_id, account_id, debit, credit, memo) VALUES (?,?,?,?,?)',
        [jid, l.account_id, d, c, l.memo || '']
      );
    }
    if (Math.abs(totalD - totalC) > 0.01) throw Object.assign(new Error('Jurnal tidak balance'), { status: 400 });
    if (own) await conn.commit();
    return { id: jid, code };
  } catch (e) {
    if (own) await conn.rollback();
    throw e;
  } finally {
    if (own) conn.release();
  }
}

// Saldo per akun (debit-positive) sampai tanggal tertentu
async function accountBalances(tenantId, fromDate = null, toDate = null) {
  let sql = `SELECT jl.account_id, ca.name, ca.code, ca.type,
                    SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
             FROM journal_lines jl
             JOIN journals j ON j.id = jl.journal_id
             JOIN chart_of_accounts ca ON ca.id = jl.account_id
             WHERE j.tenant_id = ? AND j.posted = 1`;
  const params = [tenantId];
  if (fromDate) { sql += ' AND j.journal_date >= ?'; params.push(fromDate); }
  if (toDate)   { sql += ' AND j.journal_date <= ?'; params.push(toDate); }
  sql += ' GROUP BY jl.account_id, ca.name, ca.code, ca.type';
  const rows = await q(sql, params);
  return rows.map(r => {
    const bal = Number(r.debit) - Number(r.credit); // saldo normal debit
    const normal = (r.type === 'asset' || r.type === 'expense') ? bal : -bal;
    return { ...r, balance: normal };
  });
}

module.exports = { nextCode, accountId, postJournal, accountBalances };
