-- =========================================================
-- POS SaaS Multi-Store - Skema Database (MySQL 8+)
-- Karakter: utf8mb4, Engine: InnoDB
-- Catatan: seed data demo dibuat via `npm run db:init`
-- =========================================================

CREATE DATABASE IF NOT EXISTS pos_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pos_saas;

-- ---------- TENANT / SAAS ----------
CREATE TABLE tenants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  domain VARCHAR(150) NULL UNIQUE,
  plan VARCHAR(30) NOT NULL DEFAULT 'free',
  status ENUM('active','suspended','trial') NOT NULL DEFAULT 'trial',
  contact_email VARCHAR(150),
  contact_phone VARCHAR(30),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  plan VARCHAR(30) NOT NULL,
  price DECIMAL(15,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sub_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_sub_tenant (tenant_id, status)
) ENGINE=InnoDB;

-- ---------- STORE ----------
CREATE TABLE stores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20) NOT NULL,
  address TEXT,
  phone VARCHAR(30),
  email VARCHAR(150),
  is_main TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_store_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_store_code (tenant_id, code)
) ENGINE=InnoDB;

-- ---------- USERS & ROLES ----------
CREATE TABLE roles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  level INT NOT NULL DEFAULT 5
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NULL,
  store_id BIGINT UNSIGNED NULL,
  role_id INT UNSIGNED NOT NULL,
  username VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(30),
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  last_login DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_role FOREIGN KEY (role_id) REFERENCES roles(id),
  UNIQUE KEY uq_user_username (username)
) ENGINE=InnoDB;

CREATE TABLE user_stores (
  user_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, store_id),
  CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_us_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- MASTER DATA ----------
CREATE TABLE categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  CONSTRAINT fk_cat_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cat (tenant_id, name)
) ENGINE=InnoDB;

CREATE TABLE suppliers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  contact VARCHAR(120), phone VARCHAR(30), email VARCHAR(150),
  address TEXT,
  tax_npwp VARCHAR(30),
  terms_days INT NOT NULL DEFAULT 30,
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('active','inactive') DEFAULT 'active',
  CONSTRAINT fk_sup_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(30), email VARCHAR(150), address TEXT,
  member_level VARCHAR(30) DEFAULT 'reguler',
  points INT NOT NULL DEFAULT 0,
  credit_limit DECIMAL(15,2) NOT NULL DEFAULT 0,
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('active','inactive') DEFAULT 'active',
  CONSTRAINT fk_cus_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_cus_phone (tenant_id, phone)
) ENGINE=InnoDB;

CREATE TABLE products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  sku VARCHAR(60) NOT NULL,
  barcode VARCHAR(60),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  unit VARCHAR(20) DEFAULT 'pcs',
  cost_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  sell_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  member_price DECIMAL(15,2) NULL,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  image_url VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_prod_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  UNIQUE KEY uq_prod_sku (tenant_id, sku),
  INDEX idx_prod_barcode (tenant_id, barcode)
) ENGINE=InnoDB;

CREATE TABLE stocks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  avg_cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  min_stock DECIMAL(15,3) NOT NULL DEFAULT 0,
  max_stock DECIMAL(15,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_prod FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_stock (store_id, product_id)
) ENGINE=InnoDB;

