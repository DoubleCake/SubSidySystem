"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
class SqlJsWrapper {
  db;
  dbPath;
  constructor(db2, dbPath) {
    this.db = db2;
    this.dbPath = dbPath;
  }
  /** 执行 SQL（INSERT/UPDATE/DELETE），自动保存 */
  run(sql, params = {}) {
    const { query, positionalParams } = this.convertNamedParams(sql, params);
    this.db.run(query, positionalParams);
    this.save();
    const rows = this.db.exec("SELECT last_insert_rowid() as id");
    const lastId = Number(rows[0]?.values[0]?.[0] || 0);
    return { changes: 1, lastInsertRowid: lastId };
  }
  /** 执行查询，返回第一条记录 */
  get(sql, params = {}) {
    const { query, positionalParams } = this.convertNamedParams(sql, params);
    const stmt = this.db.prepare(query);
    stmt.bind(positionalParams);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
      return obj;
    }
    stmt.free();
    return void 0;
  }
  /** 执行查询，返回所有记录 */
  all(sql, params = {}) {
    const { query, positionalParams } = this.convertNamedParams(sql, params);
    const stmt = this.db.prepare(query);
    stmt.bind(positionalParams);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
  /** 执行原始 SQL（不转换参数），返回所有记录 */
  allRaw(sql, ...params) {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
  /** 执行原始 SQL 并返回第一条 */
  getRaw(sql, ...params) {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
      return obj;
    }
    stmt.free();
    return void 0;
  }
  /** 执行原始 SQL（INSERT/UPDATE/DELETE），自动保存 */
  runRaw(sql, ...params) {
    this.db.run(sql, params);
    this.save();
    const rows = this.db.exec("SELECT last_insert_rowid() as id");
    const lastId = Number(rows[0]?.values[0]?.[0] || 0);
    return { changes: 1, lastInsertRowid: lastId };
  }
  /** 批量执行 SQL */
  exec(sql) {
    this.db.exec(sql);
    this.save();
  }
  /** 注册自定义 SQL 函数 */
  createFunction(_name, _fn) {
  }
  /** 保存到磁盘 */
  save() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (e) {
      console.error("保存数据库失败:", e);
    }
  }
  /** 关闭数据库 */
  close() {
    this.save();
    this.db.close();
  }
  /** 将 @param 命名参数转为 ? 位置参数 */
  convertNamedParams(sql, params) {
    const positionalParams = [];
    const query = sql.replace(/@(\w+)/g, (_match, name) => {
      positionalParams.push(params[name] ?? null);
      return "?";
    });
    return { query, positionalParams };
  }
}
let db = null;
async function initDatabase(dbPath) {
  const resolvedPath = path.join(electron.app.getPath("userData"), "subsidy.db");
  const dir = require("path").dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  let sqliteDb;
  if (fs.existsSync(resolvedPath)) {
    const fileBuffer = fs.readFileSync(resolvedPath);
    sqliteDb = new SQL.Database(fileBuffer);
  } else {
    sqliteDb = new SQL.Database();
  }
  sqliteDb.run("PRAGMA foreign_keys = ON");
  db = new SqlJsWrapper(sqliteDb, resolvedPath);
}
function getDb() {
  if (!db) throw new Error("数据库未初始化，请先调用 initDatabase()");
  return db;
}
function getDbPath() {
  return path.join(electron.app.getPath("userData"), "subsidy.db");
}
function runMigrations() {
  const db2 = getDb();
  db2.exec("PRAGMA foreign_keys = ON");
  db2.exec(`
    CREATE TABLE IF NOT EXISTS village (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      village_name VARCHAR(50) NOT NULL UNIQUE,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS family_household (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_code VARCHAR(30) NOT NULL UNIQUE,
      household_name VARCHAR(50) NOT NULL,
      head_farmer_id INTEGER,
      village_id INTEGER NOT NULL REFERENCES village(id),
      group_no SMALLINT NOT NULL DEFAULT 1,
      address VARCHAR(200),
      registered_address VARCHAR(200),
      contract_area DECIMAL(10,2),
      confirmed_area DECIMAL(10,2),
      status SMALLINT NOT NULL DEFAULT 1,
      is_manually_confirmed SMALLINT NOT NULL DEFAULT 0,
      manually_confirmed_at DATETIME,
      manually_confirmed_by VARCHAR(50),
      remark TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS farmer_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES family_household(id),
      real_name VARCHAR(50) NOT NULL,
      gender SMALLINT NOT NULL,
      id_card VARCHAR(18) NOT NULL UNIQUE,
      phone VARCHAR(20),
      bank_card VARCHAR(25),
      bank_name VARCHAR(100),
      relation VARCHAR(20) DEFAULT '本人',
      farmer_status SMALLINT NOT NULL DEFAULT 1,
      own_village_id INTEGER REFERENCES village(id),
      own_group_no SMALLINT,
      remark TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS subsidy_type (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsidy_name VARCHAR(100) NOT NULL,
      subsidy_year SMALLINT NOT NULL,
      calc_mode VARCHAR(10) NOT NULL DEFAULT 'fixed',
      standard_amount DECIMAL(10,2),
      standard_unit VARCHAR(20),
      fund_source VARCHAR(50),
      category VARCHAR(50),
      season VARCHAR(20) NOT NULL DEFAULT '全年单补',
      apply_deadline DATE,
      pay_status SMALLINT NOT NULL DEFAULT 0,
      description TEXT,
      count_toward_area SMALLINT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS subsidy_application (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL REFERENCES farmer_profile(id),
      beneficiary_id INTEGER NOT NULL REFERENCES farmer_profile(id),
      subsidy_type_id INTEGER NOT NULL REFERENCES subsidy_type(id),
      apply_year SMALLINT NOT NULL,
      apply_amount DECIMAL(10,2),
      actual_amount DECIMAL(10,2),
      apply_area DECIMAL(10,2),
      contract_area DECIMAL(10,2),
      trust_area DECIMAL(10,2),
      no_subsidy_area DECIMAL(10,2),
      pay_status SMALLINT NOT NULL DEFAULT 0,
      pay_date DATE,
      apply_village_id INTEGER REFERENCES village(id),
      apply_group_no SMALLINT,
      apply_village_name VARCHAR(50),
      apply_group_display VARCHAR(20),
      bank_card_snapshot VARCHAR(25),
      operator_id INTEGER,
      remark TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      is_proxy SMALLINT NOT NULL DEFAULT 0,
      UNIQUE(farmer_id, subsidy_type_id, apply_year)
    );

    CREATE TABLE IF NOT EXISTS subsidy_payment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL REFERENCES farmer_profile(id),
      beneficiary_id INTEGER NOT NULL REFERENCES farmer_profile(id),
      subsidy_type_id INTEGER NOT NULL REFERENCES subsidy_type(id),
      payment_year SMALLINT NOT NULL,
      amount DECIMAL(10,2),
      payment_date DATE,
      payment_village_id INTEGER REFERENCES village(id),
      payment_group_no SMALLINT,
      payment_village_name VARCHAR(50),
      payment_group_display VARCHAR(20),
      apply_area DECIMAL(10,2),
      contract_area DECIMAL(10,2),
      trust_area DECIMAL(10,2),
      no_subsidy_area DECIMAL(10,2),
      bank_card VARCHAR(25),
      bank_name VARCHAR(50),
      operator_id INTEGER,
      remark TEXT,
      proxy_remark TEXT,
      pay_status SMALLINT NOT NULL DEFAULT 2,
      is_proxy SMALLINT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(farmer_id, subsidy_type_id, payment_year)
    );

    CREATE TABLE IF NOT EXISTS subsidy_proxy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER REFERENCES subsidy_application(id),
      payment_id INTEGER REFERENCES subsidy_payment(id),
      subsidy_type_id INTEGER REFERENCES subsidy_type(id),
      beneficiary_farmer_id INTEGER NOT NULL REFERENCES farmer_profile(id),
      proxy_farmer_id INTEGER NOT NULL REFERENCES farmer_profile(id),
      proxy_type VARCHAR(20) NOT NULL,
      remark TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS household_area_usage_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES family_household(id),
      year SMALLINT NOT NULL,
      season VARCHAR(20) NOT NULL,
      apply_area NUMERIC(10,2) DEFAULT 0,
      payment_area NUMERIC(10,2) DEFAULT 0,
      used_area NUMERIC(10,2) DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(household_id, year, season)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER,
      operator_name VARCHAR(50) NOT NULL DEFAULT '系统',
      action VARCHAR(50) NOT NULL,
      table_name VARCHAR(50) NOT NULL,
      record_id INTEGER,
      before_data TEXT,
      after_data TEXT,
      ip_address VARCHAR(50),
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS subsidy_eligibility_rule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsidy_type_id INTEGER NOT NULL REFERENCES subsidy_type(id),
      rule_name VARCHAR(100) NOT NULL,
      rule_desc TEXT,
      require_farmer_status SMALLINT DEFAULT 1,
      require_age_min SMALLINT,
      require_age_max SMALLINT,
      require_land_type VARCHAR(20),
      require_min_area DECIMAL(10,2),
      require_max_area DECIMAL(10,2),
      require_not_idle SMALLINT NOT NULL DEFAULT 0,
      require_contract_valid SMALLINT NOT NULL DEFAULT 0,
      can_combine_with_others SMALLINT NOT NULL DEFAULT 1,
      exclusive_with TEXT,
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS excel_column_template (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_name VARCHAR(200) NOT NULL,
      template_year SMALLINT,
      region_name VARCHAR(100),
      business_type VARCHAR(20) NOT NULL DEFAULT 'SUBSIDY',
      subsidy_type_id INTEGER,
      header_row SMALLINT NOT NULL DEFAULT 1,
      data_start_row SMALLINT NOT NULL DEFAULT 2,
      skip_footer_rows SMALLINT NOT NULL DEFAULT 0,
      column_mapping TEXT NOT NULL,
      skip_rules TEXT,
      value_mapping TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at DATETIME,
      created_by VARCHAR(50),
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS excel_import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER,
      template_name VARCHAR(200),
      file_name VARCHAR(500) NOT NULL,
      file_hash VARCHAR(64),
      business_type VARCHAR(20) NOT NULL,
      region_name VARCHAR(100),
      import_year SMALLINT,
      total_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      rule_failed_count INTEGER NOT NULL DEFAULT 0,
      error_detail TEXT,
      warning_detail TEXT,
      rule_fail_detail TEXT,
      column_mapping_used TEXT,
      operator VARCHAR(50),
      import_duration_ms INTEGER,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS land_trust (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_household_id INTEGER NOT NULL REFERENCES family_household(id),
      operator_household_id INTEGER REFERENCES family_household(id),
      trust_type VARCHAR(20) NOT NULL DEFAULT 'ENTRUST',
      area DECIMAL(10,2),
      trust_year SMALLINT NOT NULL,
      start_date DATE,
      end_date DATE,
      annual_fee DECIMAL(10,2),
      payment_method VARCHAR(20),
      fee_note TEXT,
      parcel_desc VARCHAR(200),
      data_reliability VARCHAR(20) NOT NULL DEFAULT 'VILLAGE_CONFIRM',
      affect_subsidy_calc SMALLINT NOT NULL DEFAULT 1,
      verified_by VARCHAR(50),
      verified_date DATE,
      note TEXT,
      operator VARCHAR(50),
      is_active SMALLINT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS household_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES family_household(id),
      related_hh_id INTEGER,
      event_type VARCHAR(30) NOT NULL,
      event_year SMALLINT NOT NULL,
      event_date DATE,
      date_accuracy VARCHAR(10) NOT NULL DEFAULT 'YEAR',
      before_snapshot TEXT,
      after_snapshot TEXT,
      farmer_id INTEGER,
      farmer_name VARCHAR(50),
      description TEXT NOT NULL DEFAULT '',
      evidence_type VARCHAR(20),
      evidence_note VARCHAR(200),
      operator VARCHAR(50),
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS village_group (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      village_id INTEGER NOT NULL REFERENCES village(id),
      group_no VARCHAR(20) NOT NULL,
      UNIQUE(village_id, group_no)
    );

    CREATE TABLE IF NOT EXISTS village_land_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      village_id INTEGER NOT NULL UNIQUE REFERENCES village(id),
      survey_year SMALLINT,
      paddy_area DECIMAL(10,2),
      dry_land_area DECIMAL(10,2),
      arable_area DECIMAL(10,2),
      irrigation_level VARCHAR(20),
      terrain_type VARCHAR(20),
      soil_quality VARCHAR(20),
      remark TEXT,
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS agri_task (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_name VARCHAR(100) NOT NULL,
      crop_type VARCHAR(30) NOT NULL,
      total_area DECIMAL(10,2) NOT NULL,
      task_year SMALLINT NOT NULL,
      season VARCHAR(20),
      alloc_method VARCHAR(30) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
      description TEXT,
      operator VARCHAR(50),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS agri_task_allocation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES agri_task(id),
      village_id INTEGER NOT NULL REFERENCES village(id),
      village_name VARCHAR(50) NOT NULL,
      alloc_area DECIMAL(10,2) NOT NULL,
      alloc_ratio DECIMAL(8,6),
      basis_area DECIMAL(10,2),
      actual_area DECIMAL(10,2),
      remark TEXT,
      UNIQUE(task_id, village_id)
    );

    CREATE TABLE IF NOT EXISTS error_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      real_name VARCHAR(50) NOT NULL,
      id_card VARCHAR(18) NOT NULL,
      error_type VARCHAR(20) NOT NULL,
      error_reason TEXT NOT NULL,
      source VARCHAR(20) NOT NULL DEFAULT '手动录入',
      village_name VARCHAR(50),
      group_no VARCHAR(20),
      subsidy_name VARCHAR(100),
      discovered_date VARCHAR(10),
      subsidy_type_id INTEGER,
      remark TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS large_farmer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_name VARCHAR(100) NOT NULL,
      operator_type VARCHAR(20) NOT NULL DEFAULT 'FAMILY_FARM',
      id_card VARCHAR(18),
      phone VARCHAR(20),
      bank_card VARCHAR(25),
      bank_name VARCHAR(100),
      village_id INTEGER NOT NULL REFERENCES village(id),
      group_no SMALLINT,
      address VARCHAR(200),
      total_managed_area DECIMAL(10,2),
      own_contract_area DECIMAL(10,2),
      trust_in_area DECIMAL(10,2),
      main_crops VARCHAR(200),
      registration_no VARCHAR(50),
      registration_date DATE,
      farmer_grade VARCHAR(20),
      credit_score SMALLINT,
      status SMALLINT NOT NULL DEFAULT 1,
      is_verified SMALLINT NOT NULL DEFAULT 0,
      verified_by VARCHAR(50),
      verified_date DATE,
      remark TEXT,
      operator VARCHAR(50),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS large_farmer_parcel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      large_farmer_id INTEGER NOT NULL REFERENCES large_farmer(id),
      trust_id INTEGER,
      parcel_name VARCHAR(100),
      area DECIMAL(10,2) NOT NULL,
      village_id INTEGER NOT NULL REFERENCES village(id),
      group_no SMALLINT,
      parcel_location VARCHAR(200),
      boundary_east VARCHAR(100),
      boundary_west VARCHAR(100),
      boundary_south VARCHAR(100),
      boundary_north VARCHAR(100),
      is_high_standard SMALLINT NOT NULL DEFAULT 0,
      is_demonstration SMALLINT NOT NULL DEFAULT 0,
      zone_name VARCHAR(100),
      zone_type VARCHAR(50),
      soil_grade VARCHAR(20),
      soil_type VARCHAR(50),
      irrigation_level VARCHAR(20),
      map_coordinates TEXT,
      map_geojson TEXT,
      map_center_lng DECIMAL(12,8),
      map_center_lat DECIMAL(12,8),
      map_zoom SMALLINT,
      current_crop VARCHAR(50),
      planting_season VARCHAR(20),
      planting_year SMALLINT,
      is_active SMALLINT NOT NULL DEFAULT 1,
      remark TEXT,
      operator VARCHAR(50),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS large_farmer_trust (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      large_farmer_id INTEGER NOT NULL REFERENCES large_farmer(id),
      owner_household_id INTEGER NOT NULL REFERENCES family_household(id),
      land_trust_id INTEGER REFERENCES land_trust(id),
      trust_year SMALLINT NOT NULL,
      area DECIMAL(10,2) NOT NULL,
      trust_type VARCHAR(20) NOT NULL DEFAULT 'ENTRUST',
      parcel_village_id INTEGER REFERENCES village(id),
      parcel_group_no SMALLINT,
      parcel_desc VARCHAR(200),
      parcel_location VARCHAR(200),
      is_high_standard SMALLINT NOT NULL DEFAULT 0,
      is_demonstration SMALLINT NOT NULL DEFAULT 0,
      zone_name VARCHAR(100),
      contract_no VARCHAR(50),
      start_date DATE,
      end_date DATE,
      reminder_sent SMALLINT NOT NULL DEFAULT 0,
      reminder_days SMALLINT,
      annual_fee DECIMAL(10,2),
      total_fee DECIMAL(10,2),
      payment_method VARCHAR(20),
      payment_status VARCHAR(20),
      data_reliability VARCHAR(20) NOT NULL DEFAULT 'VILLAGE_CONFIRM',
      is_active SMALLINT NOT NULL DEFAULT 1,
      affect_subsidy_calc SMALLINT NOT NULL DEFAULT 1,
      note TEXT,
      operator VARCHAR(50),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS large_farmer_contract_reminder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trust_id INTEGER NOT NULL REFERENCES large_farmer_trust(id),
      large_farmer_id INTEGER NOT NULL REFERENCES large_farmer(id),
      reminder_type VARCHAR(20) NOT NULL,
      reminder_date DATE NOT NULL,
      contract_end_date DATE NOT NULL,
      days_before SMALLINT,
      is_sent SMALLINT NOT NULL DEFAULT 0,
      sent_at DATETIME,
      note TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS external_site (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
  `);
  const indexes = [
    "CREATE INDEX IF NOT EXISTS ix_family_household_village_id ON family_household(village_id)",
    "CREATE INDEX IF NOT EXISTS ix_family_household_head_farmer ON family_household(head_farmer_id)",
    "CREATE INDEX IF NOT EXISTS ix_farmer_profile_household_id ON farmer_profile(household_id)",
    "CREATE INDEX IF NOT EXISTS ix_farmer_profile_id_card ON farmer_profile(id_card)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_application_farmer_year ON subsidy_application(farmer_id, apply_year)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_application_subsidy_type ON subsidy_application(subsidy_type_id)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_payment_farmer_year ON subsidy_payment(farmer_id, payment_year)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_payment_subsidy_type ON subsidy_payment(subsidy_type_id)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_application ON subsidy_proxy(application_id)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_payment ON subsidy_proxy(payment_id)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_beneficiary ON subsidy_proxy(beneficiary_farmer_id)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_proxy ON subsidy_proxy(proxy_farmer_id)",
    "CREATE INDEX IF NOT EXISTS ix_hh_area_cache_household ON household_area_usage_cache(household_id)",
    "CREATE INDEX IF NOT EXISTS ix_hh_area_cache_year ON household_area_usage_cache(year)",
    "CREATE INDEX IF NOT EXISTS ix_household_event_hh_year ON household_event(household_id, event_year)",
    "CREATE INDEX IF NOT EXISTS ix_village_group_village ON village_group(village_id)",
    "CREATE INDEX IF NOT EXISTS ix_agri_task_alloc_task ON agri_task_allocation(task_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_village_id ON large_farmer(village_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_status ON large_farmer(status)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_id_card ON large_farmer(id_card)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_grade ON large_farmer(farmer_grade)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_lf_id ON large_farmer_parcel(large_farmer_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_village_id ON large_farmer_parcel(village_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_high_std ON large_farmer_parcel(is_high_standard)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_demo ON large_farmer_parcel(is_demonstration)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_trust_id ON large_farmer_parcel(trust_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_lf_id ON large_farmer_trust(large_farmer_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_owner_id ON large_farmer_trust(owner_household_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_year ON large_farmer_trust(trust_year)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_land_trust ON large_farmer_trust(land_trust_id)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_end_date ON large_farmer_trust(end_date)",
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_parcel_village ON large_farmer_trust(parcel_village_id)"
  ];
  for (const idx of indexes) {
    db2.exec(idx);
  }
}
function parseIdCard(idCard) {
  const result = { birthDate: null, gender: 0 };
  const card = idCard.trim();
  if (card.length === 18) {
    try {
      const year = parseInt(card.substring(6, 10));
      const month = parseInt(card.substring(10, 12));
      const day = parseInt(card.substring(12, 14));
      result.birthDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    } catch {
    }
    const genderDigit = parseInt(card[16]);
    result.gender = genderDigit % 2 === 1 ? 1 : 2;
  } else if (card.length === 15) {
    try {
      const year = 1900 + parseInt(card.substring(6, 8));
      const month = parseInt(card.substring(8, 10));
      const day = parseInt(card.substring(10, 12));
      result.birthDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    } catch {
    }
    const genderDigit = parseInt(card[14]);
    result.gender = genderDigit % 2 === 1 ? 1 : 2;
  }
  return result;
}
function maskIdCard(idCard) {
  if (!idCard || idCard.length < 15) return idCard;
  return idCard.substring(0, 6) + "********" + idCard.substring(idCard.length - 4);
}
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.substring(0, 3) + "****" + phone.substring(phone.length - 4);
}
function maskBankCard(card) {
  if (!card || card.length < 4) return card;
  return "****" + card.substring(card.length - 4);
}
function desensitizeFarmer(farmer) {
  const d = { ...farmer };
  if (d.id_card) d.id_card = maskIdCard(d.id_card);
  if (d.phone) d.phone = maskPhone(d.phone);
  if (d.bank_card) d.bank_card = maskBankCard(d.bank_card);
  return d;
}
function desensitizeText(text) {
  let result = text;
  result = result.replace(/\b\d{6}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, (match) => maskIdCard(match));
  result = result.replace(/\b1[3-9]\d{9}\b/g, (match) => maskPhone(match));
  return result;
}
function success(data, message = "ok") {
  return { code: 0, data, message };
}
function successList(items, total, page = 1, pageSize = 20) {
  return { code: 0, data: { items, total, page, page_size: pageSize } };
}
function errorResponse(message, code = 400) {
  return { code, message };
}
function parsePagination(params) {
  const page = Math.max(1, parseInt(String(params.page || "1")) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(params.page_size || String(params.pageSize || "20"))) || 20));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}
function registerFarmerHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("farmers:list", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const search = params.search || "";
      const villageName = params.village_name || "";
      const status = params.status ? Number(params.status) : null;
      const incomplete = params.incomplete || false;
      let where = "WHERE 1=1";
      const sqlParams = [];
      if (search) {
        where += ` AND (fp.real_name LIKE ? OR fp.id_card LIKE ? OR fp.phone LIKE ?)`;
        sqlParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (villageName) {
        where += ` AND v.village_name = ?`;
        sqlParams.push(villageName);
      }
      if (status != null) {
        where += ` AND fp.farmer_status = ?`;
        sqlParams.push(status);
      }
      if (incomplete) {
        where += ` AND (fp.phone IS NULL OR fp.bank_card IS NULL OR fp.bank_name IS NULL)`;
      }
      const countRow = db2().getRaw(
        `SELECT COUNT(*) as cnt FROM farmer_profile fp LEFT JOIN family_household hh ON fp.household_id = hh.id LEFT JOIN village v ON hh.village_id = v.id ${where}`,
        ...sqlParams
      );
      const rows = db2().allRaw(
        `SELECT fp.id, fp.household_id, fp.real_name, fp.gender, fp.id_card,
                fp.phone, fp.bank_card, fp.bank_name, fp.relation,
                fp.farmer_status, fp.own_village_id, fp.own_group_no,
                fp.remark, fp.created_at, fp.updated_at,
                hh.household_code, hh.household_name,
                COALESCE(v.village_name || CASE WHEN hh.group_no >= 1 AND hh.group_no <= 10 THEN
                  SUBSTR('零一二三四五六七八九十', hh.group_no+1, 1) || '组' ELSE hh.group_no || '组' END, '未知村组') AS village_full_name
         FROM farmer_profile fp
         LEFT JOIN family_household hh ON fp.household_id = hh.id
         LEFT JOIN village v ON hh.village_id = v.id
         ${where}
         ORDER BY fp.id DESC
         LIMIT ? OFFSET ?`,
        ...sqlParams,
        pageSize,
        offset
      );
      const items = rows.map((r) => ({
        ...r,
        id_card: maskIdCard(r.id_card),
        phone: r.phone ? maskPhone(r.phone) : null,
        bank_card: r.bank_card ? maskBankCard(r.bank_card) : null
      }));
      return successList(items, countRow?.cnt || 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:get", (_e, id) => {
    try {
      const row = db2().getRaw(
        `SELECT fp.*, hh.household_code, hh.household_name,
                COALESCE(v.village_name || '/' || hh.group_no, '未知村组') AS village_full_name
         FROM farmer_profile fp
         LEFT JOIN family_household hh ON fp.household_id = hh.id
         LEFT JOIN village v ON hh.village_id = v.id
         WHERE fp.id = ?`,
        id
      );
      if (!row) return errorResponse("农户不存在", 404);
      return success(row);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:create", (_e, data) => {
    try {
      const idCard = data.id_card;
      if (idCard) {
        const info = parseIdCard(idCard);
        if (info.gender && !data.gender) data.gender = info.gender;
      }
      const fields = ["household_id", "real_name", "gender", "id_card", "phone", "bank_card", "bank_name", "relation", "farmer_status", "own_village_id", "own_group_no", "remark"];
      const vals = fields.map((f) => data[f] ?? null);
      const placeholders = fields.map(() => "?").join(", ");
      const result = db2().runRaw(`INSERT INTO farmer_profile (${fields.join(", ")}) VALUES (${placeholders})`, ...vals);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:update", (_e, id, data) => {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== void 0 && k !== "id");
      if (!keys.length) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const vals = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...vals, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:deactivate", (_e, id, status = 2) => {
    try {
      db2().runRaw(`UPDATE farmer_profile SET farmer_status = ?, updated_at = datetime('now','localtime') WHERE id = ?`, status, id);
      return success(null, "操作成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:batchImport", (_e, rows, overwrite = false) => {
    try {
      let created = 0, updated = 0, skipped = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const idCard = row.id_card;
          if (!idCard) {
            skipped++;
            continue;
          }
          if (idCard) {
            const info = parseIdCard(idCard);
            if (info.gender && !row.gender) row.gender = info.gender;
          }
          const existing = db2().getRaw("SELECT id FROM farmer_profile WHERE id_card = ?", idCard);
          if (existing) {
            if (overwrite) {
              const keys = Object.keys(row).filter((k) => k !== "id_card" && k !== "id");
              const sets = keys.map((k) => `${k} = ?`).join(", ");
              const vals = keys.map((k) => row[k]);
              db2().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id_card = ?`, ...vals, idCard);
              updated++;
            } else {
              skipped++;
            }
          } else {
            const fields = ["household_id", "real_name", "gender", "id_card", "phone", "bank_card", "bank_name", "relation", "farmer_status"];
            const vals = fields.map((f) => row[f] ?? null);
            db2().runRaw(`INSERT INTO farmer_profile (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`, ...vals);
            created++;
          }
        } catch (e) {
          errors.push(`第${i + 1}行: ${String(e)}`);
        }
      }
      return success({ created, updated, skipped, errors });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:batchLookup", (_e, idCards) => {
    try {
      const results = {};
      for (const card of idCards) {
        const row = db2().getRaw("SELECT id FROM farmer_profile WHERE id_card = ?", card);
        if (row) results[card] = row.id;
      }
      return success({ results });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:batchGetIdCards", (_e, farmerIds) => {
    try {
      const results = {};
      for (const fid of farmerIds) {
        const row = db2().getRaw("SELECT id, id_card FROM farmer_profile WHERE id = ?", fid);
        if (row) results[String(fid)] = row.id_card;
      }
      return success({ results });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:bulkComplete", (_e, rows) => {
    try {
      let updated = 0;
      const errors = [];
      for (const row of rows) {
        try {
          const idCard = row.id_card;
          if (!idCard) continue;
          const existing = db2().getRaw("SELECT id FROM farmer_profile WHERE id_card = ?", idCard);
          if (!existing) continue;
          const updateFields = {};
          if (row.phone) updateFields.phone = row.phone;
          if (row.bank_card) updateFields.bank_card = row.bank_card;
          if (row.bank_name) updateFields.bank_name = row.bank_name;
          if (Object.keys(updateFields).length > 0) {
            const keys = Object.keys(updateFields);
            const sets = keys.map((k) => `${k} = ?`).join(", ");
            const vals = keys.map((k) => updateFields[k]);
            db2().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id_card = ?`, ...vals, idCard);
            updated++;
          }
        } catch (e) {
          errors.push(String(e));
        }
      }
      return success({ updated, errors });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:importRelations", (_e, rows, splitVillages) => {
    try {
      let updated = 0;
      const notFound = [];
      const relationErrors = [];
      for (const row of rows) {
        const idCard = row.id_card;
        if (!idCard) continue;
        const farmer = db2().getRaw("SELECT id FROM farmer_profile WHERE id_card = ?", idCard);
        if (!farmer) {
          notFound.push(idCard);
          continue;
        }
        if (row.relation) {
          db2().runRaw(`UPDATE farmer_profile SET relation = ?, updated_at = datetime('now','localtime') WHERE id = ?`, row.relation, farmer.id);
          updated++;
        }
      }
      return success({ stage1_updated: updated, stage1_not_found: notFound, stage1_relation_errors: relationErrors });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:multiHeadPreview", (_e, data) => {
    try {
      const villageNames = data?.villageNames || [];
      let query = `
        SELECT hh.id as household_id, hh.household_name,
               v.village_name,
               COUNT(fp.id) as head_count
        FROM farmer_profile fp
        JOIN family_household hh ON fp.household_id = hh.id
        JOIN village v ON hh.village_id = v.id
        WHERE fp.relation = '本人'
      `;
      const params = [];
      if (villageNames.length > 0) {
        query += ` AND v.village_name IN (${villageNames.map(() => "?").join(",")})`;
        params.push(...villageNames);
      }
      query += ` GROUP BY hh.id HAVING COUNT(fp.id) > 1`;
      const rows = db2().allRaw(query, ...params);
      return success({ households: rows });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
const DIGITS = "零一二三四五六七八九十";
function arabicToChinese(n) {
  if (n <= 10) return DIGITS[n];
  if (n < 20) {
    return "十" + (n % 10 ? DIGITS[n - 10] : "");
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return DIGITS[tens] + "十" + (ones ? DIGITS[ones] : "");
}
function formatGroupNo(n) {
  if (n == null) return "一组";
  if (n >= 1 && n <= 10) {
    return `${arabicToChinese(n)}组`;
  }
  return `${n}组`;
}
function registerHouseholdHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("households:list", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const search = params.search || "";
      const villageName = params.village_name || "";
      const status = params.status != null ? Number(params.status) : null;
      let where = "WHERE 1=1";
      const values = [];
      if (search) {
        where += ` AND (hh.household_name LIKE ? OR hh.household_code LIKE ?)`;
        values.push(`%${search}%`, `%${search}%`);
      }
      if (villageName) {
        where += ` AND v.village_name = ?`;
        values.push(villageName);
      }
      if (status != null) {
        where += ` AND hh.status = ?`;
        values.push(status);
      }
      const countRow = db2().getRaw(`
        SELECT COUNT(*) as cnt FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        ${where}
      `, ...values);
      const rows = db2().allRaw(`
        SELECT hh.*, v.village_name,
               (SELECT COUNT(*) FROM farmer_profile WHERE household_id = hh.id) as member_count,
               (SELECT real_name FROM farmer_profile WHERE id = hh.head_farmer_id) as head_name
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        ${where}
        ORDER BY hh.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset);
      const items = rows.map((r) => ({
        ...r,
        group_display: formatGroupNo(r.group_no)
      }));
      return successList(items, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:get", (_e, id, year) => {
    try {
      const hh = db2().getRaw(`
        SELECT hh.*, v.village_name,
               (SELECT real_name FROM farmer_profile WHERE id = hh.head_farmer_id) as head_name
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE hh.id = ?
      `, id);
      if (!hh) return errorResponse("家庭户不存在", 404);
      const members = db2().allRaw(`
        SELECT fp.*
        FROM farmer_profile fp
        WHERE fp.household_id = ?
        ORDER BY CASE WHEN fp.relation = '本人' THEN 0 ELSE 1 END, fp.id
      `, id);
      const maskedMembers = members.map((m) => ({
        ...m,
        id_card: maskIdCard(m.id_card),
        phone: m.phone ? maskPhone(m.phone) : null,
        bank_card: m.bank_card ? maskBankCard(m.bank_card) : null
      }));
      return success({ ...hh, group_display: formatGroupNo(hh.group_no), members: maskedMembers });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:create", (_e, data) => {
    try {
      const result = db2().runRaw(`
        INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, confirmed_area, status, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, data.household_code, data.household_name, data.village_id, data.group_no, data.address, data.contract_area, data.confirmed_area, data.status, data.remark);
      const code = `HH${String(result.lastInsertRowid).padStart(4, "0")}`;
      db2().runRaw("UPDATE family_household SET household_code = ? WHERE id = ?", code, result.lastInsertRowid);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:update", (_e, id, data) => {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE family_household SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:delete", (_e, id) => {
    try {
      const memberCount = db2().getRaw("SELECT COUNT(*) as cnt FROM farmer_profile WHERE household_id = ?", id)?.cnt ?? 0;
      if (memberCount > 0) {
        return errorResponse(`该家庭户下有${memberCount}名成员，请先移出所有成员`);
      }
      db2().runRaw("DELETE FROM family_household WHERE id = ?", id);
      return success({ message: "删除成功", household_id: id });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:addMember", (_e, householdId, data) => {
    try {
      const result = db2().runRaw(`
        INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, householdId, data.real_name, data.gender, data.id_card, data.phone, data.bank_card, data.bank_name, data.relation);
      return success({ id: result.lastInsertRowid, household_id: householdId });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:updateMember", (_e, householdId, farmerId, data) => {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE farmer_profile SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?`, ...values, farmerId, householdId);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:removeMember", (_e, householdId, farmerId) => {
    try {
      db2().runRaw("UPDATE farmer_profile SET household_id = NULL, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?", farmerId, householdId);
      return success(null, "移出成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:merge", (_e, sourceId, targetId, operator) => {
    try {
      db2().runRaw("UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE household_id = ?", targetId, sourceId);
      db2().runRaw("DELETE FROM family_household WHERE id = ?", sourceId);
      return success({ message: "合并成功" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:groupOptions", () => {
    try {
      const rows = db2().allRaw(`
        SELECT DISTINCT v.village_name, vg.group_no
        FROM village_group vg
        JOIN village v ON vg.village_id = v.id
        ORDER BY v.village_name, vg.group_no
      `);
      return success(rows.map((r) => ({
        ...r,
        group_display: formatGroupNo(r.group_no)
      })));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:refreshAreaCache", (_e, householdId) => {
    try {
      return success({ message: "面积缓存刷新功能待实现" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerSubsidyHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("subsidies:listTypes", (_e, year) => {
    try {
      let query = "SELECT * FROM subsidy_type";
      const params = [];
      if (year) {
        query += " WHERE subsidy_year = ?";
        params.push(year);
      }
      query += " ORDER BY subsidy_year DESC";
      return success(db2().allRaw(query, ...params));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:listTypesWithStats", (_e, year) => {
    try {
      const params = [];
      let yearCondition = "";
      if (year) {
        yearCondition = " AND sa.apply_year = ?";
        params.push(year);
      }
      const rows = db2().allRaw(`
        SELECT st.*,
               COUNT(sa.id) as app_count,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COALESCE(SUM(sa.apply_amount), 0) as total_apply,
               COALESCE(SUM(sa.actual_amount), 0) as total_actual
        FROM subsidy_type st
        LEFT JOIN subsidy_application sa ON st.id = sa.subsidy_type_id${yearCondition}
        GROUP BY st.id
        ORDER BY st.subsidy_year DESC
      `, ...params);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:createType", (_e, data) => {
    try {
      const cols = Object.keys(data).join(", ");
      const placeholders = Object.keys(data).map(() => "?").join(", ");
      const values = Object.keys(data).map((k) => data[k]);
      const result = db2().runRaw(`INSERT INTO subsidy_type (${cols}) VALUES (${placeholders})`, ...values);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:updateType", (_e, id, data) => {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE subsidy_type SET ${sets} WHERE id = ?`, ...values, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:listApplications", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const year = params.year ? Number(params.year) : null;
      const subsidyTypeId = params.subsidy_type_id ? Number(params.subsidy_type_id) : null;
      const villageName = params.village_name || "";
      const search = params.search || "";
      let where = "WHERE 1=1";
      const values = [];
      if (year) {
        where += " AND sa.apply_year = ?";
        values.push(year);
      }
      if (subsidyTypeId) {
        where += " AND sa.subsidy_type_id = ?";
        values.push(subsidyTypeId);
      }
      if (villageName) {
        where += " AND v.village_name = ?";
        values.push(villageName);
      }
      if (search) {
        where += " AND (fp.real_name LIKE ? OR fp.id_card LIKE ?)";
        values.push(`%${search}%`, `%${search}%`);
      }
      const countRow = db2().getRaw(`
        SELECT COUNT(*) as cnt FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        ${where}
      `, ...values);
      const rows = db2().allRaw(`
        SELECT sa.*, fp.real_name as farmer_name, fp.id_card as farmer_id_card,
               st.subsidy_name, st.season, st.calc_mode,
               v.village_name, hh.group_no
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        ${where}
        ORDER BY sa.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset);
      const items = rows.map((r) => ({
        ...r,
        farmer_id_card: maskIdCard(r.farmer_id_card)
      }));
      return successList(items, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:createApplication", (_e, data) => {
    try {
      const cols = Object.keys(data).join(", ");
      const placeholders = Object.keys(data).map(() => "?").join(", ");
      const values = Object.keys(data).map((k) => data[k]);
      const result = db2().runRaw(`INSERT INTO subsidy_application (${cols}) VALUES (${placeholders})`, ...values);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:updateApplication", (_e, id, data) => {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE subsidy_application SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:listProxies", (_e, params = {}) => {
    try {
      const rows = db2().allRaw(`
        SELECT sp.*,
               bf.real_name as beneficiary_name, pf.real_name as proxy_name
        FROM subsidy_proxy sp
        LEFT JOIN farmer_profile bf ON sp.beneficiary_farmer_id = bf.id
        LEFT JOIN farmer_profile pf ON sp.proxy_farmer_id = pf.id
        ORDER BY sp.id DESC
      `);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:createProxy", (_e, data) => {
    try {
      const result = db2().runRaw(`
        INSERT INTO subsidy_proxy (subsidy_type_id, beneficiary_farmer_id, proxy_farmer_id, proxy_type, remark)
        VALUES (?, ?, ?, ?, ?)
      `, data.subsidy_type_id, data.beneficiary_farmer_id, data.proxy_farmer_id, data.proxy_type, data.remark);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:deleteProxy", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM subsidy_proxy WHERE id = ?", id);
      return success(null, "删除成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:yearCompare", (_e, year) => {
    try {
      const current = db2().getRaw(`
        SELECT COALESCE(SUM(actual_amount), 0) as total_amount,
               COUNT(DISTINCT beneficiary_id) as farmer_count,
               COUNT(*) as application_count
        FROM subsidy_application WHERE apply_year = ? AND pay_status >= 1
      `, year);
      const prev = db2().getRaw(`
        SELECT COALESCE(SUM(actual_amount), 0) as total_amount,
               COUNT(DISTINCT beneficiary_id) as farmer_count,
               COUNT(*) as application_count
        FROM subsidy_application WHERE apply_year = ? AND pay_status >= 1
      `, year - 1);
      return success({ current_year: current, previous_year: prev });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:summaryByVillage", (_e, year) => {
    try {
      const rows = db2().allRaw(`
        SELECT v.village_name,
               COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
               COUNT(*) as application_count,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount,
               COALESCE(SUM(sa.apply_area), 0) as total_area
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE sa.apply_year = ?
        GROUP BY v.id
        ORDER BY total_amount DESC
      `, year);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:summaryBySeason", (_e, year) => {
    try {
      const rows = db2().allRaw(`
        SELECT st.season,
               COUNT(DISTINCT st.id) as project_count,
               COUNT(DISTINCT sa.beneficiary_id) as farmer_count,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount,
               COALESCE(SUM(sa.apply_area), 0) as total_area,
               COUNT(*) as application_count
        FROM subsidy_application sa
        JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        WHERE sa.apply_year = ?
        GROUP BY st.season
      `, year);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerAiHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("ai:analyze", async (_e, data) => {
    try {
      const { year, village_name, question } = data;
      let appsQuery = `
        SELECT sa.*, fp.real_name, fp.id_card, fp.phone, fp.bank_card,
               st.subsidy_name, st.season,
               v.village_name, hh.group_no
        FROM subsidy_application sa
        JOIN farmer_profile fp ON sa.farmer_id = fp.id
        JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE sa.apply_year = ?
      `;
      const params = [year];
      if (village_name) {
        appsQuery += ` AND v.village_name = ?`;
        params.push(village_name);
      }
      const apps = db2().allRaw(appsQuery, ...params);
      const desensitizedApps = apps.map((a) => desensitizeFarmer({
        farmer_name: a.real_name,
        farmer_id_masked: a.id_card,
        village: `${a.village_name || ""}${a.group_no || ""}`,
        subsidy_name: a.subsidy_name,
        apply_amount: Number(a.apply_amount || 0),
        actual_amount: Number(a.actual_amount || 0),
        pay_status: a.pay_status,
        season: a.season
      }));
      const stats = {
        year,
        village_filter: village_name || "全部",
        record_count: apps.length,
        total_amount: apps.reduce((s, a) => s + Number(a.actual_amount || 0), 0),
        farmer_count: new Set(apps.map((a) => a.farmer_id)).size
      };
      let aiResult = "AI 分析功能需要配置 ANTHROPIC_API_KEY 环境变量。\n\n请在系统环境变量中设置 ANTHROPIC_API_KEY 后重启应用。\n\n以下为数据摘要：\n";
      aiResult += `
年度：${year}
筛选：${stats.village_filter}
`;
      aiResult += `记录数：${stats.record_count}
涉及农户：${stats.farmer_count}人
`;
      aiResult += `总金额：${stats.total_amount.toFixed(2)}元
`;
      try {
        const Anthropic = require("@anthropic-ai/sdk").default;
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          const client = new Anthropic({ apiKey });
          const safeQuestion = desensitizeText(question);
          const prompt = `你是一位农村补贴管理专家助手。以下是${year}年度的补贴发放脱敏数据（所有身份证、手机号均已脱敏处理）：

\`\`\`json
${JSON.stringify({ statistics: stats, records: desensitizedApps.slice(0, 50) }, null, 2)}
\`\`\`

请根据以上数据回答：${safeQuestion}

要求：
1. 用简洁的中文回答，分点列出
2. 重点关注：金额异常、新增/退出农户原因推断、与上年对比变化
3. 如有疑似异常数据请明确指出
4. 最后给出1-2条管理建议`;
          const message = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1500,
            messages: [{ role: "user", content: prompt }]
          });
          aiResult = message.content[0].text;
        }
      } catch {
      }
      return success({
        result: aiResult,
        data_preview: { year: stats.year, statistics: stats, record_count: stats.record_count }
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerLandHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("land:list", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const countRow = db2().getRaw("SELECT COUNT(*) as cnt FROM land_trust");
      const rows = db2().allRaw("SELECT * FROM land_trust ORDER BY id DESC LIMIT ? OFFSET ?", pageSize, offset);
      return successList(rows, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:create", (_e, data) => {
    try {
      const cols = Object.keys(data).join(", ");
      const placeholders = Object.keys(data).map(() => "?").join(", ");
      const values = Object.keys(data).map((k) => data[k]);
      const result = db2().runRaw(`INSERT INTO land_trust (${cols}) VALUES (${placeholders})`, ...values);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:update", (_e, id, data) => {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE land_trust SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:listLargeFarmers", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const countRow = db2().getRaw("SELECT COUNT(*) as cnt FROM large_farmer");
      const rows = db2().allRaw("SELECT * FROM large_farmer ORDER BY id DESC LIMIT ? OFFSET ?", pageSize, offset);
      return successList(rows, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerSettingsHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("settings:listVillageGroups", () => {
    try {
      const rows = db2().allRaw(`
        SELECT vg.*, v.village_name FROM village_group vg
        JOIN village v ON vg.village_id = v.id
        ORDER BY v.village_name, vg.group_no
      `);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:createVillageGroup", (_e, data) => {
    try {
      let village = db2().getRaw("SELECT id FROM village WHERE village_name = ?", data.village_name);
      if (!village) {
        const r = db2().runRaw("INSERT INTO village (village_name) VALUES (?)", data.village_name);
        village = { id: Number(r.lastInsertRowid) };
      }
      const result = db2().runRaw("INSERT INTO village_group (village_id, group_no) VALUES (?, ?)", village.id, data.group_no);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:backup", (_e, destPath) => {
    try {
      const srcPath = getDbPath();
      fs.copyFileSync(srcPath, destPath);
      return success({ message: "备份成功", path: destPath });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:getDbInfo", () => {
    try {
      const path2 = getDbPath();
      const tables = db2().allRaw("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
      const counts = {};
      for (const t of tables) {
        try {
          const r = db2().getRaw(`SELECT COUNT(*) as cnt FROM "${t.name}"`);
          counts[t.name] = r?.cnt ?? 0;
        } catch {
        }
      }
      return success({ path: path2, tables: tables.map((t) => t.name), counts });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerPrecheckHandlers() {
  electron.ipcMain.handle("precheck:run", (_e, data) => {
    try {
      return success({ message: "预检功能开发中", results: [] });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerExcelTemplateHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("excel-templates:list", (_e, businessType) => {
    try {
      let query = "SELECT * FROM excel_column_template WHERE is_active = 1";
      const params = [];
      if (businessType) {
        query += " AND business_type = ?";
        params.push(businessType);
      }
      query += " ORDER BY id DESC";
      return success(db2().allRaw(query, ...params));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("excel-templates:get", (_e, id) => {
    try {
      const row = db2().getRaw("SELECT * FROM excel_column_template WHERE id = ?", id);
      return success(row);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("excel-templates:save", (_e, data) => {
    try {
      const cols = Object.keys(data).join(", ");
      const placeholders = Object.keys(data).map(() => "?").join(", ");
      const values = Object.keys(data).map((k) => data[k]);
      const result = db2().runRaw(`INSERT INTO excel_column_template (${cols}) VALUES (${placeholders})`, ...values);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerErrorLibraryHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("error-library:list", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const countRow = db2().getRaw("SELECT COUNT(*) as cnt FROM error_library");
      const rows = db2().allRaw("SELECT * FROM error_library ORDER BY id DESC LIMIT ? OFFSET ?", pageSize, offset);
      return successList(rows, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("error-library:create", (_e, data) => {
    try {
      const cols = Object.keys(data).join(", ");
      const placeholders = Object.keys(data).map(() => "?").join(", ");
      const values = Object.keys(data).map((k) => data[k]);
      const result = db2().runRaw(`INSERT INTO error_library (${cols}) VALUES (${placeholders})`, ...values);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("error-library:update", (_e, id, data) => {
    try {
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const values = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE error_library SET ${sets} WHERE id = ?`, ...values, id);
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("error-library:delete", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM error_library WHERE id = ?", id);
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("error-library:batchDelete", (_e, ids) => {
    try {
      for (const id of ids) {
        db2().runRaw("DELETE FROM error_library WHERE id = ?", id);
      }
      return success({ deleted: ids.length });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerHouseholdImportHandlers() {
  electron.ipcMain.handle("household-import:preview", (_e, rows) => {
    try {
      return success({ message: "家庭户批量导入预览功能开发中", groups: [], row_errors: [], summary: { total_rows: 0, total_groups: 0, new_households: 0, merge_single: 0, merge_multi: 0, error_rows: 0 } });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("household-import:execute", (_e, rows) => {
    try {
      return success({ message: "家庭户批量导入执行功能开发中", created_households: 0, merged_households: 0, created_farmers: 0, skipped_farmers: 0, errors: [] });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerAgriTaskHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("agri-tasks:list", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const countRow = db2().getRaw("SELECT COUNT(*) as cnt FROM agri_task");
      const rows = db2().allRaw("SELECT * FROM agri_task ORDER BY id DESC LIMIT ? OFFSET ?", pageSize, offset);
      return successList(rows, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("agri-tasks:getAllocations", (_e, taskId) => {
    try {
      const rows = db2().allRaw("SELECT * FROM agri_task_allocation WHERE task_id = ?", taskId);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerExternalLinksHandlers() {
  const db2 = () => getDb();
  db2().exec(`
    CREATE TABLE IF NOT EXISTS external_site (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )
  `);
  electron.ipcMain.handle("external-links:list", () => {
    try {
      const rows = db2().allRaw("SELECT * FROM external_site WHERE is_active = 1 ORDER BY sort_order");
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerEligibilityHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("eligibility:list", (_e, subsidyTypeId) => {
    try {
      let query = "SELECT * FROM subsidy_eligibility_rule WHERE is_active = 1";
      const params = [];
      if (subsidyTypeId) {
        query += " AND subsidy_type_id = ?";
        params.push(subsidyTypeId);
      }
      const rows = db2().allRaw(query, ...params);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("eligibility:create", (_e, data) => {
    try {
      const cols = Object.keys(data).join(", ");
      const placeholders = Object.keys(data).map(() => "?").join(", ");
      const values = Object.keys(data).map((k) => data[k]);
      const result = db2().runRaw(`INSERT INTO subsidy_eligibility_rule (${cols}) VALUES (${placeholders})`, ...values);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerAllIpcHandlers() {
  electron.ipcMain.handle("dialog:selectFile", async (_e, options) => {
    const result = await electron.dialog.showOpenDialog({
      title: options?.title || "选择文件",
      filters: options?.filters || [{ name: "Excel文件", extensions: ["xlsx", "xls"] }],
      properties: ["openFile"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  electron.ipcMain.handle("dialog:saveFile", async (_e, options) => {
    const result = await electron.dialog.showSaveDialog({
      title: options?.title || "保存文件",
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: "Excel文件", extensions: ["xlsx"] }]
    });
    return result.canceled ? null : result.filePath || null;
  });
  electron.ipcMain.handle("app:getUserDataPath", () => electron.app.getPath("userData"));
  electron.ipcMain.handle("app:getDbPath", () => getDbPath());
  electron.ipcMain.handle("fs:copyFile", (_e, { src, dest }) => {
    fs.copyFileSync(src, dest);
  });
  registerFarmerHandlers();
  registerHouseholdHandlers();
  registerSubsidyHandlers();
  registerAiHandlers();
  registerLandHandlers();
  registerSettingsHandlers();
  registerPrecheckHandlers();
  registerExcelTemplateHandlers();
  registerErrorLibraryHandlers();
  registerHouseholdImportHandlers();
  registerAgriTaskHandlers();
  registerExternalLinksHandlers();
  registerEligibilityHandlers();
}
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "农户补贴管理系统",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(async () => {
  await initDatabase();
  runMigrations();
  registerAllIpcHandlers();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
