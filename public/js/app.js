/* ============================================================
   POS SaaS Multi-Store — Frontend SPA (vanilla JS)
   ============================================================ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmt = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';

let STATE = { user: null, stores: [], storeId: null, token: null };

/* ---------------- API helper ---------------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(STATE.token ? { Authorization: 'Bearer ' + STATE.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

function toast(msg, cls = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + cls;
  setTimeout(() => t.classList.add('hidden'), 3500);
}

function openModal(title, bodyHtml, onSave) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modal').classList.remove('hidden');
  $('#modalSave').onclick = async () => {
    try { await onSave(); closeModal(); } catch (e) { toast(e.message, 'bad'); }
  };
}
function closeModal() { $('#modal').classList.add('hidden'); }
window.closeModal = closeModal;

function modalField(name, label, value = '', type = 'text', required = true) {
  return `<div class="form-row"><label>${label}</label>
    <input class="input" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}></div>`;
}
function modalSelect(name, label, options, sel = '') {
  return `<div class="form-row"><label>${label}</label><select class="input" name="${name}">` +
    options.map(o => `<option value="${o.v}" ${String(o.v) === String(sel) ? 'selected' : ''}>${esc(o.t)}</option>`).join('') +
    '</select></div>';
}
function formVals(root) {
  const v = {};
  root.querySelectorAll('[name]').forEach(el => v[el.name] = el.value);
  return v;
}

/* ---------------- AUTH ---------------- */
async function tryBoot() {
  try {
    const me = await api('/auth/me');
    STATE.user = me.user; STATE.stores = me.stores;
    showApp();
  } catch (e) {
    $('#loginPage').classList.remove('hidden');
    $('#appPage').classList.add('hidden');
  }
}

