#!/usr/bin/env node
// Inisialisasi database: jalankan schema.sql lalu seed data demo.
// Cara pakai: npm run db:init  (atau: node scripts/init-db.js)
require('../src/lib/env');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };
  const conn = await mysql.createConnection(cfg);

  console.log('1/3 Menjalankan schema.sql ...');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await conn.query(schema);

  await conn.query(`USE \`${process.env.DB_NAME || 'pos_saas'}\``);

  console.log('2/3 Seed roles & tenant demo ...');
  const [existing] = await conn.query('SELECT COUNT(*) c FROM roles');
  if (existing[0].c === 0) {
    await conn.query(`INSERT INTO roles (name, level) VALUES
      ('superadmin',0),('owner',1),('admin',2),('manager',3),('cashier',4),('accounting',3),('warehouse',4)`);
  }

  const hash = await bcrypt.hash('admin123', 10);
  const [tRows] = await conn.query("SELECT id FROM tenants WHERE slug='majujaya'");
  let tenantId;
  if (!tRows.length) {
    const r = await conn.query(
      "INSERT INTO tenants (name,slug,plan,status,contact_email) VALUES ('Toko Maju Jaya','majujaya','pro','active','owner@majujaya.id')");
    tenantId = r[0].insertId;
    const s1 = await conn.query("INSERT INTO stores (tenant_id,name,code,address,phone,is_main) VALUES (?,?,?,?,?,1)",
      [tenantId, 'Maju Jaya Pusat', 'MJ-01', 'Jl. Sudirman No. 1, Jakarta', '021-5550001']);
    const s2 = await conn.query("INSERT INTO stores (tenant_id,name,code,address,phone,is_main) VALUES (?,?,?,?,?,0)",
      [tenantId, 'Maju Jaya Bandung', 'MJ-02', 'Jl. Asia Afrika No. 10, Bandung', '022-5550002']);
    const [roleIds] = await conn.query('SELECT id,name FROM roles');
    const rid = Object.fromEntries(roleIds.map(x => [x.name, x.id]));
    const users = [
      [null, rid.owner, 'owner', 'Budi Owner', 'owner@majujaya.id'],
      [null, rid.admin, 'admin', 'Sari Admin', 'admin@majujaya.id'],
      [s1[0].insertId, rid.cashier, 'kasir1', 'Rina Kasir', 'rina@majujaya.id'],
      [s2[0].insertId, rid.cashier, 'kasir2', 'Doni Kasir', 'doni@majujaya.id'],
      [null, rid.accounting, 'akunting', 'May Accounting', 'may@majujaya.id'],
    ];
    for (const u of users) {
      await conn.query(
        'INSERT INTO users (tenant_id,store_id,role_id,username,password_hash,full_name,email) VALUES (?,?,?,?,?,?,?)',
        [tenantId, u[0], u[1], u[2], hash, u[3], u[4]]);
    }
    // kategori + produk + stok
    const catIds = {};
    for (const nm of ['Minuman', 'Snack', 'Rumah Tangga']) {
      const cr = await conn.query('INSERT INTO categories (tenant_id,name) VALUES (?,?)', [tenantId, nm]);
      catIds[nm] = cr[0].insertId;
    }
    const prods = [
      ['MIN-AIR6', '8991001', 'Air Mineral 600ml (isi 24)', 'pck', 38000, 55000, catIds['Minuman'], 40],
      ['MIN-KOPB', '8991002', 'Kopi Botol 250ml', 'pcs', 3500, 6000, catIds['Minuman'], 120],
      ['SNK-ROTI', '8991003', 'Roti Isi Cokelat', 'pcs', 2500, 4500, catIds['Snack'], 80],
      ['SNK-BISK', '8991004', 'Biskuit Kaleng 200g', 'pcs', 9000, 14000, catIds['Snack'], 40],
      ['RT-DTS', '8991005', 'Detergen Cair 800ml', 'btl', 18000, 26000, catIds['Rumah Tangga'], 25],
      ['RT-SBR', '8991006', 'Sabun Batang 3x', 'pck', 6500, 10000, catIds['Rumah Tangga'], 60],
    ];
    const storeIds = [s1[0].insertId, s2[0].insertId];
    for (const p of prods) {
      const pr = await conn.query(
        'INSERT INTO products (tenant_id,category_id,sku,barcode,name,unit,cost_price,sell_price,tax_rate) VALUES (?,?,?,?,?,?,?,?,11)',
        [tenantId, p[6], p[0], p[1], p[2], p[3], p[4], p[5]]);
      await conn.query('INSERT INTO stocks (tenant_id,store_id,product_id,qty,avg_cost,min_stock) VALUES (?,?,?,?,?,10)',
        [tenantId, storeIds[0], pr[0].insertId, p[7], p[4]]);
      await conn.query('INSERT INTO stocks (tenant_id,store_id,product_id,qty,avg_cost,min_stock) VALUES (?,?,?,?,?,10)',
        [tenantId, storeIds[1], pr[0].insertId, Math.floor(p[7] / 2), p[4]]);
    }
    await conn.query(
      `INSERT INTO suppliers (tenant_id,name,contact,phone,terms_days) VALUES
       (?,'CV Sumber Rejeki','Lina','021-1112223',30),(?,'PT Makmur Sentosa','Joko','022-3334445',14)`,
      [tenantId, tenantId]);
    await conn.query(
      `INSERT INTO customers (tenant_id,name,phone,member_level,points) VALUES
       (?,'Umum','','reguler',0),(?,'Ibu Ani','0812345678','gold',120),(?,'Pak Budi','0819876543','silver',45)`,
      [tenantId, tenantId, tenantId]);
    await conn.query(
      "INSERT INTO subscriptions (tenant_id,plan,price,start_date,end_date) VALUES (?,'pro',499000,CURDATE(),CURDATE()+INTERVAL 335 DAY)",
      [tenantId]);
  } else {
    tenantId = tRows[0].id;
  }

  // COA standar (idempotent) untuk semua tenant
  console.log('3/3 Menyemai Chart of Accounts standar ...');
  const coa = [
    ['1-1000', 'Kas & Bank', 'asset', 'cash', 1],
    ['1-1010', 'Kas Kecil', 'asset', 'cash', 0],
    ['1-1020', 'Bank BCA', 'asset', 'cash', 0],
    ['1-1100', 'Piutang Usaha', 'asset', 'receivable', 0],
    ['1-1200', 'Persediaan Barang Dagang', 'asset', 'inventory', 0],
    ['1-1300', 'Asuransi Dibayar Dimuka', 'asset', 'prepaid', 0],
    ['1-1500', 'Pajak Masukan (PPN)', 'asset', 'tax', 0],
    ['1-2000', 'Aset Tetap', 'asset', 'fixed', 1],
    ['1-2010', 'Peralatan Toko', 'asset', 'fixed', 0],
    ['1-2020', 'Akumulasi Penyusutan Peralatan', 'asset', 'fixed', 0],
    ['2-1000', 'Hutang Usaha', 'liability', 'payable', 0],
    ['2-1100', 'Hutang Pajak (PPN Keluaran)', 'liability', 'tax', 0],
    ['2-1200', 'Hutang Gaji', 'liability', 'payable', 0],
    ['2-2000', 'Hutang Bank', 'liability', 'loan', 0],
    ['3-1000', 'Modal Pemilik', 'equity', 'capital', 0],
    ['3-1100', 'Laba Ditahan', 'equity', 'retained', 0],
    ['4-1000', 'Pendapatan Penjualan', 'revenue', 'sales', 0],
    ['4-1100', 'Pendapatan Lain-lain', 'revenue', 'other', 0],
    ['4-1200', 'Potongan Penjualan', 'revenue', 'contra', 0],
    ['5-1000', 'Harga Pokok Penjualan', 'expense', 'cogs', 0],
    ['5-1100', 'Beban Gaji & Upah', 'expense', 'opex', 0],
    ['5-1200', 'Beban Sewa', 'expense', 'opex', 0],
    ['5-1300', 'Beban Listrik & Air', 'expense', 'opex', 0],
    ['5-1400', 'Beban Internet & Telepon', 'expense', 'opex', 0],
    ['5-1500', 'Beban Penyusutan', 'expense', 'opex', 0],
    ['5-1600', 'Beban Operasional Lainnya', 'expense', 'opex', 0],
    ['5-1700', 'Beban Administrasi Bank', 'expense', 'opex', 0],
  ];
  const [tenants] = await conn.query('SELECT id FROM tenants');
  for (const t of tenants) {
    for (const c of coa) {
      await conn.query(
        'INSERT IGNORE INTO chart_of_accounts (tenant_id,code,name,type,subtype,is_header) VALUES (?,?,?,?,?,?)',
        [t.id, ...c]);
    }
  }

  // superadmin platform (bila belum ada)
  const [su] = await conn.query("SELECT id FROM users WHERE username='superadmin'");
  if (!su.length) {
    const [role] = await conn.query("SELECT id FROM roles WHERE name='superadmin'");
    await conn.query(
      'INSERT INTO users (tenant_id,role_id,username,password_hash,full_name,email) VALUES (NULL,?,?,?,?,?)',
      [role[0].id, 'superadmin', hash, 'Platform Super Admin', 'super@possaas.id']);
  }

  await conn.end();
  console.log('\n=== Selesai. Akun demo (password: admin123) ===');
  console.log('superadmin | owner | admin | kasir1 | kasir2 | akunting');
}

main().catch(e => { console.error('Gagal init DB:', e.message); process.exit(1); });