CREATE TABLE stock_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  type ENUM('sale','purchase','transfer_in','transfer_out','adjustment','return_in','return_out','po_receive') NOT NULL,
  ref_type VARCHAR(30), ref_id BIGINT UNSIGNED,
  qty DECIMAL(15,3) NOT NULL,
  cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  note VARCHAR(255),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sm (tenant_id, store_id, product_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE stock_transfers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  from_store_id BIGINT UNSIGNED NOT NULL,
  to_store_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','approved','received','cancelled') NOT NULL DEFAULT 'pending',
  note VARCHAR(255),
  requested_by BIGINT UNSIGNED, approved_by BIGINT UNSIGNED, received_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tr_from FOREIGN KEY (from_store_id) REFERENCES stores(id),
  CONSTRAINT fk_tr_to FOREIGN KEY (to_store_id) REFERENCES stores(id),
  UNIQUE KEY uq_tr_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE stock_transfer_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transfer_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(15,3) NOT NULL,
  CONSTRAINT fk_tri_tr FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- PENJUALAN (POS) ----------
CREATE TABLE sales (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  cashier_id BIGINT UNSIGNED,
  shift_id BIGINT UNSIGNED NULL,
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  change_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(30) NOT NULL DEFAULT 'cash',
  status ENUM('completed','voided','refunded') NOT NULL DEFAULT 'completed',
  note VARCHAR(255),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_store FOREIGN KEY (store_id) REFERENCES stores(id),
  CONSTRAINT fk_sale_cust FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  UNIQUE KEY uq_sale_code (tenant_id, code),
  INDEX idx_sale_date (tenant_id, store_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE sale_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(15,3) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_si_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_si_prod FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE sale_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id BIGINT UNSIGNED NOT NULL,
  method VARCHAR(30) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  reference VARCHAR(80),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sp_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE returns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  sale_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  reason VARCHAR(255),
  total_refund DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ret_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  UNIQUE KEY uq_ret_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE return_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  return_id BIGINT UNSIGNED NOT NULL,
  sale_item_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(15,3) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  CONSTRAINT fk_ri_ret FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE shifts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  cashier_id BIGINT UNSIGNED NOT NULL,
  open_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  close_at DATETIME NULL,
  opening_cash DECIMAL(15,2) NOT NULL DEFAULT 0,
  expected_cash DECIMAL(15,2),
  counted_cash DECIMAL(15,2),
  difference DECIMAL(15,2),
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  note VARCHAR(255)
) ENGINE=InnoDB;

-- ---------- PEMBELIAN / INVENTORY ----------
CREATE TABLE purchase_orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  order_date DATE NOT NULL,
  expected_date DATE,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('draft','approved','partial','received','cancelled') NOT NULL DEFAULT 'draft',
  note VARCHAR(255),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_sup FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  UNIQUE KEY uq_po_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE purchase_order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(15,3) NOT NULL,
  received_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  price DECIMAL(15,2) NOT NULL,
  CONSTRAINT fk_poi_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE goods_receipts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  po_id BIGINT UNSIGNED NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  receive_date DATE NOT NULL,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  status ENUM('posted','cancelled') NOT NULL DEFAULT 'posted',
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gr_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE goods_receipt_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  gr_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(15,3) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  CONSTRAINT fk_gri_gr FOREIGN KEY (gr_id) REFERENCES goods_receipts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE purchase_returns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  gr_id BIGINT UNSIGNED NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  ret_date DATE NOT NULL,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  reason VARCHAR(255),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pr_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE purchase_return_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pr_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty DECIMAL(15,3) NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  CONSTRAINT fk_pri_pr FOREIGN KEY (pr_id) REFERENCES purchase_returns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE stock_opnames (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  opname_date DATE NOT NULL,
  status ENUM('draft','posted') NOT NULL DEFAULT 'draft',
  note VARCHAR(255),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_on_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE stock_opname_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  opname_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  system_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  actual_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  diff_qty DECIMAL(15,3) NOT NULL DEFAULT 0,
  cost DECIMAL(15,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_oni_on FOREIGN KEY (opname_id) REFERENCES stock_opnames(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- AKUNTANSI & KEUANGAN ----------
CREATE TABLE chart_of_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  subtype VARCHAR(50),
  is_header TINYINT(1) NOT NULL DEFAULT 0,
  parent_id BIGINT UNSIGNED NULL,
  CONSTRAINT fk_coa_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_coa (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE journals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  code VARCHAR(30) NOT NULL,
  journal_date DATE NOT NULL,
  ref_type VARCHAR(30) NOT NULL DEFAULT 'manual',
  ref_id BIGINT UNSIGNED NULL,
  description VARCHAR(255),
  posted TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_j_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_j_code (tenant_id, code),
  INDEX idx_j_date (tenant_id, journal_date)
) ENGINE=InnoDB;

CREATE TABLE journal_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  journal_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  debit DECIMAL(15,2) NOT NULL DEFAULT 0,
  credit DECIMAL(15,2) NOT NULL DEFAULT 0,
  memo VARCHAR(150),
  CONSTRAINT fk_jl_j FOREIGN KEY (journal_id) REFERENCES journals(id) ON DELETE CASCADE,
  CONSTRAINT fk_jl_acc FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id),
  INDEX idx_jl_acc (account_id)
) ENGINE=InnoDB;

CREATE TABLE expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  expense_date DATE NOT NULL,
  category VARCHAR(100),
  account_id BIGINT UNSIGNED NULL,
  supplier_id BIGINT UNSIGNED NULL,
  amount DECIMAL(15,2) NOT NULL,
  pay_method VARCHAR(30) NOT NULL DEFAULT 'cash',
  description VARCHAR(255),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exp_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE payments_in (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  code VARCHAR(30) NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  pay_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  pay_method VARCHAR(30) NOT NULL DEFAULT 'cash',
  reference VARCHAR(80),
  description VARCHAR(255),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pi_code (tenant_id, code)
) ENGINE=InnoDB;

CREATE TABLE payments_out (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  store_id BIGINT UNSIGNED NULL,
  code VARCHAR(30) NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  gr_id BIGINT UNSIGNED NULL,
  pay_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  pay_method VARCHAR(30) NOT NULL DEFAULT 'cash',
  reference VARCHAR(80),
  description VARCHAR(255),
  created_by BIGINT UNSIGNED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_po_pay_code (tenant_id, code)
) ENGINE=InnoDB;

-- ---------- LOG AKTIVITAS ----------
CREATE TABLE activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  detail VARCHAR(500),
  ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log (tenant_id, created_at)
) ENGINE=InnoDB;