$('#btnLogin').onclick = async () => {
  $('#loginErr').textContent = '';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: $('#loginUser').value, password: $('#loginPass').value } });
    STATE.token = r.token; STATE.user = r.user;
    const me = await api('/auth/me');
    STATE.user = me.user; STATE.stores = me.stores;
    $('#loginPage').classList.add('hidden');
    showApp();
  } catch (e) { $('#loginErr').textContent = e.message; }
};
$('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnLogin').click(); });
$('#btnLogout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };

/* ---------------- NAVIGASI ---------------- */
const MENU = [
  { group: 'Utama' },
  { id: 'dashboard', label: '📊 Dashboard', roles: '*' },
  { id: 'pos', label: '🧾 Kasir (POS)', roles: ['superadmin', 'owner', 'admin', 'manager', 'cashier'] },
  { group: 'Penjualan' },
  { id: 'sales-list', label: 'Riwayat Penjualan', roles: '*' },
  { id: 'shift', label: 'Shift & Tutup Kas', roles: ['superadmin', 'owner', 'admin', 'manager', 'cashier'] },
  { group: 'Inventory' },
  { id: 'products', label: 'Produk', roles: '*' },
  { id: 'stocks', label: 'Stok Gudang', roles: '*' },
  { id: 'purchase', label: 'Pembelian (PO & GR)', roles: ['superadmin', 'owner', 'admin', 'manager', 'warehouse', 'accounting'] },
  { id: 'transfers', label: 'Transfer Antar Store', roles: ['superadmin', 'owner', 'admin', 'manager', 'warehouse'] },
  { id: 'opname', label: 'Stock Opname', roles: ['superadmin', 'owner', 'admin', 'manager', 'warehouse'] },
  { group: 'Keuangan' },
  { id: 'expenses', label: 'Beban / Pengeluaran', roles: ['superadmin', 'owner', 'admin', 'manager', 'accounting'] },
  { id: 'payments', label: 'Pemasukan & Pembayaran', roles: ['superadmin', 'owner', 'admin', 'accounting'] },
  { group: 'Akuntansi' },
  { id: 'journals', label: 'Jurnal Umum', roles: ['superadmin', 'owner', 'admin', 'accounting'] },
  { id: 'coa', label: 'Bagian Akun (COA)', roles: ['superadmin', 'owner', 'admin', 'accounting'] },
  { group: 'Laporan' },
  { id: 'profit-loss', label: 'Laba Rugi', roles: ['superadmin', 'owner', 'admin', 'manager', 'accounting'] },
  { id: 'balance-sheet', label: 'Neraca', roles: ['superadmin', 'owner', 'admin', 'manager', 'accounting'] },
  { id: 'trial-balance', label: 'Neraca Saldo', roles: ['superadmin', 'owner', 'admin', 'manager', 'accounting'] },
  { id: 'sales-report', label: 'Laporan Penjualan', roles: '*' },
  { group: 'Master & Setting' },
  { id: 'customers', label: 'Pelanggan', roles: '*' },
  { id: 'suppliers', label: 'Supplier', roles: ['superadmin', 'owner', 'admin', 'manager', 'warehouse', 'accounting'] },
  { id: 'stores', label: 'Toko / Store', roles: ['superadmin', 'owner', 'admin', 'manager'] },
  { id: 'users', label: 'Pengguna', roles: ['superadmin', 'owner', 'admin'] },
  { id: 'tenants', label: '⚙️ Tenant (SaaS)', roles: ['superadmin'] },
];

function buildNav() {
  const nav = $('#navMenu'); nav.innerHTML = '';
  for (const m of MENU) {
    if (m.group) {
      if (m.id === undefined && !MENU.filter(x => x.id && x.roles && passRole(x)).length) continue;
      const g = document.createElement('div'); g.className = 'nav-group'; g.textContent = m.group; nav.appendChild(g); continue;
    }
    if (!passRole(m)) continue;
    const b = document.createElement('button');
    b.className = 'nav-item'; b.dataset.page = m.id; b.textContent = m.label;
    b.onclick = () => go(m.id);
    nav.appendChild(b);
  }
}
function passRole(m) {
  if (m.roles === '*') return true;
  return m.roles.includes(STATE.user.role);
}

function go(page) {
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  const titles = { dashboard: 'Dashboard', pos: 'Kasir (Point of Sale)', 'sales-list': 'Riwayat Penjualan', shift: 'Shift & Tutup Kas', products: 'Produk', stocks: 'Stok Gudang', purchase: 'Pembelian', transfers: 'Transfer Antar Store', opname: 'Stock Opname', expenses: 'Beban / Pengeluaran', payments: 'Pemasukan & Pembayaran', journals: 'Jurnal Umum', coa: 'Chart of Accounts', 'profit-loss': 'Laporan Laba Rugi', 'balance-sheet': 'Neraca', 'trial-balance': 'Neraca Saldo', 'sales-report': 'Laporan Penjualan', customers: 'Pelanggan', suppliers: 'Supplier', stores: 'Daftar Store', users: 'Pengguna', tenants: 'Manajemen Tenant (SaaS)' };
  $('#pageTitle').textContent = titles[page] || page;
  PAGES[page]().catch(e => { $('#content').innerHTML = `<div class="card err">${esc(e.message)}</div>`; });
}

function showApp() {
  $('#appPage').classList.remove('hidden');
  $('#whoami').textContent = `${STATE.user.full_name} (${STATE.user.role})${STATE.user.tenant_name ? ' • ' + STATE.user.tenant_name : ''}`;
  $('#tenantBadge').textContent = STATE.user.plan ? `Plan: ${STATE.user.plan}` : 'Platform';
  const sel = $('#storeSelect');
  sel.innerHTML = STATE.stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (STATE.stores.length) {
    const pref = STATE.stores.find(s => s.id == STATE.user.store_id);
    STATE.storeId = (pref || STATE.stores[0]).id;
    sel.value = STATE.storeId;
  }
  sel.onchange = () => { STATE.storeId = Number(sel.value); refreshCurrent(); };
  buildNav();
  go('dashboard');
}
let currentPage = 'dashboard';
function refreshCurrent() { const a = $('.nav-item.active'); if (a) go(a.dataset.page); }
const _go = go; go = (p) => { currentPage = p; _go(p); };

/* ============================================================
   HALAMAN-HALAMAN
   ============================================================ */
const PAGES = {};

/* ---------- DASHBOARD ---------- */
PAGES.dashboard = async () => {
  const d = await api('/reports/dashboard');
  $('#content').innerHTML = `
    <div class="grid kpi">
      <div class="card kpi"><div class="muted small">Omset Hari Ini</div><div class="num">${fmt(d.omset_today)}</div></div>
      <div class="card kpi"><div class="muted small">Omset Bulan Ini</div><div class="num">${fmt(d.omset_month)}</div></div>
      <div class="card kpi"><div class="muted small">Laba Bersih Bulan Ini</div>
        <div class="num ${d.month_profit >= 0 ? 'pos' : 'neg'}">${fmt(d.month_profit)}</div></div>
      <div class="card kpi"><div class="muted small">Nilai Persediaan</div><div class="num">${fmt(d.stock_value)}</div></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px">
      <div class="card"><h3>⚠️ Stok Menipis</h3><div class="table-wrap"><table>
        <tr><th>Produk</th><th>Store</th><th class="right">Stok</th><th class="right">Min</th></tr>
        ${d.low_stock.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.store_name)}</td>
          <td class="right"><span class="tag red">${Number(s.qty)}</span></td><td class="right">${Number(s.min_stock)}</td></tr>`).join('') || '<tr><td colspan=4 class="muted center">Tidak ada stok menipis 🎉</td></tr>'}
      </table></div></div>
      <div class="card"><h3>🕒 Transaksi Terakhir</h3><div class="table-wrap"><table>
        <tr><th>Kode</th><th>Store</th><th>Metode</th><th class="right">Total</th></tr>
        ${d.recent_sales.map(s => `<tr><td>${esc(s.code)}</td><td>${esc(s.store_name)}</td>
          <td><span class="tag blue">${esc(s.payment_method)}</span></td><td class="right">${fmt(s.total)}</td></tr>`).join('') || '<tr><td colspan=4 class="muted center">Belum ada transaksi</td></tr>'}
      </table></div></div>
    </div>`;
};

/* ---------- POS / KASIR ---------- */
let CART = [];
PAGES.pos = async () => {
  const [prods, stocks, customers] = await Promise.all([
    api('/master/products'), api(`/master/stocks?store_id=${STATE.storeId}`), api('/master/customers'),
  ]);
  const qtyMap = {}; stocks.forEach(s => qtyMap[s.product_id] = Number(s.qty));
  CART = [];
  $('#content').innerHTML = `
  <div class="pos-layout">
    <div>
      <div class="toolbar">
        <input id="posSearch" class="input" placeholder="🔍 Cari nama / scan barcode..." style="flex:1">
        <select id="posCustomer" class="input" style="width:auto">
          <option value="">Tanpa Pelanggan</option>
          ${customers.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' • ' + esc(c.phone) : ''}</option>`).join('')}
        </select>
      </div>
      <div class="prod-grid" id="prodGrid"></div>
    </div>
    <div class="card" id="cartCard">
      <h3>🛒 Keranjang <span class="muted small">(Store aktif di kanan atas)</span></h3>
      <div id="cartItems" class="muted small">Klik produk untuk menambah.</div>
      <div class="totals" id="cartTotals" style="margin-top:12px"></div>
      <div class="form-grid" style="margin-top:10px">
        <div class="form-row"><label>Bayar</label>
          <select id="payMethod" class="input">
            <option value="cash">Tunai</option><option value="debit">Kartu Debit</option>
            <option value="ewallet">E-Wallet/QRIS</option><option value="transfer">Transfer</option>
            <option value="credit">Kredit/Tempo</option>
          </select></div>
        <div class="form-row"><label>Uang Diterima</label><input id="paidInput" class="input" type="number" value=""></div>
      </div>
      <button id="btnPay" class="btn primary full" style="margin-top:8px">💰 Bayar & Simpan</button>
      <button id="btnPrint" class="btn ghost full sm hidden" style="margin-top:6px">🖨 Cetak Struk</button>
    </div>
  </div>`;

  const grid = $('#prodGrid');
  function renderProds(list) {
    grid.innerHTML = list.map(p => `
      <div class="prod-card" data-id="${p.id}">
        <div class="nm">${esc(p.name)}</div>
        <div class="small muted">${esc(p.sku)} • stok ${qtyMap[p.id] ?? 0}</div>
        <div class="pr">${fmt(p.sell_price)}</div>
      </div>`).join('');
    grid.querySelectorAll('.prod-card').forEach(c => c.onclick = () => addToCart(Number(c.dataset.id)));
  }
  const all = prods.filter(p => p.is_active);
  renderProds(all);
  $('#posSearch').oninput = (e) => {
    const kw = e.target.value.toLowerCase();
    renderProds(all.filter(p => !kw || p.name.toLowerCase().includes(kw) || p.sku.toLowerCase().includes(kw) || (p.barcode || '').includes(kw)));
  };
  $('#posSearch').onkeydown = (e) => {
    if (e.key === 'Enter') { // scan barcode -> tambah langsung bila unik
      const kw = e.target.value.trim();
      const hit = all.filter(p => p.barcode === kw || p.sku === kw);
      if (hit.length === 1) { addToCart(hit[0].id); e.target.value = ''; renderProds(all); }
    }
  };

  const prodOf = (id) => all.find(p => p.id === id);
  function addToCart(id) {
    const line = CART.find(l => l.product_id === id);
    if (line) line.qty++; else CART.push({ product_id: id, qty: 1, price: Number(prodOf(id).sell_price), discount: 0 });
    renderCart();
  }
  window.setCartQty = (id, v) => { const l = CART.find(x => x.product_id === id); if (l) { l.qty = Math.max(0.001, Number(v) || 0); renderCart(true); } };
  window.rmCart = (id) => { CART = CART.filter(l => l.product_id !== id); renderCart(); };

  function totals() {
    let sub = 0, tax = 0;
    for (const l of CART) {
      const p = prodOf(l.product_id);
      const net = l.price * l.qty - Number(l.discount || 0);
      sub += net; tax += net * Number(p.tax_rate || 0) / 100;
    }
    return { sub, tax, total: sub + tax };
  }
  function renderCart(skipFocus) {
    const box = $('#cartItems');
    if (!CART.length) { box.innerHTML = '<span class="muted small">Keranjang kosong.</span>'; $('#cartTotals').innerHTML = ''; return; }
    box.innerHTML = CART.map(l => {
      const p = prodOf(l.product_id);
      const line = l.price * l.qty - Number(l.discount || 0);
      return `<div class="cart-line">
        <div style="flex:1"><b>${esc(p.name)}</b><div class="small muted">${fmt(l.price)}</div></div>
        <input type="number" min="1" step="any" value="${l.qty}" onchange="setCartQty(${l.product_id},this.value)">
        <div class="right" style="width:90px">${fmt(line)}</div>
        <button class="btn sm danger" onclick="rmCart(${l.product_id})">✕</button>
      </div>`;
    }).join('');
    const t = totals();
    $('#cartTotals').innerHTML = `
      <div><span>Subtotal</span><span>${fmt(t.sub)}</span></div>
      <div><span>PPN</span><span>${fmt(t.tax)}</span></div>
      <div class="grand"><span>TOTAL</span><span>${fmt(t.total)}</span></div>`;
    $('#paidInput').value = Math.ceil(t.total / 500) * 500;
  }

  $('#btnPay').onclick = async () => {
    if (!CART.length) return toast('Keranjang masih kosong', 'bad');
    const t = totals();
    const paid = Number($('#paidInput').value || t.total);
    const custSel = $('#posCustomer');
    try {
      const r = await api('/sales', { method: 'POST', body: {
        store_id: STATE.storeId,
        customer_id: custSel.value ? Number(custSel.value) : null,
        items: CART.map(l => ({ product_id: l.product_id, qty: l.qty, price: l.price, discount: Number(l.discount || 0) })),
        payment_method: $('#payMethod').value, paid,
      }});
      toast(`Transaksi ${r.code} berhasil! Kembali: ${fmt(r.change)}`, 'ok');
      localStorage.setItem('lastStruk', JSON.stringify({ ...r, store: STATE.stores.find(s => s.id == STATE.storeId)?.name, cashier: STATE.user.full_name, time: new Date().toLocaleString('id-ID') }));
      CART = []; renderCart();
      const btnP = $('#btnPrint'); btnP.classList.remove('hidden');
      btnP.onclick = printStruk;
    } catch (e) { toast(e.message, 'bad'); }
  };
};

function printStruk() {
  const s = JSON.parse(localStorage.getItem('lastStruk') || '{}');
  const w = window.open('', '_blank', 'width=320,height=500');
  w.document.write(`<pre style="font-family:monospace;width:280px">
================================
        ${esc(s.store || '')}
================================
No   : ${esc(s.code)}
Waktu: ${esc(s.time)}
Oleh : ${esc(s.cashier)}
--------------------------------
TOTAL  ${fmt(s.total)}
BAYAR  ${fmt(s.paid)}
KEMBALI ${fmt(s.change)}
================================
   Terima kasih atas kunjungan
</pre><script>window.print()</`);
  w.document.close();
}

/* ---------- RIWAYAT PENJUALAN ---------- */
PAGES['sales-list'] = async () => {
  const rows = await api('/sales');
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn" onclick="window.print()">🖨 Cetak</button></div>
  <div class="table-wrap"><table>
    <tr><th>Kode</th><th>Tanggal</th><th>Store</th><th>Pelanggan</th><th>Kasir</th>
        <th class="right">Total</th><th>Metode</th><th>Status</th><th></th></tr>
    ${rows.map(s => `<tr>
      <td>${esc(s.code)}</td><td>${new Date(s.created_at).toLocaleString('id-ID')}</td>
      <td>${esc(s.store_name)}</td><td>${esc(s.customer_name || '-')}</td><td>${esc(s.cashier_name || '')}</td>
      <td class="right">${fmt(s.total)}</td><td><span class="tag blue">${esc(s.payment_method)}</span></td>
      <td>${s.status === 'completed' ? '<span class="tag green">Selesai</span>' : `<span class="tag ${s.status === 'voided' ? 'red' : 'gray'}">${esc(s.status)}</span>`}</td>
      <td>${s.status === 'completed' ? `<button class="btn sm danger" onclick="voidSale(${s.id})">Void</button>` : ''}</td>
    </tr>`).join('')}
  </table></div>`;
};
window.voidSale = async (id) => {
  if (!confirm('Batalkan transaksi ini? Stok akan dikembalikan.')) return;
  try { await api(`/sales/${id}/void`, { method: 'POST' }); toast('Transansi dibatalkan'); go('sales-list'); }
  catch (e) { toast(e.message, 'bad'); }
};

/* ---------- SHIFT ---------- */
PAGES.shift = async () => {
  const cur = await api('/sales/shifts/current');
  $('#content').innerHTML = `<div class="card" style="max-width:520px">
    <h3>Shift Kasir Anda</h3>
    ${cur ? `
      <p>Status: <span class="tag green">OPEN</span> sejak ${new Date(cur.open_at).toLocaleString('id-ID')}</p>
      <p class="muted small">Store #${cur.store_id} • Modal awal ${fmt(cur.opening_cash)}</p>
      <div class="form-row" style="margin-top:12px"><label>Uang Kas Terhitung saat tutup</label>
        <input id="countedCash" class="input" type="number"></div>
      <button class="btn danger" onclick="closeShift(${cur.id})">🔒 Tutup Kas (Z-Report)</button>`
    : `
      <p class="muted">Tidak ada shift terbuka.</p>
      <div class="form-row"><label>Modal Awal Kasir</label><input id="openingCash" class="input" type="number" value="0"></div>
      <button class="btn primary" onclick="openShift()">🔓 Buka Shift</button>`}
  </div>`;
};
window.openShift = async () => {
  try { await api('/sales/shifts/open', { method: 'POST', body: { store_id: STATE.storeId, opening_cash: Number($('#openingCash').value || 0) } }); toast('Shift dibuka'); go('shift'); }
  catch (e) { toast(e.message, 'bad'); }
};
window.closeShift = async (id) => {
  try {
    const r = await api(`/sales/shifts/${id}/close`, { method: 'POST', body: { counted_cash: Number($('#countedCash').value || 0) } });
    toast(`Shift ditutup. Selisih: ${fmt(r.difference)}`, Math.abs(r.difference) > 0.01 ? 'bad' : 'ok'); go('shift');
  } catch (e) { toast(e.message, 'bad'); }
};

/* ---------- PRODUK ---------- */
PAGES.products = async () => {
  const [rows, cats] = await Promise.all([api('/master/products'), api('/master/categories')]);
  $('#content').innerHTML = `
  <div class="toolbar">
    <input id="pq" class="input" placeholder="Cari produk...">
    <button class="btn primary" onclick="productForm()">➕ Tambah Produk</button>
  </div>
  <div class="table-wrap"><table>
    <tr><th>SKU</th><th>Nama</th><th>Kategori</th><th>Satuan</th><th class="right">Modal</th><th class="right">Jual</th><th class="right">PPN%</th><th></th></tr>
    ${rows.map(p => `<tr data-s="${esc((p.sku + ' ' + p.name + ' ' + (p.barcode || '')).toLowerCase())}">
      <td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${esc(p.category_name || '-')}</td><td>${esc(p.unit)}</td>
      <td class="right">${fmt(p.cost_price)}</td><td class="right">${fmt(p.sell_price)}</td><td class="right">${p.tax_rate}</td>
      <td><button class="btn sm" onclick='productForm(${JSON.stringify(p.id)})'>✏️</button></td>
    </tr>`).join('')}
  </table></div>`;
  $('#pq').oninput = (e) => { const kw = e.target.value.toLowerCase();
    $$('#content tbody tr').forEach(tr => tr.style.display = tr.dataset.s.includes(kw) ? '' : 'none'); };
  window._prodCache = rows; window._cats = cats;
};
window.productForm = async (id) => {
  const p = id ? (window._prodCache || []).find(x => x.id === id) : {};
  const cats = window._cats || await api('/master/categories');
  openModal(id ? 'Edit Produk' : 'Tambah Produk', `
    <div class="form-grid">
      ${modalField('sku', 'SKU', p.sku)} ${modalField('barcode', 'Barcode', p.barcode, 'text', false)}
      ${modalSelect('category_id', 'Kategori', [{ v: '', t: '-'}, ...cats.map(c => ({ v: c.id, t: c.name }))], p.category_id)}
      ${modalField('unit', 'Satuan', p.unit || 'pcs', 'text', false)}
    </div>
    ${modalField('name', 'Nama Produk', p.name)}
    <div class="form-grid">
      ${modalField('cost_price', 'Harga Modal', p.cost_price ?? 0, 'number')}
      ${modalField('sell_price', 'Harga Jual', p.sell_price ?? 0, 'number')}
      ${modalField('tax_rate', 'PPN %', p.tax_rate ?? 11, 'number', false)}
      ${modalField('min_stock', 'Stok Minimum (pusat)', p.min_stock ?? 0, 'number', false)}
    </div>`, async () => {
    const v = formVals($('#modalBody'));
    if (id) await api(`/master/products/${id}`, { method: 'PUT', body: { ...p, ...v, category_id: v.category_id || null } });
    else await api('/master/products', { method: 'POST', body: { ...v, store_id: STATE.storeId } });
    toast('Produk tersimpan'); go('products');
  });
};

/* ---------- STOK ---------- */
PAGES.stocks = async () => {
  const rows = await api(`/master/stocks?store_id=${STATE.storeId}`);
  $('#content').innerHTML = `
  <div class="toolbar">
    <button class="btn primary" onclick="adjustForm()">🔧 Penyesuaian Stok</button>
    <span class="muted small">Menampilkan stok store aktif.</span>
  </div>
  <div class="table-wrap"><table>
    <tr><th>SKU</th><th>Produk</th><th class="right">Stok</th><th class="right">Avg Cost</th><th class="right">Nilai</th><th class="right">Min</th><th>Status</th></tr>
    ${rows.map(s => `<tr>
      <td>${esc(s.sku)}</td><td>${esc(s.name)}</td><td class="right">${Number(s.qty)}</td>
      <td class="right">${fmt(s.avg_cost)}</td><td class="right">${fmt(Number(s.qty) * Number(s.avg_cost))}</td>
      <td class="right">${Number(s.min_stock)}</td>
      <td>${Number(s.qty) <= Number(s.min_stock) && Number(s.min_stock) > 0 ? '<span class="tag red">Restok!</span>' : '<span class="tag green">Aman</span>'}</td>
    </tr>`).join('')}
  </table></div>`;
};
window.adjustForm = async () => {
  const rows = await api(`/master/stocks?store_id=${STATE.storeId}`);
  openModal('Penyesuaian Stok', `
    ${modalSelect('product_id', 'Produk', rows.map(s => ({ v: s.product_id, t: `${s.name} (stok ${Number(s.qty)})` })))}
    ${modalField('qty_diff', 'Selisih (+/-)', '', 'number')}
    ${modalField('note', 'Catatan', '', 'text', false)}`, async () => {
    const v = formVals($('#modalBody'));
    await api('/master/stocks/adjust', { method: 'POST', body: { store_id: STATE.storeId, product_id: Number(v.product_id), qty_diff: Number(v.qty_diff), note: v.note } });
    toast('Stok disesuaikan & jurnal dibuat'); go('stocks');
  });
};

/* ---------- PEMBELIAN ---------- */
PAGES.purchase = async () => {
  const [pos, grs, sups] = await Promise.all([api('/inv/purchase-orders'), api('/inv/goods-receipts'), api('/master/suppliers')]);
  $('#content').innerHTML = `
  <div class="toolbar">
    <button class="btn primary" onclick="poForm()">➕ Buat PO</button>
    <button class="btn green" onclick="grForm()">📦 Terima Barang (GR)</button>
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr">
    <div class="card"><h3>Purchase Order</h3><div class="table-wrap"><table>
      <tr><th>No PO</th><th>Supplier</th><th>Tgl</th><th class="right">Total</th><th>Status</th><th></th></tr>
      ${pos.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(p.supplier_name)}</td><td>${esc(String(p.order_date).slice(0, 10))}</td>
        <td class="right">${fmt(p.total)}</td>
        <td><span class="tag ${p.status === 'received' ? 'green' : p.status === 'draft' ? 'gray' : 'amber'}">${esc(p.status)}</span></td>
        <td>${p.status === 'draft' ? `<button class="btn sm" onclick="approvePO(${p.id})">Approve</button>` : ''}</td></tr>`).join('') || '<tr><td colspan=6 class="muted center">Belum ada PO</td></tr>'}
    </table></div></div>
    <div class="card"><h3>Goods Receipt (Penerimaan)</h3><div class="table-wrap"><table>
      <tr><th>Kode</th><th>Supplier</th><th>Tgl</th><th class="right">Total</th></tr>
      ${grs.map(g => `<tr><td>${esc(g.code)}</td><td>${esc(g.supplier_name)}</td><td>${esc(String(g.receive_date).slice(0, 10))}</td><td class="right">${fmt(Number(g.total) + Number(g.tax_amount))}</td></tr>`).join('') || '<tr><td colspan=4 class="muted center">Belum ada penerimaan</td></tr>'}
    </table></div></div>
  </div>`;
  window._sups = sups;
};
window.poForm = async () => {
  const [prods, sups] = await Promise.all([api('/master/products'), api('/master/suppliers')]);
  openModal('Buat Purchase Order', `
    ${modalSelect('supplier_id', 'Supplier', sups.map(s => ({ v: s.id, t: s.name })))}
    ${modalField('order_date', 'Tanggal PO', today(), 'date')}
    <div class="form-row"><label>Item (pisahkan tiap baris: productId;qty;harga)</label>
      <textarea id="poItems" class="input" rows="5" placeholder="Contoh:\n${prods.slice(0, 2).map(p => p.id + ';10;' + p.cost_price).join('\n')}"></textarea></div>
    <details><summary class="muted small">Daftar produk (id - nama - modal)</summary>
      ${prods.map(p => `<div class="small muted">#${p.id} ${esc(p.name)} — ${fmt(p.cost_price)}</div>`).join('')}</details>`,
  async () => {
    const v = formVals($('#modalBody'));
    const items = $('#poItems').value.split('\n').filter(Boolean).map(l => {
      const [pid, qty, price] = l.split(';').map(x => x.trim());
      return { product_id: Number(pid), qty: Number(qty), price: Number(price) };
    });
    await api('/inv/purchase-orders', { method: 'POST', body: { store_id: STATE.storeId, supplier_id: Number(v.supplier_id), order_date: v.order_date, items } });
    toast('PO dibuat'); go('purchase');
  });
};
window.approvePO = async (id) => { await api(`/inv/purchase-orders/${id}/approve`, { method: 'POST' }); toast('PO disetujui'); go('purchase'); };
window.grForm = async () => {
  const [posA, posB, prods, sups] = await Promise.all([
    api('/inv/purchase-orders?status=approved'), api('/inv/purchase-orders?status=partial'),
    api('/master/products'), api('/master/suppliers')]);
  const allPO = [...posA, ...posB];
  openModal('Terima Barang', `
    ${modalSelect('po_id', 'Dari PO (kosongkan = pembelian langsung)', [{ v: '', t: '- Pembelian Langsung' }, ...allPO.map(p => ({ v: p.id, t: `${p.code} — ${p.supplier_name}` }))])}
    <div class="form-row" id="directSupWrap" style="display:none">
      <label>Supplier (pembelian langsung)</label>
      <select class="input" name="supplier_direct">${sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    </div>
    <div class="form-row"><label>Item (productId;qty;harga) — kosongkan bila dari PO (otomatis pakai sisa qty PO)</label>
      <textarea id="grItems" class="input" rows="5"></textarea></div>
    <div class="form-row"><label>PPN % per item (opsional)</label><input id="grTax" class="input" type="number" value="0"></div>
    <details><summary class="muted small">Daftar produk</summary>
      ${prods.map(p => `<div class="small muted">#${p.id} ${esc(p.name)} — modal ${fmt(p.cost_price)}</div>`).join('')}</details>`,
  async () => {
    const poId = $('#modalBody [name=po_id]').value;
    let items = $('#grItems').value.split('\n').filter(Boolean).map(l => {
      const [pid, qty, price] = l.split(';').map(x => x.trim());
      return { product_id: Number(pid), qty: Number(qty), price: Number(price), tax_rate: Number($('#grTax').value || 0) };
    });
    const body = { store_id: STATE.storeId };
    if (poId) {
      body.po_id = Number(poId);
      if (!items.length) {
        const detail = await api(`/inv/purchase-orders/${poId}`);
        items = detail.items.filter(i => Number(i.qty) > Number(i.received_qty))
          .map(i => ({ product_id: i.product_id, qty: Number(i.qty) - Number(i.received_qty), price: Number(i.price), tax_rate: Number($('#grTax').value || 0) }));
      }
    } else {
      body.supplier_id = Number($('#modalBody [name=supplier_direct]').value);
      if (!body.supplier_id) throw new Error('Pilih supplier untuk pembelian langsung');
    }
    if (!items.length) throw new Error('Tidak ada item untuk diterima');
    body.items = items;
    await api('/inv/goods-receipts', { method: 'POST', body });
    toast('Barang diterima, stok & jurnal ter-update'); go('purchase');
  });
  // toggle tampilan supplier saat memilih PO / pembelian langsung
  const sel = $('#modalBody [name=po_id]');
  const upd = () => { const w = $('#directSupWrap'); if (w) w.style.display = sel.value ? 'none' : ''; };
  sel.onchange = upd; upd();
};

/* ---------- TRANSFER ---------- */
PAGES.transfers = async () => {
  const rows = await api('/inv/transfers');
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="transferForm()">➕ Transfer Antar Store</button></div>
  <div class="table-wrap"><table>
    <tr><th>Kode</th><th>Dari</th><th>Ke</th><th>Status</th><th>Tanggal</th><th></th></tr>
    ${rows.map(t => `<tr><td>${esc(t.code)}</td><td>${esc(t.from_name)}</td><td>${esc(t.to_name)}</td>
      <td><span class="tag ${t.status === 'received' ? 'green' : t.status === 'cancelled' ? 'red' : 'amber'}">${esc(t.status)}</span></td>
      <td>${new Date(t.created_at).toLocaleDateString('id-ID')}</td>
      <td>${t.status !== 'received' && t.status !== 'cancelled' ? `<button class="btn sm green" onclick="receiveTransfer(${t.id})">Terima</button>` : ''}</td></tr>`).join('') || '<tr><td colspan=6 class="muted center">Belum ada transfer</td></tr>'}
  </table></div>`;
};
window.transferForm = async () => {
  const [stocks, stores] = await Promise.all([api('/master/stocks'), Promise.resolve(STATE.stores)]);
  const otherStores = stores.filter(s => s.id !== STATE.storeId);
  if (!otherStores.length) return toast('Butuh minimal 2 store untuk transfer', 'bad');
  const myStocks = stocks.filter(s => s.store_id === STATE.storeId && Number(s.qty) > 0);
  openModal('Transfer Keluar (dari store aktif)', `
    ${modalSelect('to_store_id', 'Tujuan', otherStores.map(s => ({ v: s.id, t: s.name })))}
    <div class="form-row"><label>Item (productId;qty)</label>
      <textarea id="trItems" class="input" rows="5" placeholder="contoh: ${myStocks[0] ? myStocks[0].product_id + ';5' : '1;5'}"></textarea></div>
    <details><summary class="muted small">Stok tersedia di store ini</summary>
      ${myStocks.map(s => `<div class="small muted">#${s.product_id} ${esc(s.name)} — ${Number(s.qty)} ${esc(s.unit)}</div>`).join('')}</details>`,
  async () => {
    const to = Number($('#modalBody [name=to_store_id]').value);
    const items = $('#trItems').value.split('\n').filter(Boolean).map(l => {
      const [pid, qty] = l.split(';').map(x => x.trim());
      return { product_id: Number(pid), qty: Number(qty) };
    });
    await api('/inv/transfers', { method: 'POST', body: { from_store_id: STATE.storeId, to_store_id: to, items } });
    toast('Transfer dibuat (pending). Store tujuan harus menerima.'); go('transfers');
  });
};
window.receiveTransfer = async (id) => {
  try { await api(`/inv/transfers/${id}/receive`, { method: 'POST' }); toast('Barang diterima & masuk stok'); go('transfers'); }
  catch (e) { toast(e.message, 'bad'); }
};

/* ---------- OPNAME ---------- */
PAGES.opname = async () => {
  const rows = await api('/inv/opnames');
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="opnameForm()">➕ Mulai Opname</button></div>
  <div class="table-wrap"><table>
    <tr><th>Kode</th><th>Store</th><th>Tanggal</th><th>Status</th></tr>
    ${rows.map(o => `<tr><td>${esc(o.code)}</td><td>${esc(o.store_name)}</td><td>${esc(String(o.opname_date).slice(0, 10))}</td>
      <td><span class="tag ${o.status === 'posted' ? 'green' : 'gray'}">${esc(o.status)}</span></td></tr>`).join('') || '<tr><td colspan=4 class="muted center">Belum ada opname</td></tr>'}
  </table></div>`;
};
window.opnameForm = async () => {
  const stocks = await api(`/master/stocks?store_id=${STATE.storeId}`);
  openModal('Stock Opname (posting otomatis)', `
    <p class="muted small">Format baris: productId;hitungFisik. Sistem akan menghitung selisih & membuat jurnal.</p>
    <textarea id="opItems" class="input" rows="6" placeholder="${stocks[0] ? stocks[0].product_id + ';' + (Number(stocks[0].qty) - 1) : '1;10'}"></textarea>
    <details><summary class="muted small">Stok sistem</summary>
      ${stocks.map(s => `<div class="small muted">#${s.product_id} ${esc(s.name)} — ${Number(s.qty)}</div>`).join('')}</details>`,
  async () => {
    const items = $('#opItems').value.split('\n').filter(Boolean).map(l => {
      const [pid, act] = l.split(';').map(x => x.trim());
      return { product_id: Number(pid), actual_qty: Number(act) };
    });
    await api('/inv/opnames', { method: 'POST', body: { store_id: STATE.storeId, items, post: true } });
    toast('Opname diposting'); go('opname');
  });
};

/* ---------- BEBAN ---------- */
PAGES.expenses = async () => {
  const [rows, accounts] = await Promise.all([api('/finance/expenses'), api('/finance/accounts')]);
  const expAcc = accounts.filter(a => a.type === 'expense' && !a.is_header);
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="expenseForm()">➕ Catat Beban</button></div>
  <div class="table-wrap"><table>
    <tr><th>Kode</th><th>Tanggal</th><th>Store</th><th>Keterangan</th><th class="right">Jumlah</th><th>Bayar</th></tr>
    ${rows.map(e => `<tr><td>${esc(e.code)}</td><td>${esc(String(e.expense_date).slice(0, 10))}</td><td>${esc(e.store_name)}</td>
      <td>${esc(e.description || e.category)}</td><td class="right">${fmt(e.amount)}</td><td><span class="tag blue">${esc(e.pay_method)}</span></td></tr>`).join('') || '<tr><td colspan=6 class="muted center">Belum ada beban</td></tr>'}
  </table></div>`;
  window._expAcc = expAcc;
};
window.expenseForm = async () => {
  const accs = window._expAcc || await api('/finance/accounts');
  openModal('Catat Beban', `
    ${modalSelect('account_id', 'Akun Beban', accs.map ? accs.map(a => ({ v: a.id, t: `${a.code} ${a.name}` })) : [])}
    ${modalField('amount', 'Jumlah', '', 'number')}
    ${modalField('expense_date', 'Tanggal', today(), 'date')}
    ${modalSelect('pay_method', 'Cara Bayar', [{ v: 'cash', t: 'Kas' }, { v: 'transfer', t: 'Bank/Transfer' }])}
    ${modalField('description', 'Keterangan')}`, async () => {
    const v = formVals($('#modalBody'));
    await api('/finance/expenses', { method: 'POST', body: { ...v, account_id: Number(v.account_id), amount: Number(v.amount), store_id: STATE.storeId } });
    toast('Beban tercatat + jurnal'); go('expenses');
  });
};

/* ---------- PEMBAYARAN ---------- */
PAGES.payments = async () => {
  const [pin, pout, custs, sups] = await Promise.all([api('/finance/payments-in'), api('/finance/payments-out'), api('/master/customers'), api('/master/suppliers')]);
  $('#content').innerHTML = `
  <div class="grid" style="grid-template-columns:1fr 1fr">
    <div class="card"><h3>💵 Pemasukan dari Pelanggan (lunas piutang)</h3>
      <button class="btn sm primary" onclick="payInForm()" style="margin-bottom:10px">➕ Catat</button>
      <div class="table-wrap"><table><tr><th>Kode</th><th>Pelanggan</th><th class="right">Jumlah</th><th>Tgl</th></tr>
      ${pin.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(p.customer_name)}</td><td class="right">${fmt(p.amount)}</td><td>${esc(String(p.pay_date).slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan=4 class="muted center">Kosong</td></tr>'}
      </table></div></div>
    <div class="card"><h3>💸 Pembayaran ke Supplier (hutang)</h3>
      <button class="btn sm primary" onclick="payOutForm()" style="margin-bottom:10px">➕ Catat</button>
      <div class="table-wrap"><table><tr><th>Kode</th><th>Supplier</th><th class="right">Jumlah</th><th>Tgl</th></tr>
      ${pout.map(p => `<tr><td>${esc(p.code)}</td><td>${esc(p.supplier_name)}</td><td class="right">${fmt(p.amount)}</td><td>${esc(String(p.pay_date).slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan=4 class="muted center">Kosong</td></tr>'}
      </table></div></div>
  </div>`;
  window._custs = custs; window._sups = sups;
};
window.payInForm = () => {
  openModal('Pemasukan Pelanggan', `
    ${modalSelect('customer_id', 'Pelanggan', (window._custs || []).map(c => ({ v: c.id, t: c.name })))}
    ${modalField('amount', 'Jumlah', '', 'number')}
    ${modalField('pay_date', 'Tanggal', today(), 'date')}
    ${modalSelect('pay_method', 'Metode', [{ v: 'cash', t: 'Kas' }, { v: 'transfer', t: 'Bank' }])}`, async () => {
    const v = formVals($('#modalBody'));
    await api('/finance/payments-in', { method: 'POST', body: { ...v, customer_id: Number(v.customer_id), amount: Number(v.amount) } });
    toast('Tercatat'); go('payments');
  });
};
window.payOutForm = () => {
  openModal('Pembayaran Supplier', `
    ${modalSelect('supplier_id', 'Supplier', (window._sups || []).map(s => ({ v: s.id, t: s.name })))}
    ${modalField('amount', 'Jumlah', '', 'number')}
    ${modalField('pay_date', 'Tanggal', today(), 'date')}
    ${modalSelect('pay_method', 'Metode', [{ v: 'transfer', t: 'Bank' }, { v: 'cash', t: 'Kas' }])}`, async () => {
    const v = formVals($('#modalBody'));
    await api('/finance/payments-out', { method: 'POST', body: { ...v, supplier_id: Number(v.supplier_id), amount: Number(v.amount) } });
    toast('Tercatat'); go('payments');
  });
};

/* ---------- JURNAL ---------- */
PAGES.journals = async () => {
  const rows = await api('/finance/journals');
  $('#content').innerHTML = `
  <div class="toolbar">
    <input type="date" id="jFrom" class="input" value="${monthStart()}">
    <input type="date" id="jTo" class="input" value="${today()}">
    <button class="btn" onclick="loadJournals()">Terapkan</button>
    <button class="btn primary" onclick="journalForm()">➕ Jurnal Manual</button>
  </div>
  <div id="jList"></div>`;
  window.loadJournals = async () => {
    const rows = await api(`/finance/journals?from=${$('#jFrom').value}&to=${$('#jTo').value}`);
    $('#jList').innerHTML = `<div class="table-wrap"><table>
      <tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th>Referensi</th><th class="right">Debit</th><th></th></tr>
      ${rows.map(j => `<tr><td>${esc(j.code)}</td><td>${esc(String(j.journal_date).slice(0, 10))}</td>
        <td>${esc(j.description)}</td><td><span class="tag gray">${esc(j.ref_type)}</span></td>
        <td class="right">${fmt(j.total_debit)}</td>
        <td><button class="btn sm" onclick="viewJournal(${j.id})">Detail</button></td></tr>`).join('') || '<tr><td colspan=6 class="muted center">Tidak ada jurnal</td></tr>'}
    </table></div>`;
  };
  loadJournals();
};
window.viewJournal = async (id) => {
  const d = await api(`/finance/journals/${id}`);
  openModal(`Jurnal ${d.journal.code}`, `<div class="table-wrap"><table>
    <tr><th>Akun</th><th class="right">Debit</th><th class="right">Credit</th></tr>
    ${d.lines.map(l => `<tr><td>${esc(l.account_code)} ${esc(l.account_name)}</td>
      <td class="right">${Number(l.debit) ? fmt(l.debit) : ''}</td><td class="right">${Number(l.credit) ? fmt(l.credit) : ''}</td></tr>`).join('')}
  </table></div>`, async () => {});
  $('#modalSave').classList.add('hidden');
  $('#modal').addEventListener('transitionend', () => $('#modalSave').classList.remove('hidden'), { once: true });
};
window.journalForm = async () => {
  const accs = await api('/finance/accounts');
  const leaf = accs.filter(a => !a.is_header);
  openModal('Jurnal Manual', `
    ${modalField('description', 'Keterangan')}
    ${modalField('date', 'Tanggal', today(), 'date')}
    <div class="form-row"><label>Baris jurnal — format: akunId;debit;kredit (minimal 2 baris balance)</label>
      <textarea id="jLines" class="input" rows="4"></textarea></div>
    <details><summary class="muted small">Daftar akun</summary>
      ${leaf.map(a => `<div class="small muted">#${a.id} ${esc(a.code)} ${esc(a.name)}</div>`).join('')}</details>`,
  async () => {
    const v = formVals($('#modalBody'));
    const lines = $('#jLines').value.split('\n').filter(Boolean).map(l => {
      const [acc, d, c] = l.split(';').map(x => x.trim());
      return { account_id: Number(acc), debit: Number(d || 0), credit: Number(c || 0) };
    });
    await api('/finance/journals', { method: 'POST', body: { description: v.description, date: v.date, lines } });
    toast('Jurnal tersimpan'); go('journals');
  });
};

/* ---------- COA ---------- */
PAGES.coa = async () => {
  const rows = await api('/finance/accounts');
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="coaForm()">➕ Tambah Akun</button></div>
  <div class="table-wrap"><table>
    <tr><th>Kode</th><th>Nama Akun</th><th>Tipe</th><th>Subtipe</th></tr>
    ${rows.map(a => `<tr><td>${esc(a.code)}</td><td>${a.is_header ? '<b>' + esc(a.name) + '</b>' : esc(a.name)}</td>
      <td><span class="tag ${a.type === 'asset' ? 'blue' : a.type === 'liability' ? 'red' : a.type === 'equity' ? 'gray' : a.type === 'revenue' ? 'green' : 'amber'}">${esc(a.type)}</span></td>
      <td>${esc(a.subtype || '')}</td></tr>`).join('')}
  </table></div>`;
};
window.coaForm = () => {
  openModal('Tambah Akun', `
    ${modalField('code', 'Kode (mis. 5-1800)')} ${modalField('name', 'Nama Akun')}
    ${modalSelect('type', 'Tipe', [['asset', 'Aset'], ['liability', 'Kewajiban'], ['equity', 'Modal'], ['revenue', 'Pendapatan'], ['expense', 'Beban']].map(([v, t]) => ({ v, t })))}
    ${modalField('subtype', 'Subtipe (opsional)', '', 'text', false)}`, async () => {
    const v = formVals($('#modalBody'));
    await api('/finance/accounts', { method: 'POST', body: v });
    toast('Akun ditambahkan'); go('coa');
  });
};

/* ---------- LABA RUGI ---------- */
PAGES['profit-loss'] = async () => {
  $('#content').innerHTML = `
  <div class="toolbar">
    <input type="date" id="plFrom" class="input" value="${monthStart()}">
    <input type="date" id="plTo" class="input" value="${today()}">
    <button class="btn primary" onclick="loadPL()">Tampilkan</button>
    <button class="btn" onclick="window.print()">🖨 Cetak</button>
  </div><div id="plBox"></div>`;
  window.loadPL = async () => {
    const d = await api(`/reports/profit-loss?from=${$('#plFrom').value}&to=${$('#plTo').value}`);
    $('#plBox').innerHTML = `<div class="card rpt" style="max-width:720px">
      <h3 class="center">LAPORAN LABA RUGI<br><span class="muted small">${esc(d.period.from)} s/d ${esc(d.period.to)}</span></h3>
      <table>
        <tr><td><b>PENDAPATAN</b></td><td></td><td></td></tr>
        ${d.revenue.map(r => `<tr class="lvl1"><td>${esc(r.name)}</td><td class="right">${fmt(r.amount)}</td><td></td></tr>`).join('')}
        <tr class="total"><td>Total Pendapatan</td><td class="right">${fmt(d.total_revenue)}</td><td></td></tr>
        <tr><td><b>HARGA POKOK PENJUALAN</b></td><td></td><td class="right">${fmt(d.cogs)}</td></tr>
        <tr class="total"><td>LABA KOTOR</td><td></td><td class="right">${fmt(d.gross_profit)}</td></tr>
        <tr><td><b>BEBAN OPERASIONAL</b></td><td></td><td></td></tr>
        ${d.expenses.map(r => `<tr class="lvl1"><td>${esc(r.name)}</td><td class="right">${fmt(r.amount)}</td><td></td></tr>`).join('')}
        <tr class="total"><td>Total Beban Operasional</td><td class="right">${fmt(d.total_opex)}</td><td></td></tr>
        <tr class="grand"><td>${d.net_profit >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH'}</td><td></td>
          <td class="right ${d.net_profit >= 0 ? '' : 'err'}">${fmt(Math.abs(d.net_profit))}</td></tr>
      </table></div>`;
  };
  loadPL();
};

/* ---------- NERACA ---------- */
PAGES['balance-sheet'] = async () => {
  $('#content').innerHTML = `
  <div class="toolbar">
    Per <input type="date" id="bsTo" class="input" value="${today()}">
    <button class="btn primary" onclick="loadBS()">Tampilkan</button>
    <button class="btn" onclick="window.print()">🖨 Cetak</button>
  </div><div id="bsBox"></div>`;
  window.loadBS = async () => {
    const d = await api(`/reports/balance-sheet?to=${$('#bsTo').value}`);
    const sec = (title, rows, totalLabel, total, extraRows = '') => `
      <tr><td colspan=2><b>${title}</b></td></tr>
      ${rows.map(r => `<tr class="lvl1"><td>${esc(r.code)} ${esc(r.name)}</td><td class="right">${fmt(r.amount)}</td></tr>`).join('')}${extraRows}
      <tr class="total"><td>${totalLabel}</td><td class="right">${fmt(total)}</td></tr>`;
    $('#bsBox').innerHTML = `<div class="card rpt" style="max-width:640px">
      <h3 class="center">NERACA (BALANCE SHEET)<br><span class="muted small">Per ${esc(d.as_of)}</span></h3>
      <table>
        ${sec('ASET', d.assets, 'TOTAL ASET', d.total_assets)}
        ${sec('KEWAJIBAN', d.liabilities, 'TOTAL KEWAJIBAN', d.total_liabilities)}
        ${sec('MODAL', d.equity, '', 0, `<tr class="lvl1"><td>Laba Ditahan (berjalan)</td><td class="right">${fmt(d.retained_earnings)}</td></tr>
          <tr class="total"><td>Total Modal</td><td class="right">${fmt(d.total_equity)}</td></tr>`)}
        <tr class="grand"><td>TOTAL KEWAJIBAN + MODAL</td><td class="right">${fmt(d.total_liabilities + d.total_equity)}</td></tr>
        <tr><td colspan=2 class="center ${d.balanced ? 'muted' : 'err'} small">${d.balanced ? '✓ Balance' : '✗ Tidak balance!'}</td></tr>
      </table></div>`;
  };
  loadBS();
};

/* ---------- NERACA SALDO ---------- */
PAGES['trial-balance'] = async () => {
  $('#content').innerHTML = `
  <div class="toolbar">
    <input type="date" id="tbFrom" class="input" value="${monthStart()}"> s/d
    <input type="date" id="tbTo" class="input" value="${today()}">
    <button class="btn primary" onclick="loadTB()">Tampilkan</button>
  </div><div id="tbBox"></div>`;
  window.loadTB = async () => {
    const d = await api(`/reports/trial-balance?from=${$('#tbFrom').value}&to=${$('#tbTo').value}`);
    $('#tbBox').innerHTML = `<div class="table-wrap"><table>
      <tr><th>Kode</th><th>Akun</th><th class="right">Debit</th><th class="right">Kredit</th></tr>
      ${d.rows.map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td>
        <td class="right">${r.debit ? fmt(r.debit) : ''}</td><td class="right">${r.credit ? fmt(r.credit) : ''}</td></tr>`).join('')}
      <tr class="grand"><td colspan=2>TOTAL</td><td class="right">${fmt(d.total_debit)}</td><td class="right">${fmt(d.total_credit)}</td></tr>
    </table></div><p class="${d.balanced ? 'muted' : 'err'} small">${d.balanced ? '✓ Debit = Kredit' : '✗ Tidak balance'}</p>`;
  };
  loadTB();
};

/* ---------- LAPORAN PENJUALAN ---------- */
PAGES['sales-report'] = async () => {
  $('#content').innerHTML = `
  <div class="toolbar">
    <input type="date" id="srFrom" class="input" value="${monthStart()}">
    <input type="date" id="srTo" class="input" value="${today()}">
    <button class="btn primary" onclick="loadSR()">Tampilkan</button>
    <button class="btn" onclick="window.print()">🖨 Cetak</button>
  </div><div id="srBox"></div>`;
  window.loadSR = async () => {
    const d = await api(`/reports/sales-summary?from=${$('#srFrom').value}&to=${$('#srTo').value}`);
    $('#srBox').innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card"><h3>Omset Harian per Store</h3><div class="table-wrap"><table>
        <tr><th>Tanggal</th><th>Store</th><th class="right">Transaksi</th><th class="right">Omset</th><th class="right">HPP</th><th class="right">Laba Kotor</th></tr>
        ${d.daily.map(r => `<tr><td>${esc(String(r.day).slice(0, 10))}</td><td>${esc(r.store_name)}</td>
          <td class="right">${r.transaksi}</td><td class="right">${fmt(r.omset)}</td><td class="right">${fmt(r.hpp)}</td>
          <td class="right">${fmt(Number(r.omset) - Number(r.tax || 0) - Number(r.hpp))}</td></tr>`).join('') || '<tr><td colspan=6 class="muted center">Tidak ada data</td></tr>'}
      </table></div></div>
      <div class="card"><h3>Produk Terlaris (Top 20)</h3><div class="table-wrap"><table>
        <tr><th>Produk</th><th class="right">Qty</th><th class="right">Revenue</th></tr>
        ${d.top_products.map(r => `<tr><td>${esc(r.name)}</td><td class="right">${Number(r.qty)}</td><td class="right">${fmt(r.revenue)}</td></tr>`).join('') || '<tr><td colspan=3 class="muted center">Tidak ada data</td></tr>'}
      </table></div></div>
    </div>`;
  };
  loadSR();
};

/* ---------- PELANGGAN ---------- */
PAGES.customers = async () => {
  const rows = await api('/master/customers');
  $('#content').innerHTML = `
  <div class="toolbar"><input id="cq" class="input" placeholder="Cari nama/telepon...">
    <button class="btn primary" onclick="customerForm()">➕ Tambah Pelanggan</button></div>
  <div class="table-wrap"><table>
    <tr><th>Nama</th><th>Telepon</th><th>Level</th><th class="right">Poin</th><th></th></tr>
    ${rows.map(c => `<tr data-s="${esc((c.name + ' ' + (c.phone || '')).toLowerCase())}">
      <td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td><span class="tag ${c.member_level === 'gold' ? 'amber' : 'gray'}">${esc(c.member_level)}</span></td>
      <td class="right">${c.points}</td><td><button class="btn sm" onclick='customerForm(${c.id})'>✏️</button></td></tr>`).join('')}
  </table></div>`;
  $('#cq').oninput = (e) => { const kw = e.target.value.toLowerCase();
    $$('#content tbody tr').forEach(tr => tr.style.display = tr.dataset.s.includes(kw) ? '' : 'none'); };
  window._custCache = rows;
};
window.customerForm = (id) => {
  const c = id ? (window._custCache || []).find(x => x.id === id) : {};
  openModal(id ? 'Edit Pelanggan' : 'Tambah Pelanggan', `
    ${modalField('name', 'Nama', c.name)} ${modalField('phone', 'Telepon', c.phone, 'text', false)}
    ${modalField('email', 'Email', c.email, 'text', false)}
    ${modalSelect('member_level', 'Level Member', [{ v: 'reguler', t: 'Reguler' }, { v: 'silver', t: 'Silver' }, { v: 'gold', t: 'Gold' }], c.member_level)}`,
  async () => {
    const v = formVals($('#modalBody'));
    if (id) await api(`/master/customers/${id}`, { method: 'PUT', body: { ...c, ...v } });
    else await api('/master/customers', { method: 'POST', body: v });
    toast('Tersimpan'); go('customers');
  });
};

/* ---------- SUPPLIER ---------- */
PAGES.suppliers = async () => {
  const [rows, balances] = await Promise.all([api('/master/suppliers'), api('/reports/supplier-balances')]);
  const bal = Object.fromEntries(balances.map(b => [b.id, Number(b.saldo_hutang)]));
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="supplierForm()">➕ Tambah Supplier</button></div>
  <div class="table-wrap"><table>
    <tr><th>Nama</th><th>Kontak</th><th>Telepon</th><th class="right">Tempo (hari)</th><th class="right">Saldo Hutang</th><th></th></tr>
    ${rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.contact)}</td><td>${esc(s.phone)}</td>
      <td class="right">${s.terms_days}</td><td class="right ${bal[s.id] > 0 ? 'err' : ''}">${fmt(bal[s.id] || 0)}</td>
      <td><button class="btn sm" onclick='supplierForm(${s.id})'>✏️</button></td></tr>`).join('')}
  </table></div>`;
  window._supCache = rows;
};
window.supplierForm = (id) => {
  const s = id ? (window._supCache || []).find(x => x.id === id) : {};
  openModal(id ? 'Edit Supplier' : 'Tambah Supplier', `
    ${modalField('name', 'Nama', s.name)} ${modalField('contact', 'Kontak Person', s.contact, 'text', false)}
    ${modalField('phone', 'Telepon', s.phone, 'text', false)} ${modalField('address', 'Alamat', s.address, 'text', false)}
    ${modalField('terms_days', 'Tempo Pembayaran (hari)', s.terms_days ?? 30, 'number', false)}`, async () => {
    const v = formVals($('#modalBody'));
    if (id) await api(`/master/suppliers/${id}`, { method: 'PUT', body: { ...s, ...v } });
    else await api('/master/suppliers', { method: 'POST', body: v });
    toast('Tersimpan'); go('suppliers');
  });
};

/* ---------- STORES ---------- */
PAGES.stores = async () => {
  const rows = await api('/master/stores');
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="storeForm()">➕ Tambah Store</button></div>
  <div class="table-wrap"><table>
    <tr><th>Kode</th><th>Nama</th><th>Alamat</th><th>Telepon</th><th>Utama?</th><th>Status</th><th></th></tr>
    ${rows.map(s => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(s.address || '')}</td><td>${esc(s.phone || '')}</td>
      <td>${s.is_main ? '⭐' : ''}</td><td><span class="tag ${s.status === 'active' ? 'green' : 'red'}">${esc(s.status)}</span></td>
      <td><button class="btn sm" onclick='storeForm(${s.id})'>✏️</button></td></tr>`).join('')}
  </table></div>`;
  window._storeCache = rows;
};
window.storeForm = (id) => {
  const s = id ? (window._storeCache || []).find(x => x.id === id) : {};
  openModal(id ? 'Edit Store' : 'Tambah Store', `
    ${modalField('name', 'Nama Store', s.name)} ${modalField('code', 'Kode', s.code)}
    ${modalField('address', 'Alamat', s.address, 'text', false)} ${modalField('phone', 'Telepon', s.phone, 'text', false)}`,
  async () => {
    const v = formVals($('#modalBody'));
    if (id) await api(`/master/stores/${id}`, { method: 'PUT', body: { ...s, ...v } });
    else await api('/master/stores', { method: 'POST', body: { ...v, tenant_id: STATE.user.tenant_id || Number(prompt('ID tenant baru?', 1)) } });
    toast('Tersimpan'); const me = await api('/auth/me'); STATE.stores = me.stores; showApp(); go('stores');
  });
};

/* ---------- USERS ---------- */
PAGES.users = async () => {
  const rows = await api('/master/users');
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="userForm()">➕ Tambah Pengguna</button></div>
  <div class="table-wrap"><table>
    <tr><th>Username</th><th>Nama</th><th>Role</th><th>Store</th><th>Status</th><th></th></tr>
    ${rows.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.full_name)}</td>
      <td><span class="tag blue">${esc(u.role)}</span></td><td>${esc((STATE.stores.find(s => s.id == u.store_id) || {}).name || 'Semua Store')}</td>
      <td><span class="tag ${u.status === 'active' ? 'green' : 'red'}">${esc(u.status)}</span></td>
      <td><button class="btn sm" onclick='userForm(${u.id})'>✏️ Reset/Ubah</button></td></tr>`).join('')}
  </table></div>`;
  window._userCache = rows;
};
window.userForm = (id) => {
  const u = id ? (window._userCache || []).find(x => x.id === id) : {};
  openModal(id ? 'Edit Pengguna' : 'Tambah Pengguna', `
    ${modalField('username', 'Username', u.username, 'text', !id)}
    ${modalField('full_name', 'Nama Lengkap', u.full_name)}
    ${modalSelect('role', 'Role', ['owner', 'admin', 'manager', 'cashier', 'accounting', 'warehouse'].map(r => ({ v: r, t: r })), u.role)}
    ${modalSelect('store_id', 'Store', [{ v: '', t: 'Semua Store' }, ...STATE.stores.map(s => ({ v: s.id, t: s.name }))], u.store_id)}
    ${modalField('password', id ? 'Reset Password (kosongkan jika tidak)' : 'Password', '', 'text', false)}`, async () => {
    const v = formVals($('#modalBody'));
    const body = { ...v, store_id: v.store_id ? Number(v.store_id) : null };
    if (!body.password) delete body.password;
    if (id) await api(`/master/users/${id}`, { method: 'PUT', body: { ...u, ...body } });
    else await api('/master/users', { method: 'POST', body });
    toast('Tersimpan'); go('users');
  });
};

/* ---------- TENANTS (SUPERADMIN) ---------- */
PAGES.tenants = async () => {
  const rows = await api('/saas/tenants');
  $('#content').innerHTML = `
  <div class="toolbar"><button class="btn primary" onclick="tenantForm()">➕ Daftar Tenant Baru</button></div>
  <div class="table-wrap"><table>
    <tr><th>ID</th><th>Nama</th><th>Slug</th><th>Plan</th><th>Status</th><th class="right">Stores</th><th class="right">Users</th><th></th></tr>
    ${rows.map(t => `<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.slug)}</td>
      <td><span class="tag blue">${esc(t.plan)}</span></td>
      <td><span class="tag ${t.status === 'active' ? 'green' : t.status === 'trial' ? 'amber' : 'red'}">${esc(t.status)}</span></td>
      <td class="right">${t.n_stores}</td><td class="right">${t.n_users}</td>
      <td><button class="btn sm" onclick="toggleTenant(${t.id},'${t.status === 'suspended' ? 'active' : 'suspended'}')">
        ${t.status === 'suspended' ? 'Aktifkan' : 'Suspensi'}</button></td></tr>`).join('')}
  </table></div>`;
};
window.tenantForm = () => {
  openModal('Tenant Baru (Onboarding)', `
    <div class="form-grid">${modalField('name', 'Nama Perusahaan')} ${modalField('slug', 'Slug (subdomain)')}</div>
    <div class="form-grid">${modalField('store_name', 'Nama Store Utama', '', 'text', false)} ${modalField('email', 'Email', '', 'text', false)}</div>
    ${modalSelect('plan', 'Paket Langganan', [['free', 'Free'], ['basic', 'Basic (Rp199rb/bln)'], ['pro', 'Pro (Rp499rb/bln)'], ['enterprise', 'Enterprise']].map(([v, t]) => ({ v, t })), 'basic')}
    <div class="form-grid">${modalField('owner_username', 'Username Owner')} ${modalField('owner_password', 'Password Owner', '', 'password')}</div>`,
  async () => {
    const v = formVals($('#modalBody'));
    await api('/saas/tenants', { method: 'POST', body: v });
    toast('Tenant dibuat + COA standar + owner siap login'); go('tenants');
  });
};
window.toggleTenant = async (id, status) => {
  const rows = await api('/saas/tenants');
  const t = rows.find(x => x.id === id);
  await api(`/saas/tenants/${id}`, { method: 'PUT', body: { name: t.name, plan: t.plan, status } });
  go('tenants');
};

/* ---------------- BOOT ---------------- */
tryBoot();
