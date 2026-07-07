"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const electronUpdater = require("electron-updater");
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
  let resolvedPath = dbPath;
  if (!resolvedPath) {
    const portablePath = path.join(electron.app.getAppPath(), "..", "subsidy.db");
    if (fs.existsSync(portablePath)) {
      resolvedPath = portablePath;
    } else {
      resolvedPath = path.join(electron.app.getPath("userData"), "subsidy.db");
    }
  }
  const dir = require("path").dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  console.log(`[DB] 数据库路径: ${resolvedPath}`);
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  let sqliteDb;
  if (fs.existsSync(resolvedPath)) {
    const fileBuffer = fs.readFileSync(resolvedPath);
    sqliteDb = new SQL.Database(fileBuffer);
    console.log(`[DB] 加载已有数据库 (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    sqliteDb = new SQL.Database();
    console.log("[DB] 创建新数据库");
  }
  sqliteDb.run("PRAGMA foreign_keys = ON");
  db = new SqlJsWrapper(sqliteDb, resolvedPath);
}
function getDb() {
  if (!db) throw new Error("数据库未初始化，请先调用 initDatabase()");
  return db;
}
function getDbPath() {
  const portablePath = path.join(electron.app.getAppPath(), "..", "subsidy.db");
  if (fs.existsSync(portablePath)) return portablePath;
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

    CREATE TABLE IF NOT EXISTS query_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER,
      site_name VARCHAR(100) NOT NULL,
      query_type VARCHAR(50) NOT NULL,
      query_input TEXT NOT NULL,
      query_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
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
    "CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_parcel_village ON large_farmer_trust(parcel_village_id)",
    // 家庭户查询性能优化
    "CREATE INDEX IF NOT EXISTS ix_subsidy_application_beneficiary ON subsidy_application(beneficiary_id)",
    "CREATE INDEX IF NOT EXISTS ix_subsidy_application_beneficiary_year ON subsidy_application(beneficiary_id, apply_year)",
    "CREATE INDEX IF NOT EXISTS ix_family_household_confirmed ON family_household(is_manually_confirmed)",
    "CREATE INDEX IF NOT EXISTS ix_land_trust_owner_hh ON land_trust(owner_household_id)",
    "CREATE INDEX IF NOT EXISTS ix_land_trust_operator_hh ON land_trust(operator_household_id)"
  ];
  for (const idx of indexes) {
    db2.exec(idx);
  }
  const alterStatements = [
    // family_household 增量
    "ALTER TABLE family_household ADD COLUMN confirmed_area DECIMAL(10,2)",
    "ALTER TABLE family_household ADD COLUMN is_manually_confirmed SMALLINT DEFAULT 0",
    "ALTER TABLE family_household ADD COLUMN manually_confirmed_at DATETIME",
    "ALTER TABLE family_household ADD COLUMN manually_confirmed_by VARCHAR(50)",
    "ALTER TABLE family_household ADD COLUMN registered_address TEXT",
    // farmer_profile 增量
    "ALTER TABLE farmer_profile ADD COLUMN own_village_id INTEGER REFERENCES village(id)",
    "ALTER TABLE farmer_profile ADD COLUMN own_group_no INTEGER",
    // subsidy_application 增量
    "ALTER TABLE subsidy_application ADD COLUMN apply_village_id INTEGER REFERENCES village(id)",
    "ALTER TABLE subsidy_application ADD COLUMN apply_group_no INTEGER",
    "ALTER TABLE subsidy_application ADD COLUMN apply_village_name VARCHAR(50)",
    "ALTER TABLE subsidy_application ADD COLUMN apply_group_display VARCHAR(20)",
    "ALTER TABLE subsidy_application ADD COLUMN is_proxy SMALLINT DEFAULT 0",
    "ALTER TABLE subsidy_application ADD COLUMN beneficiary_id INTEGER REFERENCES farmer_profile(id)",
    // subsidy_payment 增量
    "ALTER TABLE subsidy_payment ADD COLUMN payment_village_id INTEGER REFERENCES village(id)",
    "ALTER TABLE subsidy_payment ADD COLUMN payment_group_no INTEGER",
    "ALTER TABLE subsidy_payment ADD COLUMN payment_village_name VARCHAR(50)",
    "ALTER TABLE subsidy_payment ADD COLUMN payment_group_display VARCHAR(20)",
    "ALTER TABLE subsidy_payment ADD COLUMN is_proxy SMALLINT DEFAULT 0",
    "ALTER TABLE subsidy_payment ADD COLUMN proxy_remark TEXT",
    "ALTER TABLE subsidy_payment ADD COLUMN pay_status SMALLINT DEFAULT 2",
    "ALTER TABLE subsidy_payment ADD COLUMN beneficiary_id INTEGER REFERENCES farmer_profile(id)",
    // subsidy_proxy 增量
    "ALTER TABLE subsidy_proxy ADD COLUMN subsidy_type_id INTEGER REFERENCES subsidy_type(id)",
    // large_farmer 增量
    "ALTER TABLE large_farmer ADD COLUMN farmer_grade VARCHAR(20)",
    "ALTER TABLE large_farmer ADD COLUMN credit_score SMALLINT",
    // large_farmer_trust 增量
    "ALTER TABLE large_farmer_trust ADD COLUMN parcel_village_id INTEGER REFERENCES village(id)",
    "ALTER TABLE large_farmer_trust ADD COLUMN parcel_group_no SMALLINT",
    "ALTER TABLE large_farmer_trust ADD COLUMN is_high_standard SMALLINT DEFAULT 0",
    "ALTER TABLE large_farmer_trust ADD COLUMN is_demonstration SMALLINT DEFAULT 0",
    "ALTER TABLE large_farmer_trust ADD COLUMN zone_name VARCHAR(100)",
    "ALTER TABLE large_farmer_trust ADD COLUMN reminder_sent SMALLINT DEFAULT 0"
  ];
  for (const stmt of alterStatements) {
    try {
      db2.exec(stmt);
    } catch {
    }
  }
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
function parseGroupNoToInt(value) {
  if (value == null) return 1;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return parseInt(s);
  const m = s.match(/^(\d+)/);
  if (m) return parseInt(m[1]);
  const CN_MAP = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10
  };
  for (const [cn, num] of Object.entries(CN_MAP)) {
    if (s.includes(cn)) return num;
  }
  return /^\d+$/.test(s) ? parseInt(s) : 1;
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
function validateIdCard(idCard) {
  if (!idCard) return [false, "身份证号为空"];
  const card = idCard.trim().toUpperCase();
  if (card.length !== 18) return [false, `长度不是18位（当前${card.length}位）`];
  if (!/^\d{17}[\dX]$/.test(card)) return [false, "格式不正确（前17位应为数字，最后一位为数字或X）"];
  const year = parseInt(card.substring(6, 10));
  const month = parseInt(card.substring(10, 12));
  const day = parseInt(card.substring(12, 14));
  if (year < 1900 || year > 2099) return [false, `出生年份 ${year} 不合理`];
  if (month < 1 || month > 12) return [false, `出生月份 ${month} 不合理`];
  if (day < 1 || day > 31) return [false, `出生日期 ${day} 不合理`];
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkMap = "10X98765432";
  let total = 0;
  for (let i = 0; i < 17; i++) {
    total += parseInt(card[i]) * weights[i];
  }
  const expectedCheck = checkMap[total % 11];
  if (card[17] !== expectedCheck) {
    return [false, `校验码错误（应为${expectedCheck}，实际为${card[17]}）`];
  }
  return [true, ""];
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
        `SELECT fp.*, hh.household_code, hh.household_name, hh.group_no,
                v.village_name
         FROM farmer_profile fp
         LEFT JOIN family_household hh ON fp.household_id = hh.id
         LEFT JOIN village v ON hh.village_id = v.id
         WHERE fp.id = ?`,
        id
      );
      if (!row) return errorResponse("农户不存在", 404);
      const groupNo = row.group_no != null ? Number(row.group_no) : 0;
      const villageFullName = row.village_name ? `${row.village_name}${formatGroupNo(groupNo)}` : formatGroupNo(groupNo) || "未知村组";
      let applications = [];
      try {
        const apps = db2().allRaw(`
          SELECT sa.id, sa.apply_year, sa.subsidy_type_id,
                 st.subsidy_name,
                 sa.apply_area, COALESCE(sa.apply_amount, 0) as apply_amount,
                 COALESCE(sa.actual_amount, 0) as actual_amount,
                 sa.pay_status, sa.is_proxy, sa.apply_village_name, sa.apply_group_display,
                 sa.created_at
          FROM subsidy_application sa
          JOIN subsidy_type st ON st.id = sa.subsidy_type_id
          WHERE COALESCE(sa.beneficiary_id, sa.farmer_id) = ?
          ORDER BY sa.apply_year DESC, sa.id DESC
        `, id);
        if (apps.length > 0) {
          const appIds = apps.map((a) => a.id);
          const placeholders = appIds.map(() => "?").join(",");
          try {
            const proxies = db2().allRaw(`
              SELECT sp.application_id, sp.proxy_type as type,
                     sp.beneficiary_farmer_id, sp.proxy_farmer_id,
                     bf.real_name as beneficiary_name,
                     pf.real_name as proxy_name,
                     sp.remark
              FROM subsidy_proxy sp
              LEFT JOIN farmer_profile bf ON bf.id = sp.beneficiary_farmer_id
              LEFT JOIN farmer_profile pf ON pf.id = sp.proxy_farmer_id
              WHERE sp.application_id IN (${placeholders})
            `, ...appIds);
            const proxyMap = /* @__PURE__ */ new Map();
            for (const p of proxies) {
              proxyMap.set(p.application_id, {
                type: p.type,
                beneficiary_farmer_id: p.beneficiary_farmer_id,
                proxy_farmer_id: p.proxy_farmer_id,
                beneficiary_name: p.beneficiary_name,
                proxy_name: p.proxy_name,
                remark: p.remark
              });
            }
            applications = apps.map((a) => ({
              ...a,
              proxy_info: proxyMap.get(a.id) || null
            }));
          } catch {
            applications = apps;
          }
        } else {
          applications = apps;
        }
      } catch {
      }
      return success({
        ...row,
        village_full_name: villageFullName,
        group_display: formatGroupNo(groupNo),
        applications,
        is_head: row.household_id && row.id ? null : 0
      });
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
  electron.ipcMain.handle("farmers:update", (_e, payload) => {
    try {
      const { id, ...data } = payload;
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
  electron.ipcMain.handle("farmers:deactivate", (_e, payload) => {
    try {
      const { id, status = 2 } = payload;
      db2().runRaw(`UPDATE farmer_profile SET farmer_status = ?, updated_at = datetime('now','localtime') WHERE id = ?`, status, id);
      return success(null, "操作成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("farmers:batchImport", (_e, payload) => {
    try {
      const { rows, overwrite = false } = payload;
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
  electron.ipcMain.handle("farmers:importRelations", (_e, payload) => {
    try {
      const { rows, split_villages: splitVillages } = payload;
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
  electron.ipcMain.handle("farmers:multiHeadPreview", (_e, payload) => {
    try {
      const villageNames = Array.isArray(payload) ? payload : payload?.villageNames || [];
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
  electron.ipcMain.handle("farmers:search", (_e, params = {}) => {
    try {
      const search = params.search || "";
      const pageSize = Number(params.page_size) || 20;
      const rows = db2().allRaw(`
        SELECT fp.id, fp.real_name, fp.id_card, fp.phone, fp.household_id,
               hh.household_name, hh.household_code,
               COALESCE(v.village_name,'') as village_name
        FROM farmer_profile fp
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        LEFT JOIN village v ON hh.village_id=v.id
        WHERE fp.real_name LIKE ? OR fp.id_card LIKE ? OR fp.phone LIKE ?
        ORDER BY fp.id DESC LIMIT ?
      `, `%${search}%`, `%${search}%`, `%${search}%`, pageSize);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerHouseholdHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("households:list", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const search = (params.search || "").trim();
      const villageName = params.village_name || "";
      const status = params.status != null ? Number(params.status) : null;
      const hasSubsidy = params.has_subsidy != null ? Number(params.has_subsidy) : 0;
      const overdrawnOnly = params.overdrawn_only != null ? Number(params.overdrawn_only) : 0;
      const confirmedOnly = params.confirmed_only || "";
      let where = "WHERE 1=1";
      const values = [];
      if (search) {
        where += ` AND (hh.household_name LIKE ? OR hh.household_code LIKE ? OR head.real_name LIKE ? OR EXISTS (SELECT 1 FROM farmer_profile fp WHERE fp.household_id = hh.id AND (fp.real_name LIKE ? OR fp.id_card LIKE ?)))`;
        values.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (villageName) {
        where += ` AND v.village_name = ?`;
        values.push(villageName);
      }
      if (status != null) {
        where += ` AND hh.status = ?`;
        values.push(status);
      }
      if (hasSubsidy === 1) {
        where += ` AND EXISTS (SELECT 1 FROM farmer_profile fp2 JOIN subsidy_application sa2 ON COALESCE(sa2.beneficiary_id,sa2.farmer_id) = fp2.id WHERE fp2.household_id = hh.id)`;
      }
      if (overdrawnOnly === 1) {
        where += ` AND (SELECT COALESCE(SUM(sa.apply_area),0) FROM subsidy_application sa JOIN farmer_profile fp2 ON COALESCE(sa.beneficiary_id,sa.farmer_id) = fp2.id WHERE fp2.household_id = hh.id) > COALESCE(hh.contract_area, 0) AND hh.contract_area > 0`;
      }
      if (confirmedOnly === "1") {
        where += ` AND hh.is_manually_confirmed = 1`;
      } else if (confirmedOnly === "0") {
        where += ` AND (hh.is_manually_confirmed IS NULL OR hh.is_manually_confirmed = 0)`;
      }
      const countRow = db2().getRaw(`
        SELECT COUNT(*) as cnt FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN farmer_profile head ON head.id = hh.head_farmer_id
        ${where}
      `, ...values);
      const rows = db2().allRaw(`
        SELECT hh.*, v.village_name,
               COALESCE(mc.cnt, 0) as member_count,
               head.real_name as head_name,
               COALESCE(area.total, 0) as total_subsidy_area
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN (SELECT household_id, COUNT(*) as cnt FROM farmer_profile GROUP BY household_id) mc
          ON mc.household_id = hh.id
        LEFT JOIN farmer_profile head ON head.id = hh.head_farmer_id
        LEFT JOIN (
          SELECT fp2.household_id, COALESCE(SUM(sa.apply_area), 0) as total
          FROM subsidy_application sa
          JOIN farmer_profile fp2 ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp2.id
          GROUP BY fp2.household_id
        ) area ON area.household_id = hh.id
        ${where}
        ORDER BY hh.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset);
      const items = rows.map((r) => {
        const contractArea = Number(r.contract_area || 0);
        const subsidyArea = Number(r.total_subsidy_area || 0);
        const isOverdrawn = contractArea > 0 && subsidyArea > contractArea;
        return {
          ...r,
          group_display: formatGroupNo(r.group_no),
          village_full_name: r.village_name ? `${r.village_name}${formatGroupNo(r.group_no)}` : "未知村组",
          is_overdrawn: isOverdrawn,
          used_area: subsidyArea
        };
      });
      return successList(items, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:get", (_e, payload) => {
    try {
      const { id, year } = payload;
      const hh = db2().getRaw(`
        SELECT hh.*, v.village_name,
               (SELECT real_name FROM farmer_profile WHERE id = hh.head_farmer_id) as head_name
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE hh.id = ?
      `, id);
      if (!hh) return errorResponse("家庭户不存在", 404);
      const groupDisplay = formatGroupNo(hh.group_no);
      const villageFullName = hh.village_name ? `${hh.village_name}${groupDisplay}` : groupDisplay || "未知村组";
      const members = db2().allRaw(`
        SELECT fp.*
        FROM farmer_profile fp
        WHERE fp.household_id = ?
        ORDER BY CASE WHEN fp.relation = '本人' THEN 0 ELSE 1 END, fp.id
      `, id);
      const members_list = members.map((m) => ({
        ...m,
        is_head: hh.head_farmer_id === m.id ? 1 : 0,
        restricted_identity: 0
      }));
      let appSummary = [];
      try {
        const apps = db2().allRaw(`
          SELECT sa.id, sa.apply_year,
                 COALESCE(sa.beneficiary_id, sa.farmer_id) as farmer_id,
                 fp.real_name as farmer_name,
                 st.subsidy_name, st.calc_mode,
                 sa.apply_area, COALESCE(sa.apply_amount, 0) as apply_amount,
                 COALESCE(sa.actual_amount, 0) as actual_amount,
                 sa.pay_status, sa.apply_village_name, sa.apply_group_display,
                 sa.is_proxy, sa.subsidy_type_id, sa.apply_area_no_calc
          FROM subsidy_application sa
          JOIN farmer_profile fp ON fp.id = COALESCE(sa.beneficiary_id, sa.farmer_id)
          JOIN subsidy_type st ON st.id = sa.subsidy_type_id
          WHERE fp.household_id = ?
          ORDER BY sa.apply_year DESC, sa.id DESC
        `, id);
        if (apps.length > 0) {
          const appIds = apps.map((a) => a.id);
          const placeholders = appIds.map(() => "?").join(",");
          try {
            const proxies = db2().allRaw(`
              SELECT sp.application_id, sp.proxy_type as type,
                     sp.beneficiary_farmer_id, sp.proxy_farmer_id,
                     bf.real_name as beneficiary_name,
                     pf.real_name as proxy_name,
                     sp.remark
              FROM subsidy_proxy sp
              LEFT JOIN farmer_profile bf ON bf.id = sp.beneficiary_farmer_id
              LEFT JOIN farmer_profile pf ON pf.id = sp.proxy_farmer_id
              WHERE sp.application_id IN (${placeholders})
            `, ...appIds);
            const proxyMap = /* @__PURE__ */ new Map();
            for (const p of proxies) {
              proxyMap.set(p.application_id, {
                type: p.type,
                beneficiary_farmer_id: p.beneficiary_farmer_id,
                proxy_farmer_id: p.proxy_farmer_id,
                beneficiary_name: p.beneficiary_name,
                proxy_name: p.proxy_name,
                remark: p.remark
              });
            }
            appSummary = apps.map((a) => ({
              ...a,
              proxy_info: proxyMap.get(a.id) || null
            }));
          } catch {
            appSummary = apps;
          }
        } else {
          appSummary = apps;
        }
      } catch {
      }
      const contractedArea = Number(hh.contract_area || 0);
      let areaUsage = {
        contracted_area: contractedArea,
        trust_out_area: 0,
        trust_in_area: 0,
        trust_in_arable_area: 0,
        trust_in_cash_crop_area: 0,
        cultivable_area: contractedArea,
        used_area: 0,
        remaining_area: contractedArea,
        is_overdrawn: false,
        overdraw_amount: 0,
        has_trust_data: false,
        subsidy_breakdown: [],
        season_reference: {},
        season_breakdown: {},
        year_totals: {},
        year_apply_totals: {},
        year_payment_totals: {}
      };
      try {
        const areaRows = db2().allRaw(`
          SELECT sa.apply_year, COALESCE(st.season, '全年单补') as season,
                 COALESCE(SUM(sa.apply_area), 0) as used_area,
                 COALESCE(SUM(sa.apply_area), 0) as apply_area,
                 COALESCE(SUM(CASE WHEN sa.pay_status >= 2 THEN sa.apply_area ELSE 0 END), 0) as payment_area
          FROM subsidy_application sa
          JOIN farmer_profile fp ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp.id
          LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
          WHERE fp.household_id = ?
          GROUP BY sa.apply_year, st.season
          ORDER BY sa.apply_year DESC
        `, id);
        const yt = {};
        const yat = {};
        const ypt = {};
        const seasonTotals = {};
        for (const r of areaRows) {
          const y = String(r.apply_year);
          if (!yt[y]) {
            yt[y] = {};
            yat[y] = {};
            ypt[y] = {};
          }
          yt[y][r.season] = (yt[y][r.season] || 0) + Number(r.used_area);
          yat[y][r.season] = (yat[y][r.season] || 0) + Number(r.apply_area);
          ypt[y][r.season] = (ypt[y][r.season] || 0) + Number(r.payment_area);
          if (!seasonTotals[r.season]) seasonTotals[r.season] = { used: 0, apply: 0, payment: 0 };
          seasonTotals[r.season].used += Number(r.used_area);
          seasonTotals[r.season].apply += Number(r.apply_area);
          seasonTotals[r.season].payment += Number(r.payment_area);
        }
        let allSeasons = ["大春", "小春", "全年单补", "临时"];
        try {
          const seasonRows = db2().allRaw(
            "SELECT DISTINCT season FROM subsidy_type WHERE season IS NOT NULL AND season != '' ORDER BY season"
          );
          if (seasonRows.length > 0) {
            allSeasons = seasonRows.map((r) => r.season);
          }
        } catch {
        }
        const sb = {};
        let totalUsed = 0;
        for (const season of allSeasons) {
          const totals = seasonTotals[season] || { used: 0, apply: 0, payment: 0 };
          const used = Math.round(totals.used * 100) / 100;
          const remaining = Math.max(0, contractedArea - used);
          const isOver = contractedArea > 0 && used > contractedArea;
          sb[season] = {
            used_area: used,
            apply_area: Math.round(totals.apply * 100) / 100,
            payment_area: Math.round(totals.payment * 100) / 100,
            remaining_area: Math.round(remaining * 100) / 100,
            is_overdrawn: isOver,
            overdraw_amount: isOver ? Math.round((used - contractedArea) * 100) / 100 : 0,
            reference_area: contractedArea,
            subsidies: []
          };
          totalUsed = Math.max(totalUsed, used);
        }
        totalUsed = Math.round(totalUsed * 100) / 100;
        areaUsage = {
          ...areaUsage,
          used_area: totalUsed,
          remaining_area: Math.round(Math.max(0, contractedArea - totalUsed) * 100) / 100,
          is_overdrawn: contractedArea > 0 && totalUsed > contractedArea,
          overdraw_amount: contractedArea > 0 ? Math.round(Math.max(0, totalUsed - contractedArea) * 100) / 100 : 0,
          season_breakdown: sb,
          year_totals: yt,
          year_apply_totals: yat,
          year_payment_totals: ypt
        };
      } catch {
      }
      let trustRecords = [];
      try {
        trustRecords = db2().allRaw(`
          SELECT lt.*,
                 oh.household_name as counterparty_name,
                 vh.village_name as counterparty_village_name,
                 oh.group_no as counterparty_group_no
          FROM land_trust lt
          LEFT JOIN family_household oh ON (
            (lt.owner_household_id = ? AND lt.operator_household_id = oh.id)
            OR (lt.operator_household_id = ? AND lt.owner_household_id = oh.id)
          )
          LEFT JOIN village vh ON oh.village_id = vh.id
          WHERE lt.owner_household_id = ? OR lt.operator_household_id = ?
          ORDER BY lt.trust_year DESC
        `, id, id, id, id);
      } catch {
      }
      return success({
        id: hh.id,
        household_code: hh.household_code,
        household_name: hh.household_name,
        village_full_name: villageFullName,
        village_id: hh.village_id,
        group_no: hh.group_no || 1,
        address: hh.address,
        contracted_area: contractedArea,
        confirmed_area: hh.confirmed_area != null ? Number(hh.confirmed_area) : null,
        status: hh.status,
        remark: hh.remark,
        is_manually_confirmed: hh.is_manually_confirmed || 0,
        manually_confirmed_at: hh.manually_confirmed_at || null,
        manually_confirmed_by: hh.manually_confirmed_by || null,
        head_farmer_id: hh.head_farmer_id,
        head_name: hh.head_name,
        group_display: groupDisplay,
        members: members_list,
        app_summary: appSummary,
        area_usage: areaUsage,
        trust_records: trustRecords
      });
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
  electron.ipcMain.handle("households:update", (_e, payload) => {
    try {
      const { id, ...data } = payload;
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
  electron.ipcMain.handle("households:addMember", (_e, payload) => {
    try {
      const { householdId, ...data } = payload;
      const result = db2().runRaw(`
        INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, householdId, data.real_name, data.gender, data.id_card, data.phone, data.bank_card, data.bank_name, data.relation);
      return success({ id: result.lastInsertRowid, household_id: householdId });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:updateMember", (_e, payload) => {
    try {
      const { householdId, farmerId, ...data } = payload;
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
  electron.ipcMain.handle("households:removeMember", (_e, payload) => {
    try {
      const { householdId, farmerId } = payload;
      db2().runRaw("UPDATE farmer_profile SET household_id = NULL, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?", farmerId, householdId);
      return success(null, "移出成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:merge", (_e, payload) => {
    try {
      const { source_household_id: sourceId, target_household_id: targetId, operator } = payload;
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
  electron.ipcMain.handle("households:overdrawn", () => {
    try {
      const rows = db2().allRaw(`
        SELECT hh.*, v.village_name,
               COALESCE(mc.cnt, 0) as member_count,
               COALESCE(area.total, 0) as total_subsidy_area
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN (SELECT household_id, COUNT(*) as cnt FROM farmer_profile GROUP BY household_id) mc
          ON mc.household_id = hh.id
        LEFT JOIN (
          SELECT fp2.household_id, COALESCE(SUM(sa.apply_area), 0) as total
          FROM subsidy_application sa
          JOIN farmer_profile fp2 ON sa.beneficiary_id = fp2.id
          GROUP BY fp2.household_id
        ) area ON area.household_id = hh.id
        WHERE hh.contract_area IS NOT NULL AND hh.contract_area > 0
          AND COALESCE(area.total, 0) > hh.contract_area
        ORDER BY area.total DESC
      `);
      return success(rows.map((r) => ({ ...r, group_display: formatGroupNo(r.group_no) })));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:overdrawnDetail", (_e, payload) => {
    try {
      const year = payload?.year ? Number(payload.year) : (/* @__PURE__ */ new Date()).getFullYear();
      const rows = db2().allRaw(`
        SELECT hh.household_name, head.real_name as head_name,
               v.village_name as village,
               COALESCE(hh.contract_area, 0) as contracted_area,
               COALESCE(hh.cultivable_area, 0) as cultivable_area,
               COALESCE(area.total, 0) as used_area,
               MAX(0, COALESCE(area.total, 0) - COALESCE(hh.contract_area, 0)) as overdraw_amount
        FROM family_household hh
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN farmer_profile head ON head.id = hh.head_farmer_id
        LEFT JOIN (
          SELECT fp2.household_id, COALESCE(SUM(sa.apply_area), 0) as total
          FROM subsidy_application sa
          JOIN farmer_profile fp2 ON COALESCE(sa.beneficiary_id, sa.farmer_id) = fp2.id
          WHERE sa.apply_year = ?
          GROUP BY fp2.household_id
        ) area ON area.household_id = hh.id
        WHERE hh.contract_area IS NOT NULL AND hh.contract_area > 0
          AND COALESCE(area.total, 0) > hh.contract_area
        ORDER BY overdraw_amount DESC
      `, year);
      const items = rows.map((r) => ({ ...r, season_breakdown: {} }));
      return success({ year, total: items.length, items });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:moveMember", (_e, payload) => {
    try {
      const { householdId, farmerId, targetHouseholdId } = payload;
      db2().runRaw(
        "UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?",
        targetHouseholdId,
        farmerId,
        householdId
      );
      db2().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MEMBER_REMOVE', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId,
        `农户ID ${farmerId} 迁出至家庭户 ${targetHouseholdId}`
      );
      db2().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MEMBER_ADD', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        targetHouseholdId,
        `农户ID ${farmerId} 从家庭户 ${householdId} 迁入`
      );
      return success(null, "迁移成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:members", (_e, payload) => {
    try {
      const { householdId } = payload;
      const members = db2().allRaw(`
        SELECT fp.*
        FROM farmer_profile fp
        WHERE fp.household_id = ?
        ORDER BY CASE WHEN fp.relation = '本人' THEN 0 ELSE 1 END, fp.id
      `, householdId);
      return success(members);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:areaByYear", (_e, payload) => {
    try {
      const { householdId } = payload;
      const rows = db2().allRaw(`
        SELECT sa.apply_year,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COALESCE(SUM(sa.apply_area), 0) as total_area,
               COALESCE(SUM(sa.contract_area), 0) as total_contract_area,
               COALESCE(SUM(sa.trust_area), 0) as total_trust_area,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount
        FROM subsidy_application sa
        JOIN farmer_profile fp ON sa.beneficiary_id = fp.id
        WHERE fp.household_id = ?
        GROUP BY sa.apply_year
        ORDER BY sa.apply_year DESC
      `, householdId);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:events", (_e, payload) => {
    try {
      const { householdId, year } = payload;
      let query = "SELECT * FROM household_event WHERE household_id = ?";
      const params = [householdId];
      if (year) {
        query += " AND event_year = ?";
        params.push(year);
      }
      query += " ORDER BY event_date DESC, id DESC";
      const rows = db2().allRaw(query, ...params);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:addEvent", (_e, payload) => {
    try {
      const { householdId, event_type, event_year, description, event_date, related_hh_id, operator } = payload;
      const result = db2().runRaw(`
        INSERT INTO household_event (household_id, event_type, event_year, description, event_date, related_hh_id, date_accuracy)
        VALUES (?, ?, ?, ?, ?, ?, 'YEAR')
      `, householdId, event_type, event_year, description || "", event_date || null, related_hh_id || null);
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:undoEvent", (_e, payload) => {
    try {
      const { householdId, eventId } = payload;
      db2().runRaw("DELETE FROM household_event WHERE id = ? AND household_id = ?", eventId, householdId);
      return success(null, "撤销成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:historyDates", (_e, payload) => {
    try {
      const { householdId } = payload;
      const rows = db2().allRaw(`
        SELECT DISTINCT event_date FROM household_event WHERE household_id = ? AND event_date IS NOT NULL ORDER BY event_date DESC
      `, householdId);
      return success(rows.map((r) => r.event_date));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:snapshotAt", (_e, payload) => {
    try {
      const { householdId, date } = payload;
      const events = db2().allRaw(`
        SELECT * FROM household_event WHERE household_id = ? AND event_date = ? ORDER BY id
      `, householdId, date);
      return success(events);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:snapshotByEvent", (_e, payload) => {
    try {
      const { householdId, eventId } = payload;
      const event = db2().getRaw(
        "SELECT * FROM household_event WHERE id = ?",
        eventId
      );
      return success(event || null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:historyYears", (_e, payload) => {
    try {
      const { householdId } = payload;
      const rows = db2().allRaw(`
        SELECT DISTINCT event_year FROM household_event WHERE household_id = ? ORDER BY event_year DESC
      `, householdId);
      return success(rows.map((r) => r.event_year));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:history", (_e, payload) => {
    try {
      const { householdId, year } = payload;
      const rows = db2().allRaw(`
        SELECT * FROM household_event WHERE household_id = ? AND event_year = ? ORDER BY event_date DESC, id DESC
      `, householdId, year);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:split", (_e, payload) => {
    try {
      const householdId = Number(payload.householdId || payload.household_id) || 0;
      if (!householdId) return errorResponse("缺少源家庭户ID");
      const newHouseholdName = payload.newHouseholdName || payload.new_household_name || "新家庭户";
      const villageId = Number(payload.villageId || payload.village_id) || null;
      const groupNo = Number(payload.groupNo || payload.group_no) || 1;
      const memberIds = payload.memberIds || payload.member_ids || [];
      const newHeadId = Number(payload.newHeadId || payload.new_head_id) || null;
      const newLandArea = Number(payload.newLandArea || payload.new_land_area) || 0;
      const originLandArea = Number(payload.originLandArea || payload.origin_land_area) || 0;
      const code = `HH_SPLIT_${Date.now()}`;
      const result = villageId ? db2().runRaw(`
            INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, status, head_farmer_id, remark)
            VALUES (?, ?, ?, ?, '', ?, 1, ?, ?)
          `, code, newHouseholdName, villageId, groupNo, newLandArea, newHeadId, `从家庭户 ${householdId} 分出`) : db2().runRaw(`
            INSERT INTO family_household (household_code, household_name, group_no, address, contract_area, status, head_farmer_id, remark)
            VALUES (?, ?, ?, '', ?, 1, ?, ?)
          `, code, newHouseholdName, groupNo, newLandArea, newHeadId, `从家庭户 ${householdId} 分出`);
      const newHouseholdId = result.lastInsertRowid;
      const newCode = `HH${String(newHouseholdId).padStart(4, "0")}`;
      db2().runRaw("UPDATE family_household SET household_code = ? WHERE id = ?", newCode, newHouseholdId);
      for (const farmerId of memberIds) {
        if (newHeadId && farmerId === newHeadId) {
          db2().runRaw(
            "UPDATE farmer_profile SET household_id = ?, relation = '本人', updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?",
            newHouseholdId,
            farmerId,
            householdId
          );
        } else {
          db2().runRaw(
            "UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND household_id = ?",
            newHouseholdId,
            farmerId,
            householdId
          );
        }
      }
      if (originLandArea > 0) {
        db2().runRaw("UPDATE family_household SET contract_area = ? WHERE id = ?", originLandArea, householdId);
      }
      db2().runRaw(
        "INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, description, event_date) VALUES (?, ?, 'SPLIT', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId,
        newHouseholdId,
        `分户：分出家庭户 ${newHouseholdName} (${newCode})，分出成员 ${memberIds?.length || 0} 人`
      );
      db2().runRaw(
        "INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, description, event_date) VALUES (?, ?, 'FOUND', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        newHouseholdId,
        householdId,
        `由家庭户 ${householdId} 分出，自动建档`
      );
      return success({ new_household_id: newHouseholdId, new_household_code: newCode });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:batchBuild", (_e, payload) => {
    try {
      const { rows } = payload;
      const created = [];
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const result = db2().runRaw(
            `
            INSERT INTO family_household (household_code, household_name, village_id, group_no, address, contract_area, confirmed_area, status, remark)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            row.household_code || `HH_TEMP_${Date.now()}_${i}`,
            row.household_name || "",
            row.village_id || null,
            row.group_no || 1,
            row.address || "",
            row.contract_area || null,
            row.confirmed_area || null,
            row.status != null ? row.status : 1,
            row.remark || ""
          );
          const id = result.lastInsertRowid;
          const code = `HH${String(id).padStart(4, "0")}`;
          db2().runRaw("UPDATE family_household SET household_code = ? WHERE id = ?", code, id);
          created.push(id);
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) });
        }
      }
      return success({ created, total: rows.length, created_count: created.length, error_count: errors.length, errors });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:batchImportMembers", (_e, payload) => {
    try {
      const { householdId, rows } = payload;
      const created = [];
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const result = db2().runRaw(
            `
            INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
          `,
            householdId,
            row.real_name || "",
            row.gender || 1,
            row.id_card || "",
            row.phone || null,
            row.bank_card || null,
            row.bank_name || null,
            row.relation || "成员"
          );
          created.push(result.lastInsertRowid);
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) });
        }
      }
      return success({ created, total: rows.length, created_count: created.length, error_count: errors.length, errors });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:importConfirmedArea", (_e, payload) => {
    try {
      const rows = payload;
      const updated = [];
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const farmer = db2().getRaw(
            "SELECT id, household_id FROM farmer_profile WHERE real_name = ? AND id_card = ?",
            row.real_name,
            row.id_card
          );
          if (!farmer || !farmer.household_id) {
            errors.push({ row: i + 1, message: `未找到匹配的农户：${row.real_name} ${row.id_card}` });
            continue;
          }
          db2().runRaw(
            "UPDATE family_household SET confirmed_area = ?, updated_at = datetime('now','localtime') WHERE id = ?",
            row.confirmed_area,
            farmer.household_id
          );
          updated.push(farmer.household_id);
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) });
        }
      }
      return success({ updated_count: updated.length, error_count: errors.length, errors });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:manualConfirm", (_e, payload) => {
    try {
      const { householdId, operator, remark } = payload;
      db2().runRaw(
        "UPDATE family_household SET is_manually_confirmed = 1, manually_confirmed_at = datetime('now','localtime'), manually_confirmed_by = ? WHERE id = ?",
        operator || null,
        householdId
      );
      db2().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MANUAL_CONFIRM', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId,
        remark || `人工确认（操作人：${operator || "未知"}）`
      );
      return success(null, "确认成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:cancelConfirm", (_e, payload) => {
    try {
      const { householdId, operator, remark } = payload;
      db2().runRaw("UPDATE family_household SET is_manually_confirmed = 0 WHERE id = ?", householdId);
      db2().runRaw(
        "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MANUAL_CONFIRM', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
        householdId,
        remark || `取消确认（操作人：${operator || "未知"}）`
      );
      return success(null, "已取消确认");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:batchConfirm", (_e, payload) => {
    try {
      const { household_ids, operator, remark } = payload;
      if (!household_ids || !Array.isArray(household_ids)) {
        return errorResponse("household_ids 必须为数组");
      }
      for (const hid of household_ids) {
        db2().runRaw(
          "UPDATE family_household SET is_manually_confirmed = 1, manually_confirmed_at = datetime('now','localtime'), manually_confirmed_by = ? WHERE id = ?",
          operator || null,
          hid
        );
        db2().runRaw(
          "INSERT INTO household_event (household_id, event_type, event_year, description, event_date) VALUES (?, 'MANUAL_CONFIRM', CAST(strftime('%Y','now') AS INTEGER), ?, date('now'))",
          hid,
          remark || `批量确认（操作人：${operator || "未知"}）`
        );
      }
      return success({ confirmed_count: household_ids.length });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("households:recalcUnconfirmedContractArea", () => {
    try {
      const areaRows = db2().allRaw(`
        SELECT fp.household_id, COALESCE(SUM(sa.contract_area), 0) as total_area
        FROM subsidy_application sa
        JOIN farmer_profile fp ON fp.id = COALESCE(sa.beneficiary_id, sa.farmer_id)
        JOIN family_household hh ON hh.id = fp.household_id
        WHERE hh.is_manually_confirmed = 0
          AND sa.apply_year = CAST(strftime('%Y','now') AS INTEGER)
          AND sa.contract_area > 0
        GROUP BY fp.household_id
      `);
      let updated = 0;
      for (const row of areaRows) {
        if (row.total_area > 0) {
          db2().runRaw(
            "UPDATE family_household SET contract_area = ? WHERE id = ?",
            row.total_area,
            row.household_id
          );
          updated++;
        }
      }
      const total = db2().getRaw(
        "SELECT COUNT(*) as cnt FROM family_household WHERE is_manually_confirmed = 0"
      );
      return success({ total_unconfirmed: total?.cnt ?? 0, updated });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerSubsidyHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("subsidies:listTypes", (_e, payload) => {
    try {
      const year = typeof payload === "object" && payload !== null ? payload.year : payload;
      const status = typeof payload === "object" && payload !== null ? payload.status : void 0;
      let query = "SELECT * FROM subsidy_type WHERE 1=1";
      const sqlParams = [];
      if (year) {
        query += " AND subsidy_year = ?";
        sqlParams.push(year);
      }
      if (status !== void 0 && status !== null) {
        query += " AND pay_status = ?";
        sqlParams.push(status);
      }
      query += " ORDER BY subsidy_year DESC";
      return success(db2().allRaw(query, ...sqlParams));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:listTypesWithStats", (_e, year) => {
    try {
      const params = [];
      let stWhere = "";
      let saWhere = "";
      if (year) {
        stWhere = " WHERE st.subsidy_year = ?";
        saWhere = " AND sa.apply_year = ?";
        params.push(year, year);
      } else {
        if (year) params.push(year);
      }
      const rows = db2().allRaw(`
        SELECT st.*,
               COUNT(sa.id) as app_count,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COALESCE(SUM(sa.apply_amount), 0) as total_apply,
               COALESCE(SUM(sa.actual_amount), 0) as total_actual
        FROM subsidy_type st
        LEFT JOIN subsidy_application sa ON st.id = sa.subsidy_type_id${saWhere}
        ${stWhere}
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
  electron.ipcMain.handle("subsidies:updateType", (_e, payload) => {
    try {
      const { id, ...data } = payload;
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
        SELECT sa.*, fp.real_name as farmer_name, fp.id_card, fp.phone,
               st.subsidy_name, st.season, st.calc_mode,
               v.village_name as village, hh.group_no
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id = st.id
        ${where}
        ORDER BY sa.id DESC
        LIMIT ? OFFSET ?
      `, ...values, pageSize, offset);
      const items = rows.map((r) => ({ ...r }));
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
  electron.ipcMain.handle("subsidies:updateApplication", (_e, payload) => {
    try {
      const { id, ...data } = payload;
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
  electron.ipcMain.handle("subsidies:batchImportApplications", (_e, payload) => {
    try {
      const { rows } = payload;
      const inserted = [];
      const updated = [];
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const existing = db2().getRaw(`
            SELECT id FROM subsidy_application
            WHERE apply_year = ? AND subsidy_type_id = ? AND beneficiary_id = ?
          `, row.apply_year, row.subsidy_type_id, row.beneficiary_id);
          if (existing) {
            const keys = Object.keys(row).filter((k) => row[k] !== void 0 && k !== "id");
            const sets = keys.map((k) => `${k} = ?`).join(", ");
            const values = keys.map((k) => row[k]);
            db2().runRaw(`UPDATE subsidy_application SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`, ...values, existing.id);
            updated.push(existing.id);
          } else {
            const cols = Object.keys(row).join(", ");
            const placeholders = Object.keys(row).map(() => "?").join(", ");
            const values = Object.keys(row).map((k) => row[k]);
            const result = db2().runRaw(`INSERT INTO subsidy_application (${cols}) VALUES (${placeholders})`, ...values);
            inserted.push(result.lastInsertRowid);
          }
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) });
        }
      }
      return success({
        total: rows.length,
        inserted_count: inserted.length,
        updated_count: updated.length,
        error_count: errors.length,
        errors
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:areaStatsByVillage", (_e, payload) => {
    try {
      const { subsidy_type_id, year, data_source } = payload;
      const tableName = data_source === "payment" ? "subsidy_payment" : "subsidy_application";
      let query = `
        SELECT v.id as village_id, v.village_name,
               COUNT(DISTINCT sa.beneficiary_id) as beneficiary_count,
               COUNT(*) as application_count,
               COALESCE(SUM(sa.apply_area), 0) as total_area,
               COALESCE(SUM(sa.actual_amount), 0) as total_amount
        FROM ${tableName} sa
        LEFT JOIN farmer_profile fp ON sa.farmer_id = fp.id
        LEFT JOIN family_household hh ON fp.household_id = hh.id
        LEFT JOIN village v ON hh.village_id = v.id
        WHERE 1=1
      `;
      const values = [];
      if (subsidy_type_id) {
        query += " AND sa.subsidy_type_id = ?";
        values.push(subsidy_type_id);
      }
      if (year) {
        query += " AND sa.apply_year = ?";
        values.push(year);
      }
      try {
        const rows = db2().allRaw(
          query + " GROUP BY v.id ORDER BY total_area DESC",
          ...values
        );
        return success(rows);
      } catch {
        const fallbackQuery = query.replace(tableName, "subsidy_application");
        const rows = db2().allRaw(
          fallbackQuery + " GROUP BY v.id ORDER BY total_area DESC",
          ...values
        );
        return success(rows);
      }
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:getCheckConfig", (_e, typeId) => {
    try {
      return success({ check_config: { checks: {} }, raw: null });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:updateCheckConfig", (_e, payload) => {
    try {
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:deleteType", (_e, typeId) => {
    try {
      db2().runRaw("UPDATE subsidy_type SET pay_status = 0, updated_at = datetime('now','localtime') WHERE id = ?", typeId);
      return success({ message: "已移入回收站" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:comparableTypes", (_e, payload) => {
    try {
      const { category, current_type_id } = payload;
      let query = "SELECT id, subsidy_name, subsidy_year FROM subsidy_type WHERE 1=1";
      const params = [];
      if (category) {
        query += " AND category = ?";
        params.push(category);
      }
      if (current_type_id) {
        query += " AND id != ?";
        params.push(current_type_id);
      }
      query += " ORDER BY subsidy_year DESC";
      return success(db2().allRaw(query, ...params));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:restoreType", (_e, typeId) => {
    try {
      db2().runRaw("UPDATE subsidy_type SET pay_status = 2, updated_at = datetime('now','localtime') WHERE id = ?", typeId);
      return success({ message: "恢复成功" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:exportApplications", (_e, subsidyTypeId) => {
    try {
      const rows = db2().allRaw("SELECT * FROM subsidy_application WHERE subsidy_type_id = ?", subsidyTypeId);
      return success({ items: rows });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:exportPayments", (_e, subsidyTypeId) => {
    try {
      const rows = db2().allRaw("SELECT * FROM subsidy_payment WHERE subsidy_type_id = ?", subsidyTypeId);
      return success({ items: rows });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:listPayments", (_e, params = {}) => {
    try {
      const { page, pageSize, offset } = parsePagination(params);
      const subsidyTypeId = Number(params.subsidy_type_id) || 0;
      const paymentYear = Number(params.payment_year) || 0;
      const search = params.search || "";
      let where = "WHERE 1=1";
      const vals = [];
      if (subsidyTypeId) {
        where += " AND sp.subsidy_type_id=?";
        vals.push(subsidyTypeId);
      }
      if (paymentYear) {
        where += " AND sp.payment_year=?";
        vals.push(paymentYear);
      }
      if (search) {
        where += " AND (fp.real_name LIKE ? OR hh.household_name LIKE ?)";
        vals.push(`%${search}%`, `%${search}%`);
      }
      const countRow = db2().getRaw(`SELECT COUNT(*) as cnt FROM subsidy_payment sp LEFT JOIN farmer_profile fp ON sp.beneficiary_id=fp.id LEFT JOIN family_household hh ON fp.household_id=hh.id ${where}`, ...vals);
      const rows = db2().allRaw(`SELECT sp.*, fp.real_name as farmer_name, hh.household_name, hh.household_code FROM subsidy_payment sp LEFT JOIN farmer_profile fp ON sp.beneficiary_id=fp.id LEFT JOIN family_household hh ON fp.household_id=hh.id ${where} ORDER BY sp.id DESC LIMIT ? OFFSET ?`, ...vals, pageSize, offset);
      return successList(rows, countRow?.cnt ?? 0, page, pageSize);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:deleteApplication", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM subsidy_application WHERE id=?", id);
      return success({ message: "已删除" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:deletePayment", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM subsidy_payment WHERE id=?", id);
      return success({ message: "已删除" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:batchDeleteApplications", (_e, payload) => {
    try {
      if (payload.delete_all) {
        db2().runRaw("DELETE FROM subsidy_application WHERE subsidy_type_id=?", payload.subsidy_type_id);
        return success({ message: "已全部删除" });
      }
      for (const id of payload.ids || []) db2().runRaw("DELETE FROM subsidy_application WHERE id=?", id);
      return success({ message: `已删除 ${(payload.ids || []).length} 条` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:batchDeletePayments", (_e, payload) => {
    try {
      if (payload.delete_all) {
        db2().runRaw("DELETE FROM subsidy_payment WHERE subsidy_type_id=?", payload.subsidy_type_id);
        return success({ message: "已全部删除" });
      }
      for (const id of payload.ids || []) db2().runRaw("DELETE FROM subsidy_payment WHERE id=?", id);
      return success({ message: `已删除 ${(payload.ids || []).length} 条` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:convertToPayment", (_e, payload) => {
    try {
      const ids = payload.application_ids || [];
      let count = 0;
      for (const appId of ids) {
        const app = db2().getRaw("SELECT * FROM subsidy_application WHERE id=?", appId);
        if (!app) continue;
        const exist = db2().getRaw("SELECT id FROM subsidy_payment WHERE application_id=?", appId);
        if (exist) continue;
        db2().runRaw(
          `INSERT INTO subsidy_payment (subsidy_type_id, beneficiary_id, farmer_id, payment_year, applicant_name, id_card, apply_area, contract_area, trust_area, no_subsidy_area, amount, pay_status, is_proxy, payment_village_name, payment_group_display, application_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          app.subsidy_type_id,
          app.beneficiary_id,
          app.farmer_id,
          app.apply_year,
          app.applicant_name,
          app.id_card,
          app.apply_area,
          app.contract_area,
          app.trust_area,
          app.no_subsidy_area,
          app.actual_amount || app.apply_amount,
          2,
          app.is_proxy,
          app.apply_village_name,
          app.apply_group_display,
          appId
        );
        count++;
      }
      return success({ message: `已转换 ${count} 条` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:applicationStats", (_e, params) => {
    try {
      const { subsidy_type_id, year, compare_type_id } = params || {};
      const rows = db2().allRaw(`SELECT sa.apply_year, COUNT(*) as cnt, COALESCE(SUM(sa.apply_area),0) as total_area, COALESCE(SUM(sa.actual_amount),0) as total_amount FROM subsidy_application sa WHERE sa.subsidy_type_id=? ${year ? "AND sa.apply_year=?" : ""} GROUP BY sa.apply_year ORDER BY sa.apply_year`, subsidy_type_id, ...year ? [year] : []);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:applicationVillages", (_e, params) => {
    try {
      const { subsidy_type_id, year } = params || {};
      const rows = db2().allRaw(`SELECT sa.apply_village_name as village_name, sa.apply_group_display as group_display, COUNT(*) as cnt FROM subsidy_application sa WHERE sa.subsidy_type_id=? ${year ? "AND sa.apply_year=?" : ""} GROUP BY sa.apply_village_name, sa.apply_group_display ORDER BY sa.apply_village_name`, subsidy_type_id, ...year ? [year] : []);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:batchImportPayments", (_e, payload) => {
    try {
      const { rows, overwrite } = payload;
      let created = 0, skipped = 0;
      for (const row of rows) {
        if (overwrite) {
          const exist = db2().getRaw(
            "SELECT id FROM subsidy_payment WHERE subsidy_type_id=? AND beneficiary_id=? AND payment_year=?",
            row.subsidy_type_id,
            row.beneficiary_id,
            row.payment_year
          );
          if (exist) {
            db2().runRaw("DELETE FROM subsidy_payment WHERE id=?", exist.id);
            skipped++;
          }
        }
        const cols = Object.keys(row).filter((k) => row[k] !== void 0).join(",");
        const ph = Object.keys(row).filter((k) => row[k] !== void 0).map(() => "?").join(",");
        const vals = Object.keys(row).filter((k) => row[k] !== void 0).map((k) => row[k]);
        db2().runRaw(`INSERT INTO subsidy_payment (${cols}) VALUES (${ph})`, ...vals);
        created++;
      }
      return success({ message: `导入完成：新增${created}，覆盖${skipped}` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:precheck", (_e, params) => {
    try {
      const { subsidy_type_id, year, pay_status, village_name } = params || {};
      let where = "WHERE 1=1";
      const vals = [];
      if (subsidy_type_id) {
        where += " AND sa.subsidy_type_id=?";
        vals.push(subsidy_type_id);
      }
      if (year) {
        where += " AND sa.apply_year=?";
        vals.push(year);
      }
      if (pay_status != null) {
        where += " AND sa.pay_status=?";
        vals.push(pay_status);
      }
      if (village_name) {
        where += " AND sa.apply_village_name=?";
        vals.push(village_name);
      }
      const rows = db2().allRaw(`
        SELECT sa.*, fp.real_name as farmer_name, st.subsidy_name, hh.household_name
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        ${where} ORDER BY sa.id
      `, ...vals);
      return success({ items: rows, total: rows.length });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:exportPrecheck", (_e, params) => {
    try {
      const { subsidy_type_id, year, village_name } = params || {};
      let where = "WHERE 1=1";
      const vals = [];
      if (subsidy_type_id) {
        where += " AND sa.subsidy_type_id=?";
        vals.push(subsidy_type_id);
      }
      if (year) {
        where += " AND sa.apply_year=?";
        vals.push(year);
      }
      if (village_name) {
        where += " AND sa.apply_village_name=?";
        vals.push(village_name);
      }
      const rows = db2().allRaw(`
        SELECT sa.*, fp.real_name as farmer_name, st.subsidy_name, hh.household_name
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        ${where} ORDER BY sa.apply_village_name, fp.real_name
      `, ...vals);
      return success({ items: rows });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("subsidies:exportPrecheckWithOptions", (_e, params) => {
    try {
      const { subsidy_type_id, year, village_name, pay_status } = params || {};
      let where = "WHERE 1=1";
      const vals = [];
      if (subsidy_type_id) {
        where += " AND sa.subsidy_type_id=?";
        vals.push(subsidy_type_id);
      }
      if (year) {
        where += " AND sa.apply_year=?";
        vals.push(year);
      }
      if (village_name) {
        where += " AND sa.apply_village_name=?";
        vals.push(village_name);
      }
      if (pay_status != null) {
        where += " AND sa.pay_status=?";
        vals.push(pay_status);
      }
      const rows = db2().allRaw(`
        SELECT sa.*, fp.real_name as farmer_name, st.subsidy_name, hh.household_name, hh.household_code
        FROM subsidy_application sa
        LEFT JOIN farmer_profile fp ON sa.beneficiary_id=fp.id
        LEFT JOIN subsidy_type st ON sa.subsidy_type_id=st.id
        LEFT JOIN family_household hh ON fp.household_id=hh.id
        ${where} ORDER BY sa.apply_village_name, fp.real_name
      `, ...vals);
      return success({ items: rows });
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
  electron.ipcMain.handle("land:update", (_e, payload) => {
    try {
      const { id, ...data } = payload;
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
  function ensureLargeFarmerTables() {
    try {
      db2().runRaw("CREATE TABLE IF NOT EXISTS large_farmer (id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_name TEXT, household_id INTEGER, household_name TEXT, village_name TEXT, land_area REAL, remark TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
    } catch {
    }
    try {
      db2().runRaw("CREATE TABLE IF NOT EXISTS large_farmer_trust (id INTEGER PRIMARY KEY AUTOINCREMENT, large_farmer_id INTEGER, trust_type TEXT, land_area REAL, trust_year INTEGER, start_date TEXT, end_date TEXT, remark TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))");
    } catch {
    }
  }
  ensureLargeFarmerTables();
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
  electron.ipcMain.handle("land:createLargeFarmer", (_e, payload) => {
    try {
      const cols = Object.keys(payload).filter((k) => payload[k] !== void 0).join(",");
      const ph = Object.keys(payload).filter((k) => payload[k] !== void 0).map(() => "?").join(",");
      const vals = Object.keys(payload).filter((k) => payload[k] !== void 0).map((k) => payload[k]);
      const r = db2().runRaw(`INSERT INTO large_farmer (${cols}) VALUES (${ph})`, ...vals);
      return success({ id: r.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:updateLargeFarmer", (_e, payload) => {
    try {
      const { id, ...data } = payload;
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k}=?`).join(",");
      const vals = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE large_farmer SET ${sets} WHERE id=?`, ...vals, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:deleteLargeFarmer", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM large_farmer_trust WHERE large_farmer_id=?", id);
      db2().runRaw("DELETE FROM large_farmer WHERE id=?", id);
      return success({ message: "已删除" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:listLargeFarmerTrusts", (_e, payload) => {
    try {
      const { id, year } = payload || {};
      let sql = "SELECT * FROM large_farmer_trust WHERE large_farmer_id=?";
      const params = [id];
      if (year) {
        sql += " AND trust_year=?";
        params.push(year);
      }
      sql += " ORDER BY trust_year DESC";
      const rows = db2().allRaw(sql, ...params);
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:createLargeFarmerTrust", (_e, payload) => {
    try {
      const { large_farmer_id, trust_type, land_area, trust_year, start_date, end_date, remark } = payload;
      const r = db2().runRaw(
        "INSERT INTO large_farmer_trust (large_farmer_id, trust_type, land_area, trust_year, start_date, end_date, remark) VALUES (?,?,?,?,?,?,?)",
        large_farmer_id,
        trust_type,
        land_area,
        trust_year,
        start_date || null,
        end_date || null,
        remark || ""
      );
      return success({ id: r.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:updateLargeFarmerTrust", (_e, payload) => {
    try {
      const { id, large_farmer_id, ...data } = payload;
      const keys = Object.keys(data).filter((k) => data[k] !== void 0);
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k}=?`).join(",");
      const vals = keys.map((k) => data[k]);
      db2().runRaw(`UPDATE large_farmer_trust SET ${sets} WHERE id=?`, ...vals, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:deleteLargeFarmerTrust", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM large_farmer_trust WHERE id=?", id);
      return success({ message: "已删除" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("land:searchHousehold", (_e, payload) => {
    try {
      const q = payload.q || "";
      const rows = db2().allRaw(
        `SELECT hh.id as household_id, hh.household_code, hh.household_name,
                (SELECT real_name FROM farmer_profile WHERE id=hh.head_farmer_id) as head_name,
                COALESCE(v.village_name,'') as village_name
         FROM family_household hh LEFT JOIN village v ON hh.village_id=v.id
         WHERE hh.household_name LIKE ? OR hh.household_code LIKE ?
         LIMIT 20`,
        `%${q}%`,
        `%${q}%`
      );
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
const DEFAULT_SETTINGS = {
  updateServerUrl: "http://8.137.8.78:8080/",
  autoCheckUpdate: true,
  lastUpdateCheck: null
};
function getConfigPath() {
  const dir = path.join(electron.app.getPath("userData"));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "user-settings.json");
}
function readSettings() {
  try {
    const path2 = getConfigPath();
    if (fs.existsSync(path2)) {
      const raw = fs.readFileSync(path2, "utf-8");
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
  }
  return { ...DEFAULT_SETTINGS };
}
function writeSettings(settings) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("[Store] 保存设置失败:", e);
  }
}
let cachedSettings = null;
function getSettings() {
  if (!cachedSettings) cachedSettings = readSettings();
  return cachedSettings;
}
function getUpdateServerUrl() {
  return getSettings().updateServerUrl;
}
function setUpdateServerUrl(url) {
  const s = getSettings();
  s.updateServerUrl = url;
  writeSettings(s);
}
function getAutoCheckUpdate() {
  return getSettings().autoCheckUpdate;
}
function setAutoCheckUpdate(v) {
  const s = getSettings();
  s.autoCheckUpdate = v;
  writeSettings(s);
}
function getLastUpdateCheck() {
  return getSettings().lastUpdateCheck;
}
function setLastUpdateCheck(date) {
  const s = getSettings();
  s.lastUpdateCheck = date;
  writeSettings(s);
}
let mainWindow$1 = null;
function setUpdateWindow(win) {
  mainWindow$1 = win;
}
function configureUpdater(url) {
  if (url) {
    electronUpdater.autoUpdater.setFeedURL({
      provider: "generic",
      url: url.replace(/\/+$/, "")
      // 去掉末尾斜杠
    });
  }
}
async function checkForUpdatesSilent() {
  const url = getUpdateServerUrl();
  if (!url) return;
  configureUpdater(url);
  try {
    const result = await electronUpdater.autoUpdater.checkForUpdates();
    if (result?.updateInfo?.version !== electronUpdater.autoUpdater.currentVersion) {
      mainWindow$1?.webContents.send("update:available", {
        version: result.updateInfo.version,
        currentVersion: electronUpdater.autoUpdater.currentVersion
      });
    }
  } catch (e) {
    console.log("[Updater] 检查更新失败:", e.message);
  }
  setLastUpdateCheck((/* @__PURE__ */ new Date()).toISOString());
}
async function checkForUpdatesAndInstall() {
  const url = getUpdateServerUrl();
  if (!url) {
    return { error: "未配置更新服务器地址，请在软件更新面板中填写" };
  }
  let cleanUrl = url.replace(/\/+$/, "");
  if (cleanUrl.endsWith("latest.yml")) {
    cleanUrl = cleanUrl.replace(/\/?latest\.yml$/, "");
  }
  const latestUrl = `${cleanUrl}/latest.yml`;
  const steps = [];
  steps.push(`🔍 正在连接: ${latestUrl}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1e4);
    const response = await fetch(latestUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return {
        error: `服务器返回 HTTP ${response.status}`,
        steps: [...steps, `❌ 服务器响应: HTTP ${response.status}`],
        detail: `请确认 ${latestUrl} 可正常访问
常见原因:
1. 服务器未启动或端口错误
2. latest.yml 未上传到服务器目录
3. 防火墙未开放端口`
      };
    }
    const ymlContent = await response.text();
    steps.push(`✅ 已连接服务器，获取到 latest.yml (${ymlContent.length} 字节)`);
    let serverVersion = "";
    const versionMatch = ymlContent.match(/version:\s*(\S+)/);
    if (versionMatch) {
      serverVersion = versionMatch[1];
      steps.push(`服务器版本: ${serverVersion}`);
    } else {
      steps.push(`⚠️ latest.yml 中未找到版本号`);
    }
    const currentVersion = require("electron").app.getVersion();
    steps.push(`当前版本: ${currentVersion}`);
    if (!serverVersion || serverVersion === currentVersion) {
      setLastUpdateCheck((/* @__PURE__ */ new Date()).toISOString());
      return {
        message: `当前已是最新版本 (v${currentVersion})`,
        steps,
        currentVersion,
        serverVersion: serverVersion || "未知"
      };
    }
    steps.push(`发现新版本 v${serverVersion}，开始下载...`);
    configureUpdater(cleanUrl);
    try {
      const checkResult = await electronUpdater.autoUpdater.checkForUpdates();
      if (!checkResult || !checkResult.updateInfo) {
        return {
          error: "无法获取更新信息",
          steps: [...steps, "❌ checkForUpdates 返回空"],
          detail: "服务器 latest.yml 格式可能不正确"
        };
      }
      steps.push(`✅ 解析更新信息成功 (v${checkResult.updateInfo.version})`);
      await electronUpdater.autoUpdater.downloadUpdate();
      steps.push(`✅ 下载完成`);
      setLastUpdateCheck((/* @__PURE__ */ new Date()).toISOString());
      return {
        message: `更新已下载 (v${currentVersion} → v${serverVersion})，重启后安装`,
        steps,
        currentVersion,
        serverVersion
      };
    } catch (downloadErr) {
      return {
        error: `下载失败: ${downloadErr.message}`,
        steps: [...steps, `❌ 下载失败: ${downloadErr.message}`],
        detail: `请确认:
1. exe 文件已上传到 ${cleanUrl}/
2. latest.yml 中 url 字段与实际文件名一致
3. sha512/文件大小正确`
      };
    }
  } catch (e) {
    if (e.name === "AbortError") {
      return {
        error: "连接超时 (10秒)",
        steps: [...steps, "❌ 请求超时无响应"],
        detail: `无法访问 ${latestUrl}
请检查:
1. 服务器是否在线 (ping ${cleanUrl.split("/")[2]})
2. 地址和端口是否填写正确
3. 防火墙/安全组是否开放端口`
      };
    }
    return {
      error: `网络连接失败`,
      steps: [...steps, `❌ 无法连接: ${e.message || "未知错误"}`],
      detail: `目标地址: ${latestUrl}
失败原因: ${e.message}
请确认:
1. 网址格式正确 (如 http://8.137.8.78:8080/)
2. 服务器已启动并监听该端口
3. 本机可访问该地址`
    };
  }
}
function registerUpdateEvents() {
  electronUpdater.autoUpdater.autoDownload = false;
  electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
  electronUpdater.autoUpdater.on("checking-for-update", () => {
    mainWindow$1?.webContents.send("update:status", "checking");
  });
  electronUpdater.autoUpdater.on("update-available", (info) => {
    mainWindow$1?.webContents.send("update:status", "available");
    mainWindow$1?.webContents.send("update:available", {
      version: info.version,
      currentVersion: electronUpdater.autoUpdater.currentVersion
    });
  });
  electronUpdater.autoUpdater.on("update-not-available", () => {
    mainWindow$1?.webContents.send("update:status", "up-to-date");
  });
  electronUpdater.autoUpdater.on("download-progress", (progress) => {
    const speedMB = progress.bytesPerSecond ? (progress.bytesPerSecond / (1024 * 1024)).toFixed(1) : "0.0";
    mainWindow$1?.webContents.send("update:progress", {
      percent: Math.round(progress.percent),
      speed: progress.bytesPerSecond,
      speedMB: `${speedMB} MB/s`,
      transferred: progress.transferred,
      total: progress.total
    });
  });
  electronUpdater.autoUpdater.on("update-downloaded", () => {
    mainWindow$1?.webContents.send("update:status", "downloaded");
    electron.dialog.showMessageBox({
      type: "info",
      title: "更新已下载",
      message: "新版本已下载完成，是否立即重启安装？",
      buttons: ["立即重启", "稍后"],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        electronUpdater.autoUpdater.quitAndInstall(true, true);
      }
    });
  });
  electronUpdater.autoUpdater.on("error", (error) => {
    mainWindow$1?.webContents.send("update:status", "error");
    mainWindow$1?.webContents.send("update:error", error.message);
  });
}
function getBackupDir() {
  const dir = path.join(electron.app.getPath("userData"), "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
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
  electron.ipcMain.handle("settings:getDbInfo", () => {
    try {
      const dbPath = getDbPath();
      const stat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : { size: 0 };
      const sizeKb = Math.round(stat.size / 1024);
      const sizeMb = Math.round(stat.size / 1024 / 1024 * 100) / 100;
      const tables = ["farmer_profile", "family_household", "village_group", "subsidy_type", "subsidy_application"];
      const recordCounts = {};
      let totalRecords = 0;
      for (const t of tables) {
        try {
          const r = db2().getRaw(`SELECT COUNT(*) as cnt FROM "${t}"`);
          recordCounts[t] = r?.cnt ?? 0;
          totalRecords += r?.cnt ?? 0;
        } catch {
          recordCounts[t] = 0;
        }
      }
      const backupDir = getBackupDir();
      const backups = [];
      try {
        for (const f of fs.readdirSync(backupDir)) {
          if (f.endsWith(".db")) {
            const fs$1 = fs.statSync(path.join(backupDir, f));
            backups.push({
              filename: f,
              size_kb: Math.round(fs$1.size / 1024),
              created: fs$1.birthtime.toISOString().split("T")[0]
            });
          }
        }
        backups.sort((a, b) => b.created.localeCompare(a.created));
      } catch {
      }
      return success({
        db_path: dbPath,
        db_size_kb: sizeKb,
        db_size_mb: sizeMb,
        total_records: totalRecords,
        record_counts: recordCounts,
        backups,
        backup_dir: backupDir
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:downloadDb", async () => {
    try {
      const result = await electron.dialog.showSaveDialog({
        title: "保存数据库文件",
        defaultPath: "subsidy.db",
        filters: [{ name: "SQLite 数据库", extensions: ["db"] }]
      });
      if (result.canceled || !result.filePath) return success(null, "已取消");
      fs.copyFileSync(getDbPath(), result.filePath);
      return success({ message: "下载成功", path: result.filePath });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:exportExcel", async () => {
    try {
      const XLSX = require("xlsx");
      const wb = XLSX.utils.book_new();
      const sheets = [
        { name: "农户档案", table: "farmer_profile" },
        { name: "家庭户", table: "family_household" },
        { name: "补贴记录", table: "subsidy_application" },
        { name: "补贴项目", table: "subsidy_type" },
        { name: "村组配置", table: "village_group" }
      ];
      for (const { name, table } of sheets) {
        try {
          const rows = db2().allRaw(`SELECT * FROM "${table}"`);
          if (rows.length > 0) {
            const ws = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, name);
          }
        } catch {
        }
      }
      const result = await electron.dialog.showSaveDialog({
        title: "导出 Excel",
        defaultPath: `数据备份_${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}.xlsx`,
        filters: [{ name: "Excel 文件", extensions: ["xlsx"] }]
      });
      if (result.canceled || !result.filePath) return success(null, "已取消");
      XLSX.writeFile(wb, result.filePath);
      return success({ message: "导出成功", path: result.filePath });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:createBackup", () => {
    try {
      const backupDir = getBackupDir();
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `backup_${timestamp}.db`;
      const destPath = path.join(backupDir, filename);
      fs.copyFileSync(getDbPath(), destPath);
      const stat = fs.statSync(destPath);
      return success({
        message: "备份创建成功",
        filename,
        size_kb: Math.round(stat.size / 1024),
        path: destPath
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:downloadBackup", async (_e, filename) => {
    try {
      const srcPath = path.join(getBackupDir(), filename);
      if (!fs.existsSync(srcPath)) return errorResponse("备份文件不存在");
      const result = await electron.dialog.showSaveDialog({
        title: "下载备份",
        defaultPath: filename,
        filters: [{ name: "SQLite 数据库", extensions: ["db"] }]
      });
      if (result.canceled || !result.filePath) return success(null, "已取消");
      fs.copyFileSync(srcPath, result.filePath);
      return success({ message: "下载成功" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:deleteBackup", (_e, filename) => {
    try {
      const filePath = path.join(getBackupDir(), filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return success({ message: "已删除" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:previewRestore", async (_e, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return errorResponse("备份文件不存在");
      const fileStat = fs.statSync(filePath);
      const tables = [];
      let totalRecords = 0;
      try {
        const initSqlJs = require("sql.js");
        const SQL = await initSqlJs();
        const fileBuffer = fs.readFileSync(filePath);
        const srcDb = new SQL.Database(fileBuffer);
        const rows = srcDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
        if (rows.length > 0) {
          for (const col of rows[0].values) {
            const tableName = col[0];
            try {
              const cnt = srcDb.exec(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
              const count = cnt.length > 0 ? Number(cnt[0].values[0][0]) : 0;
              tables.push({ name: tableName, count });
              totalRecords += count;
            } catch {
              tables.push({ name: tableName, count: 0 });
            }
          }
        }
        srcDb.close();
      } catch {
      }
      return success({
        filePath,
        fileName: path.basename(filePath),
        fileSizeKb: Math.round(fileStat.size / 1024),
        fileSizeMb: (fileStat.size / 1024 / 1024).toFixed(1),
        tables,
        tableCount: tables.length,
        totalRecords
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:restore", async (_e, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return errorResponse("备份文件不存在");
      const emergencyDir = getBackupDir();
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const emergencyPath = path.join(emergencyDir, `emergency_before_restore_${timestamp}.db`);
      fs.copyFileSync(getDbPath(), emergencyPath);
      const fileStat = fs.statSync(filePath);
      const tables = [];
      let totalRecords = 0;
      try {
        const initSqlJs = require("sql.js");
        const SQL = await initSqlJs();
        const fileBuffer = fs.readFileSync(filePath);
        const srcDb = new SQL.Database(fileBuffer);
        const rows = srcDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
        if (rows.length > 0) {
          for (const col of rows[0].values) {
            const tableName = col[0];
            try {
              const cnt = srcDb.exec(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
              const count = cnt.length > 0 ? Number(cnt[0].values[0][0]) : 0;
              tables.push({ name: tableName, count });
              totalRecords += count;
            } catch {
              tables.push({ name: tableName, count: 0 });
            }
          }
        }
        srcDb.close();
      } catch {
      }
      fs.copyFileSync(filePath, getDbPath());
      return success({
        message: `数据库恢复完成！共 ${tables.length} 个表，${totalRecords} 条记录`,
        backup_created: path.basename(emergencyPath),
        source_file: path.basename(filePath),
        source_size_kb: Math.round(fileStat.size / 1024),
        tables_imported: tables.length,
        total_records: totalRecords,
        details: tables.map((t) => `${t.name}: ${t.count} 条`)
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:getUpdateConfig", () => {
    try {
      return success({
        updateServerUrl: getUpdateServerUrl(),
        autoCheckUpdate: getAutoCheckUpdate(),
        lastUpdateCheck: getLastUpdateCheck(),
        currentVersion: electron.app.getVersion()
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:setUpdateConfig", (_e, config) => {
    try {
      if (config.updateServerUrl !== void 0) setUpdateServerUrl(config.updateServerUrl);
      if (config.autoCheckUpdate !== void 0) setAutoCheckUpdate(config.autoCheckUpdate);
      return success({ message: "设置已保存" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:checkForUpdate", async () => {
    try {
      return success(await checkForUpdatesAndInstall());
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:listVillages", () => {
    try {
      const rows = db2().allRaw("SELECT id, village_name FROM village ORDER BY village_name");
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:villageDetail", (_e, villageId) => {
    try {
      const v = db2().getRaw("SELECT * FROM village WHERE id=?", villageId);
      if (!v) return errorResponse("村不存在", 404);
      const groups = db2().allRaw("SELECT * FROM village_group WHERE village_id=? ORDER BY group_no", villageId);
      return success({ ...v, groups });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:updateVillage", (_e, payload) => {
    try {
      const { id, ...data } = payload;
      const keys = Object.keys(data).filter((k) => data[k] !== void 0 && k !== "id");
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k}=?`).join(",");
      db2().runRaw(`UPDATE village SET ${sets} WHERE id=?`, ...keys.map((k) => data[k]), id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:batchCreateVillageGroups", (_e, payload) => {
    try {
      const { rows } = payload;
      let created = 0;
      for (const r of rows) {
        let village = db2().getRaw("SELECT id FROM village WHERE village_name=?", r.village_name);
        if (!village) {
          const vr = db2().runRaw("INSERT INTO village (village_name) VALUES (?)", r.village_name);
          village = { id: Number(vr.lastInsertRowid) };
        }
        const exist = db2().getRaw("SELECT id FROM village_group WHERE village_id=? AND group_no=?", village.id, r.group_no);
        if (!exist) {
          db2().runRaw("INSERT INTO village_group (village_id, group_no) VALUES (?,?)", village.id, r.group_no);
          created++;
        }
      }
      return success({ message: `已创建 ${created} 个村组` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:updateVillageGroup", (_e, payload) => {
    try {
      const { id, ...data } = payload;
      const keys = Object.keys(data).filter((k) => data[k] !== void 0 && k !== "id");
      if (keys.length === 0) return errorResponse("无更新数据");
      db2().runRaw(`UPDATE village_group SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`, ...keys.map((k) => data[k]), id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:deleteVillageGroup", (_e, gId) => {
    try {
      const hhCount = db2().getRaw("SELECT COUNT(*) as cnt FROM family_household WHERE village_id IN (SELECT village_id FROM village_group WHERE id=?)", gId)?.cnt ?? 0;
      if (hhCount > 0) return errorResponse(`该村组下有 ${hhCount} 个家庭户，无法删除`);
      db2().runRaw("DELETE FROM village_group WHERE id=?", gId);
      return success({ message: "已删除" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:villageReferences", (_e, vid) => {
    try {
      const hhCount = db2().getRaw("SELECT COUNT(*) as cnt FROM family_household WHERE village_id=?", vid)?.cnt ?? 0;
      const farmerCount = db2().getRaw("SELECT COUNT(*) as cnt FROM farmer_profile WHERE own_village_id=?", vid)?.cnt ?? 0;
      return success({ households: hhCount, farmers: farmerCount, canDelete: hhCount === 0 && farmerCount === 0 });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("settings:batchUpdateLeaders", (_e, payload) => {
    try {
      const { rows } = payload;
      let updated = 0;
      for (const r of rows) {
        db2().runRaw(
          "UPDATE family_household SET head_farmer_id=(SELECT id FROM farmer_profile WHERE household_id=? AND relation='本人' LIMIT 1) WHERE id=?",
          r.household_id || 0,
          r.household_id || 0
        );
        updated++;
      }
      return success({ message: `已更新 ${updated} 个家庭户` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("agri-tasks:listVillageLandInfo", () => {
    try {
      const rows = db2().allRaw(`
        SELECT vg.id as village_id, v.village_name, vg.group_no,
               (SELECT COUNT(*) FROM family_household WHERE village_id=v.id AND group_no=vg.group_no) as household_count,
               (SELECT COALESCE(SUM(contract_area),0) FROM family_household WHERE village_id=v.id AND group_no=vg.group_no) as total_contract_area
        FROM village_group vg JOIN village v ON vg.village_id=v.id ORDER BY v.village_name, vg.group_no
      `);
      return success(rows.map((r) => ({ ...r, group_display: formatGroupNo(r.group_no) })));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("agri-tasks:updateVillageLandInfo", (_e, payload) => {
    try {
      const { village_id, ...data } = payload;
      if (data.contract_area != null) {
        db2().runRaw(
          "UPDATE family_household SET contract_area=? WHERE village_id=?",
          data.contract_area,
          village_id
        );
      }
      return success({ message: "已更新" });
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
  electron.ipcMain.handle("precheck:saveHistory", (_e, payload) => {
    try {
      return success({ saved: 0, batch_key: "" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("precheck:listHistory", (_e, params = {}) => {
    try {
      return successList([], 0);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("precheck:listBatches", (_e, payload) => {
    try {
      return success({ batches: [] });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("precheck:resolveHistory", (_e, id) => {
    try {
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("precheck:unresolveHistory", (_e, id) => {
    try {
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("precheck:deleteHistory", (_e, id) => {
    try {
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("precheck:autoResolve", (_e, payload) => {
    try {
      return success({ resolved_count: 0, total: 0 });
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
  electron.ipcMain.handle("excel-templates:detectColumns", (_e, payload) => {
    try {
      const { columns, business_type, sample_rows } = payload;
      if (!columns || !Array.isArray(columns)) {
        return errorResponse("columns 必须为字符串数组");
      }
      const keywordMap = {
        household_name: ["户名", "家庭名称", "家庭户名称", "户主姓名"],
        real_name: ["姓名", "农户姓名", "姓名/名称"],
        id_card: ["身份证", "身份证号", "身份证号码", "公民身份号码"],
        phone: ["手机", "手机号", "联系电话", "电话"],
        gender: ["性别"],
        bank_card: ["银行卡", "银行卡号", "银行账号", "账号"],
        bank_name: ["开户行", "银行名称", "开户银行"],
        relation: ["与户主关系", "关系", "家庭关系"],
        household_code: ["户编码", "户号", "家庭编号"],
        address: ["地址", "家庭地址", "居住地址", "户籍地址"],
        village_name: ["村", "村名", "所属村", "行政村"],
        group_no: ["组", "组别", "村组", "小组"],
        contract_area: ["承包面积", "承包地面积", "地亩数"],
        confirmed_area: ["确权面积", "确权地亩"],
        remark: ["备注", "说明", "备注信息"],
        farmer_status: ["状态", "农户状态"],
        apply_year: ["年度", "年份", "补贴年度"],
        apply_area: ["补贴面积", "申请面积"],
        apply_amount: ["补贴金额", "补贴标准", "单价", "申请金额"],
        subsidy_name: ["补贴名称", "补贴项目", "补贴类型"]
      };
      const mapping = {};
      const unmatched = [];
      for (const col of columns) {
        let bestField = "";
        let bestConfidence = 0;
        for (const [field, keywords] of Object.entries(keywordMap)) {
          for (const kw of keywords) {
            if (col === kw) {
              if (bestConfidence < 100) {
                bestField = field;
                bestConfidence = 100;
              }
            } else if (col.includes(kw) || kw.includes(col)) {
              const score = 70;
              if (score > bestConfidence) {
                bestField = field;
                bestConfidence = score;
              }
            }
          }
        }
        if (bestConfidence >= 70) {
          mapping[col] = { column: bestField, confidence: bestConfidence };
        } else {
          unmatched.push(col);
        }
      }
      return success({
        business_type,
        detected_count: Object.keys(mapping).length,
        unmatched_count: unmatched.length,
        mapping,
        unmatched
      });
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
  electron.ipcMain.handle("error-library:update", (_e, payload) => {
    try {
      const { id, ...data } = payload;
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
  electron.ipcMain.handle("error-library:stats", () => {
    try {
      const rows = db2().allRaw(`
        SELECT error_type, COUNT(*) as count
        FROM error_library
        GROUP BY error_type
        ORDER BY count DESC
      `);
      const total = db2().getRaw("SELECT COUNT(*) as cnt FROM error_library");
      return success({ total: total?.cnt ?? 0, by_type: rows });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("error-library:batchImport", (_e, payload) => {
    try {
      const { rows } = payload;
      const inserted = [];
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const cols = Object.keys(row).join(", ");
          const placeholders = Object.keys(row).map(() => "?").join(", ");
          const values = Object.keys(row).map((k) => row[k]);
          const result = db2().runRaw(`INSERT INTO error_library (${cols}) VALUES (${placeholders})`, ...values);
          inserted.push(result.lastInsertRowid);
        } catch (rowErr) {
          errors.push({ row: i + 1, message: String(rowErr) });
        }
      }
      return success({
        total: rows.length,
        inserted_count: inserted.length,
        error_count: errors.length,
        errors
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerHouseholdImportHandlers() {
  const db2 = () => getDb();
  electron.ipcMain.handle("household-import:preview", (_e, payload) => {
    try {
      const rows = payload;
      if (!rows || rows.length === 0) {
        return errorResponse("没有可导入的数据");
      }
      const allFarmers = /* @__PURE__ */ new Map();
      for (const f of db2().allRaw("SELECT * FROM farmer_profile")) {
        allFarmers.set(f.id_card, f);
      }
      const allHouseholds = /* @__PURE__ */ new Map();
      for (const h of db2().allRaw("SELECT * FROM family_household WHERE status = 1")) {
        allHouseholds.set(h.id, h);
      }
      const villageMap = /* @__PURE__ */ new Map();
      for (const v of db2().allRaw("SELECT id, village_name FROM village")) {
        villageMap.set(v.id, v.village_name);
      }
      const parsed = [];
      const rowErrors = [];
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const name = String(row.real_name || "").trim();
        const idCard = String(row.id_card || "").trim().toUpperCase();
        const address = String(row.address || "").trim();
        const relation = String(row.head_relation || "").trim();
        const householdCode = String(row.household_code || "").trim();
        const farmerStatus = String(row.farmer_status || "").trim();
        const rawVillage = String(row.village_name || "").trim();
        const rawGroup = String(row.group_no || "").trim();
        const errs = [];
        if (!name) errs.push("姓名为空");
        if (!idCard) errs.push("身份证号为空");
        else {
          const [ok, msg] = validateIdCard(idCard);
          if (!ok) errs.push(`身份证格式错误: ${msg}`);
        }
        if (!address && !householdCode) errs.push("家庭住址和家庭编码均为空");
        if (errs.length > 0) {
          rowErrors.push({ row: idx + 1, name, errors: errs });
        }
        parsed.push({
          real_name: name,
          id_card: idCard,
          address,
          head_relation: relation,
          is_head: relation.includes("户主"),
          phone: row.phone || null,
          bank_card: row.bank_card || null,
          bank_name: row.bank_name || null,
          gender: resolveGender(idCard, String(row.gender || "")),
          household_code: householdCode,
          farmer_status: farmerStatus,
          village_name: rawVillage,
          group_no: rawGroup,
          has_errors: errs.length > 0
        });
      }
      const groupsMap = /* @__PURE__ */ new Map();
      const groupsMeta = /* @__PURE__ */ new Map();
      for (const p of parsed) {
        const code = p.household_code || "";
        if (code) {
          const key = `CODE:${code}`;
          if (!groupsMap.has(key)) groupsMap.set(key, []);
          groupsMap.get(key).push(p);
          groupsMeta.set(key, { household_code: code });
        } else if (p.address) {
          const key = `ADDR:${p.address}`;
          if (!groupsMap.has(key)) groupsMap.set(key, []);
          groupsMap.get(key).push(p);
          groupsMeta.set(key, { household_code: "" });
        }
      }
      const previewGroups = [];
      const conflicts = [];
      for (const [key, members] of groupsMap) {
        const meta = groupsMeta.get(key);
        const displayKey = key.replace(/^(CODE:|ADDR:)/, "");
        const heads = members.filter((m) => m.is_head);
        const warnings = [];
        let head;
        if (heads.length === 0) {
          warnings.push("未找到户主标记，将以第一个成员作为户主");
          head = members[0];
        } else if (heads.length > 1) {
          warnings.push(`存在 ${heads.length} 个户主标记，将以第一个作为户主`);
          head = heads[0];
        } else {
          head = heads[0];
        }
        const matchedHhIds = /* @__PURE__ */ new Set();
        const memberDbInfo = [];
        for (const m of members) {
          const existingFarmer = allFarmers.get(m.id_card);
          if (existingFarmer) {
            matchedHhIds.add(existingFarmer.household_id);
            const hh = allHouseholds.get(existingFarmer.household_id);
            memberDbInfo.push({
              id_card: m.id_card,
              farmer_id: existingFarmer.id,
              household_id: existingFarmer.household_id,
              village_id: hh?.village_id || null,
              group_no: hh?.group_no || null
            });
          }
        }
        let codeMatchedHh = null;
        if (meta.household_code) {
          codeMatchedHh = db2().getRaw(
            "SELECT * FROM family_household WHERE household_code = ? AND status = 1",
            meta.household_code
          );
          if (codeMatchedHh) {
            matchedHhIds.add(codeMatchedHh.id);
            if (!allHouseholds.has(codeMatchedHh.id)) {
              allHouseholds.set(codeMatchedHh.id, codeMatchedHh);
            }
          }
        }
        let targetVillageId = null;
        let targetGroupNo = 1;
        const inputVillage = String(head.village_name || "").trim();
        const inputGroup = String(head.group_no || "").trim();
        if (inputVillage) {
          let v = db2().getRaw(
            "SELECT id FROM village WHERE village_name = ?",
            inputVillage
          );
          if (!v) {
            const r = db2().runRaw("INSERT INTO village (village_name) VALUES (?)", inputVillage);
            v = { id: r.lastInsertRowid };
          }
          targetVillageId = v.id;
        }
        if (inputGroup) {
          targetGroupNo = parseGroupNoToInt(inputGroup);
        } else if (!inputVillage) {
          const headExisting = allFarmers.get(head.id_card);
          if (headExisting) {
            const hh = allHouseholds.get(headExisting.household_id);
            if (hh) {
              targetVillageId = targetVillageId || hh.village_id;
              targetGroupNo = hh.group_no || targetGroupNo;
            }
          }
          if (!targetVillageId && memberDbInfo.length > 0) {
            targetVillageId = memberDbInfo[0].village_id;
            targetGroupNo = memberDbInfo[0].group_no || 1;
          }
          if (!targetVillageId && codeMatchedHh) {
            targetVillageId = codeMatchedHh.village_id;
            targetGroupNo = codeMatchedHh.group_no || 1;
          }
        }
        const matchedList = [...matchedHhIds];
        let action;
        if (matchedList.length === 0) {
          action = "create";
        } else if (matchedList.length === 1) {
          action = "merge_one";
        } else {
          action = "merge_multi";
          warnings.push(`涉及 ${matchedList.length} 个已有家庭户，将执行合并`);
        }
        const areaValues = matchedList.map((hid) => allHouseholds.get(hid)).filter(Boolean).map((hh) => Number(hh.contract_area)).filter((v) => v > 0);
        const totalArea = areaValues.length > 0 ? Math.round(areaValues.reduce((a, b) => a + b, 0) / areaValues.length * 100) / 100 : null;
        const matchedHhInfo = matchedList.map((hid) => allHouseholds.get(hid)).filter(Boolean).map((hh) => ({
          id: hh.id,
          household_code: hh.household_code,
          household_name: hh.household_name,
          village_name: villageMap.get(hh.village_id) || "",
          group_display: formatGroupNo(hh.group_no),
          contract_area: hh.contract_area ? Number(hh.contract_area) : null
        }));
        previewGroups.push({
          address: displayKey,
          household_code: meta.household_code || null,
          action,
          head_name: head.real_name,
          head_id_card: head.id_card,
          member_count: members.length,
          members: members.map((m) => ({
            real_name: m.real_name,
            id_card: m.id_card,
            is_head: m.is_head,
            in_db: allFarmers.has(m.id_card),
            has_errors: m.has_errors
          })),
          matched_hh_info: matchedHhInfo,
          target_village_name: targetVillageId ? villageMap.get(targetVillageId) || "" : "",
          target_group_display: formatGroupNo(targetGroupNo),
          total_area_after_merge: totalArea,
          warnings,
          has_errors: members.some((m) => m.has_errors)
        });
      }
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const ic = String(row.id_card || "").trim().toUpperCase();
        if (ic && allFarmers.has(ic)) {
          const existing = allFarmers.get(ic);
          conflicts.push({
            row: idx + 1,
            real_name: row.real_name,
            id_card: ic.substring(0, 6) + "****" + ic.substring(ic.length - 4),
            village_name: row.village_name || "",
            group_no: row.group_no || "",
            phone: row.phone || "",
            db_name: existing.real_name,
            db_household_id: existing.household_id
          });
        }
      }
      const actionCounts = { create: 0, merge_one: 0, merge_multi: 0 };
      for (const g of previewGroups) {
        const act = g.action;
        actionCounts[act] = (actionCounts[act] || 0) + 1;
      }
      return success({
        groups: previewGroups,
        row_errors: rowErrors,
        conflicts,
        summary: {
          total_rows: rows.length,
          total_groups: groupsMap.size,
          new_households: actionCounts.create,
          merge_single: actionCounts.merge_one,
          merge_multi: actionCounts.merge_multi,
          error_rows: rowErrors.length
        }
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("household-import:execute", (_e, payload) => {
    try {
      const rowsData = payload.rows;
      if (!rowsData || rowsData.length === 0) {
        return errorResponse("没有可导入的数据");
      }
      const defaultVillage = String(payload.default_village_name || "").trim();
      const defaultGroup = String(payload.default_group_no || "").trim();
      const rows = rowsData.map((r) => ({ ...r }));
      if (defaultVillage || defaultGroup) {
        for (const row of rows) {
          if (defaultVillage && !row.village_name) row.village_name = defaultVillage;
          if (defaultGroup && !row.group_no) row.group_no = defaultGroup;
        }
      }
      const allFarmers = /* @__PURE__ */ new Map();
      for (const f of db2().allRaw("SELECT * FROM farmer_profile")) {
        allFarmers.set(f.id_card, f);
      }
      const allHouseholds = /* @__PURE__ */ new Map();
      for (const h of db2().allRaw("SELECT * FROM family_household WHERE status = 1")) {
        allHouseholds.set(h.id, h);
      }
      const parsed = [];
      const rowErrors = [];
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const name = String(row.real_name || "").trim();
        const idCard = String(row.id_card || "").trim().toUpperCase();
        const address = String(row.address || "").trim();
        const relation = String(row.head_relation || "").trim();
        const householdCode = String(row.household_code || "").trim();
        const farmerStatus = String(row.farmer_status || "").trim();
        const rawVillage = String(row.village_name || "").trim();
        const rawGroup = String(row.group_no || "").trim();
        const errs = [];
        if (!name) errs.push("姓名为空");
        if (!idCard) errs.push("身份证号为空");
        else {
          const [ok, msg] = validateIdCard(idCard);
          if (!ok) errs.push(`身份证格式错误: ${msg}`);
        }
        if (!address && !householdCode) errs.push("家庭住址和家庭编码均为空");
        if (errs.length > 0) {
          rowErrors.push({ row: idx + 1, name, errors: errs });
        }
        parsed.push({
          real_name: name,
          id_card: idCard,
          address,
          head_relation: relation,
          is_head: relation.includes("户主"),
          phone: row.phone || null,
          bank_card: row.bank_card || null,
          bank_name: row.bank_name || null,
          gender: resolveGender(idCard, String(row.gender || "")),
          household_code: householdCode,
          farmer_status: farmerStatus,
          village_name: rawVillage,
          group_no: rawGroup,
          has_errors: errs.length > 0
        });
      }
      const groupsMap = /* @__PURE__ */ new Map();
      for (const p of parsed) {
        const code = p.household_code || "";
        const key = code ? `CODE:${code}` : `ADDR:${p.address || ""}`;
        if (!groupsMap.has(key)) groupsMap.set(key, []);
        groupsMap.get(key).push(p);
      }
      const now = /* @__PURE__ */ new Date();
      const yearNow = now.getFullYear();
      const dateStr = now.toISOString().split("T")[0];
      let createdHh = 0, mergedHh = 0, createdFarmers = 0, skippedFarmers = 0;
      const importErrors = [
        ...rowErrors.map((e) => `第${e.row}行(${e.name}): ${e.errors.join("; ")}`)
      ];
      for (const [key, members] of groupsMap) {
        const displayKey = key.replace(/^(CODE:|ADDR:)/, "");
        if (members.some((m) => m.has_errors)) {
          importErrors.push(`地址「${displayKey}」存在格式错误行，该组已跳过`);
          continue;
        }
        const heads = members.filter((m) => m.is_head);
        const head = heads.length > 0 ? heads[0] : members[0];
        const matchedHhIds = /* @__PURE__ */ new Set();
        for (const m of members) {
          const existing = allFarmers.get(m.id_card);
          if (existing) matchedHhIds.add(existing.household_id);
        }
        const matchedList = [...matchedHhIds];
        let action;
        if (matchedList.length === 0) action = "create";
        else if (matchedList.length === 1) action = "merge_one";
        else action = "merge_multi";
        let villageId = null;
        let groupNo = 1;
        const inputVillage = String(head.village_name || "").trim();
        const inputGroup = String(head.group_no || "").trim();
        if (inputVillage) {
          let v = db2().getRaw("SELECT id FROM village WHERE village_name = ?", inputVillage);
          if (!v) {
            const r = db2().runRaw("INSERT INTO village (village_name) VALUES (?)", inputVillage);
            v = { id: r.lastInsertRowid };
          }
          villageId = v.id;
        }
        if (inputGroup) {
          groupNo = parseGroupNoToInt(inputGroup);
        } else if (!inputVillage) {
          const headExisting = allFarmers.get(head.id_card);
          if (headExisting) {
            const hh = allHouseholds.get(headExisting.household_id);
            if (hh) {
              villageId = hh.village_id;
              groupNo = hh.group_no || 1;
            }
          }
        }
        if (!villageId) {
          let pending = db2().getRaw("SELECT id FROM village WHERE village_name = '待分配'");
          if (!pending) {
            const r = db2().runRaw("INSERT INTO village (village_name) VALUES ('待分配')");
            pending = { id: r.lastInsertRowid };
          }
          villageId = pending.id;
        }
        let targetHhId;
        if (action === "create") {
          const r = db2().runRaw(
            `INSERT INTO family_household (household_code, household_name, head_farmer_id, village_id, group_no, registered_address, status, remark)
             VALUES ('', ?, NULL, ?, ?, ?, 1, '批量导入')`,
            `${head.real_name}户`,
            villageId,
            groupNo,
            displayKey
          );
          targetHhId = r.lastInsertRowid;
          db2().runRaw(
            `INSERT INTO household_event (household_id, event_type, event_year, event_date, description, operator)
             VALUES (?, 'FOUND', ?, ?, ?, '批量导入')`,
            targetHhId,
            yearNow,
            dateStr,
            `批量导入建档，来源住址：${displayKey}`
          );
          createdHh++;
        } else if (action === "merge_one") {
          targetHhId = matchedList[0];
          const hh = allHouseholds.get(targetHhId);
          if (!hh.registered_address) {
            db2().runRaw("UPDATE family_household SET registered_address = ?, updated_at = datetime('now','localtime') WHERE id = ?", displayKey, targetHhId);
          }
          db2().runRaw(
            `INSERT INTO household_event (household_id, event_type, event_year, event_date, description, operator)
             VALUES (?, 'MEMBER_ADD', ?, ?, ?, '批量导入')`,
            targetHhId,
            yearNow,
            dateStr,
            `批量导入：并入来自住址「${displayKey}」的成员`
          );
          mergedHh++;
        } else {
          const headExisting = allFarmers.get(head.id_card);
          let keepId;
          if (headExisting && matchedList.includes(headExisting.household_id)) {
            keepId = headExisting.household_id;
          } else {
            keepId = matchedList.reduce((a, b) => {
              const countA = [...allFarmers.values()].filter((f) => f.household_id === a).length;
              const countB = [...allFarmers.values()].filter((f) => f.household_id === b).length;
              return countA >= countB ? a : b;
            });
          }
          targetHhId = keepId;
          const targetHh = allHouseholds.get(targetHhId);
          if (!targetHh.registered_address) {
            db2().runRaw("UPDATE family_household SET registered_address = ?, updated_at = datetime('now','localtime') WHERE id = ?", displayKey, targetHhId);
          }
          const areaVals = matchedList.map((hid) => allHouseholds.get(hid)).filter(Boolean).map((h) => Number(h.contract_area)).filter((v) => v > 0);
          if (areaVals.length > 0) {
            const avg = Math.round(areaVals.reduce((a, b) => a + b, 0) / areaVals.length * 100) / 100;
            db2().runRaw("UPDATE family_household SET contract_area = ?, updated_at = datetime('now','localtime') WHERE id = ?", avg, targetHhId);
          }
          const discardIds = matchedList.filter((hid) => hid !== keepId);
          for (const discardId of discardIds) {
            db2().runRaw("UPDATE farmer_profile SET household_id = ?, updated_at = datetime('now','localtime') WHERE household_id = ?", targetHhId, discardId);
            db2().runRaw("UPDATE family_household SET status = 2, updated_at = datetime('now','localtime') WHERE id = ?", discardId);
            db2().runRaw(
              `INSERT INTO household_event (household_id, related_hh_id, event_type, event_year, event_date, description, operator)
               VALUES (?, ?, 'MERGE', ?, ?, ?, '批量导入')`,
              discardId,
              targetHhId,
              yearNow,
              dateStr,
              `批量导入合并：并入 ${targetHh.household_code}（${targetHh.household_name}），本户注销`
            );
          }
          db2().runRaw(
            `INSERT INTO household_event (household_id, event_type, event_year, event_date, description, operator)
             VALUES (?, 'MERGE', ?, ?, ?, '批量导入')`,
            targetHhId,
            yearNow,
            dateStr,
            `批量导入合并：吸收 ${discardIds.length} 个家庭户，来源住址：${displayKey}`
          );
          mergedHh++;
        }
        let firstNewFarmerId = null;
        for (const m of members) {
          if (allFarmers.has(m.id_card)) {
            const existing = allFarmers.get(m.id_card);
            const updates = [];
            const values = [];
            updates.push("real_name = ?");
            values.push(m.real_name);
            updates.push("gender = ?");
            values.push(m.gender);
            updates.push("relation = ?");
            values.push(m.is_head ? "户主" : m.head_relation || "成员");
            if (m.phone !== void 0) {
              updates.push("phone = ?");
              values.push(m.phone);
            }
            if (m.bank_card !== void 0) {
              updates.push("bank_card = ?");
              values.push(m.bank_card);
            }
            if (m.bank_name !== void 0) {
              updates.push("bank_name = ?");
              values.push(m.bank_name);
            }
            updates.push("updated_at = datetime('now','localtime')");
            if (m.farmer_status) {
              updates.push("farmer_status = ?");
              values.push(mapFarmerStatus(m.farmer_status));
            }
            if (action !== "create" && existing.household_id !== targetHhId) {
              updates.push("household_id = ?");
              values.push(targetHhId);
            }
            db2().runRaw(
              `UPDATE farmer_profile SET ${updates.join(", ")} WHERE id = ?`,
              ...values,
              existing.id
            );
            skippedFarmers++;
            continue;
          }
          const relation = m.is_head ? "户主" : m.head_relation || "成员";
          const fs2 = m.farmer_status ? mapFarmerStatus(m.farmer_status) : 1;
          const r = db2().runRaw(
            `INSERT INTO farmer_profile (household_id, real_name, gender, id_card, phone, bank_card, bank_name, relation, farmer_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            targetHhId,
            m.real_name,
            m.gender,
            m.id_card,
            m.phone || null,
            m.bank_card || null,
            m.bank_name || null,
            relation,
            fs2
          );
          const newFarmerId = r.lastInsertRowid;
          if (!firstNewFarmerId) firstNewFarmerId = newFarmerId;
          allFarmers.set(m.id_card, {
            id: newFarmerId,
            household_id: targetHhId,
            real_name: m.real_name,
            id_card: m.id_card
          });
          createdFarmers++;
          if (m.is_head) {
            const currentHead = db2().getRaw(
              "SELECT head_farmer_id FROM family_household WHERE id = ?",
              targetHhId
            );
            if (!currentHead?.head_farmer_id) {
              db2().runRaw("UPDATE family_household SET head_farmer_id = ? WHERE id = ?", newFarmerId, targetHhId);
            } else if (action !== "create") {
              const oldHeadId = currentHead.head_farmer_id;
              db2().runRaw("UPDATE family_household SET head_farmer_id = ? WHERE id = ?", newFarmerId, targetHhId);
              db2().runRaw(
                `INSERT INTO household_event (household_id, event_type, farmer_id, farmer_name, event_year, event_date, description, operator)
                 VALUES (?, 'HEAD_CHANGE', ?, ?, ?, ?, ?, '批量导入')`,
                targetHhId,
                newFarmerId,
                m.real_name,
                yearNow,
                dateStr,
                `批量导入：户主变更（原户主ID:${oldHeadId} → ${m.real_name}）`
              );
            }
          }
        }
        if (action === "create" && firstNewFarmerId) {
          const currentHead = db2().getRaw(
            "SELECT head_farmer_id FROM family_household WHERE id = ?",
            targetHhId
          );
          if (!currentHead?.head_farmer_id) {
            db2().runRaw("UPDATE family_household SET head_farmer_id = ? WHERE id = ?", firstNewFarmerId, targetHhId);
          }
          const headId = currentHead?.head_farmer_id || firstNewFarmerId;
          const code = `HH${String(headId).padStart(4, "0")}`;
          db2().runRaw("UPDATE family_household SET household_code = ?, updated_at = datetime('now','localtime') WHERE id = ?", code, targetHhId);
        }
      }
      return success({
        created_households: createdHh,
        merged_households: mergedHh,
        created_farmers: createdFarmers,
        skipped_farmers: skippedFarmers,
        errors: importErrors
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function resolveGender(idCard, genderStr) {
  if (genderStr) {
    return ["男", "1", "male", "M"].includes(genderStr.trim()) ? 1 : 2;
  }
  if (idCard.length === 18) {
    return parseInt(idCard[16]) % 2 === 1 ? 1 : 2;
  }
  return 1;
}
function mapFarmerStatus(status) {
  const lower = status.toLowerCase();
  const deadKeywords = ["死亡", "去世", "deceased", "dead"];
  const movedKeywords = ["移居", "迁出", "moved", "移出"];
  const abroadKeywords = ["出国", "overseas", "abroad"];
  const missingKeywords = ["失踪", "missing"];
  const allBad = [...deadKeywords, ...movedKeywords, ...abroadKeywords, ...missingKeywords];
  if (allBad.some((kw) => lower.includes(kw))) return 0;
  return 1;
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
    );

    CREATE TABLE IF NOT EXISTS query_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER,
      site_name VARCHAR(100) NOT NULL,
      query_type VARCHAR(50) NOT NULL,
      query_input TEXT NOT NULL,
      query_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );
  `);
  const cols = db2().allRaw("PRAGMA table_info('query_record')");
  const colNames = cols.map((c) => c.name);
  const addCol = (name, def) => {
    if (!colNames.includes(name)) {
      db2().runRaw(`ALTER TABLE query_record ADD COLUMN ${name} ${def}`);
    }
  };
  addCol("purpose", "TEXT");
  addCol("operator", "TEXT DEFAULT '操作员'");
  addCol("tags", "TEXT");
  addCol("result_note", "TEXT");
  electron.ipcMain.handle("external-links:list", () => {
    try {
      const rows = db2().allRaw(
        "SELECT * FROM external_site WHERE is_active = 1 ORDER BY sort_order"
      );
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:createSite", (_e, data) => {
    try {
      const cols2 = Object.keys(data).join(", ");
      const vals = Object.keys(data).map(() => "?").join(", ");
      const result = db2().runRaw(
        `INSERT INTO external_site (${cols2}) VALUES (${vals})`,
        ...Object.values(data)
      );
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:updateSite", (_e, payload) => {
    try {
      const { id, ...data } = payload;
      const sets = Object.keys(data).map((k) => `${k} = ?`).join(", ");
      db2().runRaw(
        `UPDATE external_site SET ${sets} WHERE id = ?`,
        ...Object.values(data),
        id
      );
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:deleteSite", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM external_site WHERE id = ?", id);
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:listRecords", (_e, params = {}) => {
    try {
      const page = Number(params.page) || 1;
      const pageSize = Number(params.page_size) || 20;
      const offset = (page - 1) * pageSize;
      const search = params.search ? String(params.search) : "";
      let where = "WHERE 1=1";
      const values = [];
      if (search) {
        where += " AND (query_input LIKE ? OR result_note LIKE ? OR site_name LIKE ? OR query_type LIKE ? OR purpose LIKE ?)";
        const s = `%${search}%`;
        values.push(s, s, s, s, s);
      }
      const countRow = db2().getRaw(
        `SELECT COUNT(*) as cnt FROM query_record ${where}`,
        ...values
      );
      const rows = db2().allRaw(
        `SELECT * FROM query_record ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        ...values,
        pageSize,
        offset
      );
      const items = rows.map((r) => {
        let queryInputs = [];
        try {
          queryInputs = JSON.parse(r.query_input);
        } catch {
          queryInputs = [r.query_input || ""];
        }
        return {
          ...r,
          query_inputs: queryInputs,
          query_count: r.query_count || queryInputs.length
        };
      });
      return success({ items, total: countRow?.cnt ?? 0 });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:createRecord", (_e, data) => {
    try {
      const d = { ...data };
      if (Array.isArray(d.query_inputs)) {
        d.query_input = JSON.stringify(d.query_inputs);
        d.query_count = d.query_inputs.length;
      } else if (d.query_input) {
        d.query_input = String(d.query_input);
        d.query_count = 1;
      }
      delete d.query_inputs;
      const cols2 = Object.keys(d).join(", ");
      const vals = Object.keys(d).map(() => "?").join(", ");
      const result = db2().runRaw(
        `INSERT INTO query_record (${cols2}) VALUES (${vals})`,
        ...Object.values(d)
      );
      return success({ id: result.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:updateRecord", (_e, payload) => {
    try {
      const { id, ...data } = payload;
      const d = { ...data };
      const sets = Object.keys(d).map((k) => `${k} = ?`).join(", ");
      db2().runRaw(
        `UPDATE query_record SET ${sets} WHERE id = ?`,
        ...Object.values(d),
        id
      );
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:deleteRecord", (_e, id) => {
    try {
      db2().runRaw("DELETE FROM query_record WHERE id = ?", id);
      return success(null);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("external-links:stats", () => {
    try {
      const totalRow = db2().getRaw(
        "SELECT COUNT(*) as total_records, COALESCE(SUM(query_count),0) as total_items FROM query_record"
      );
      const byType = db2().allRaw(
        "SELECT query_type as type, COUNT(*) as times, COALESCE(SUM(query_count),0) as total_items FROM query_record GROUP BY query_type ORDER BY times DESC"
      );
      const bySite = db2().allRaw(
        "SELECT site_name as site, COUNT(*) as times FROM query_record GROUP BY site_name ORDER BY times DESC"
      );
      return success({
        total_records: totalRow?.total_records ?? 0,
        total_items: totalRow?.total_items ?? 0,
        by_type: byType,
        by_site: bySite
      });
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
let authEnabled = true;
let tokenCounter = 1;
function ensureUsersTable() {
  try {
    getDb().runRaw(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        role TEXT DEFAULT 'user',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    const admin = getDb().getRaw("SELECT id FROM users WHERE username=?", "admin");
    if (!admin) {
      getDb().runRaw(
        "INSERT INTO users (username, password, display_name, role) VALUES (?,?,?,?)",
        "admin",
        "admin123",
        "管理员",
        "admin"
      );
    }
  } catch {
  }
}
function registerAuthHandlers() {
  ensureUsersTable();
  electron.ipcMain.handle("auth:status", () => {
    try {
      return success({ auth_enabled: authEnabled });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("auth:login", (_e, payload) => {
    try {
      const { username, password } = payload;
      const user = getDb().getRaw(
        "SELECT * FROM users WHERE username=? AND is_active=1",
        username
      );
      if (!user || user.password !== password) {
        return errorResponse("用户名或密码错误", 401);
      }
      const token = `local_token_${tokenCounter++}_${Date.now()}`;
      return success({
        token,
        user_id: user.id,
        username,
        display_name: user.display_name,
        role: user.role
      });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("auth:listUsers", () => {
    try {
      const rows = getDb().allRaw(
        "SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY id"
      );
      return success(rows.map((r) => ({ ...r, password: void 0 })));
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("auth:createUser", (_e, form) => {
    try {
      const exist = getDb().getRaw("SELECT id FROM users WHERE username=?", form.username);
      if (exist) return errorResponse("用户名已存在");
      const r = getDb().runRaw(
        "INSERT INTO users (username, password, display_name, role, is_active) VALUES (?,?,?,?,?)",
        form.username,
        form.password || "123456",
        form.display_name || "",
        form.role || "user",
        form.is_active ?? 1
      );
      return success({ id: r.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("auth:updateUser", (_e, payload) => {
    try {
      const { id, is_active, password, display_name, role } = payload;
      const updates = [];
      const vals = [];
      if (is_active !== void 0) {
        updates.push("is_active=?");
        vals.push(is_active);
      }
      if (password) {
        updates.push("password=?");
        vals.push(password);
      }
      if (display_name) {
        updates.push("display_name=?");
        vals.push(display_name);
      }
      if (role) {
        updates.push("role=?");
        vals.push(role);
      }
      if (updates.length === 0) return errorResponse("无更新数据");
      vals.push(id);
      getDb().runRaw(`UPDATE users SET ${updates.join(",")}, created_at=datetime('now','localtime') WHERE id=?`, ...vals);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("auth:changePassword", (_e, pwdForm) => {
    try {
      const user = getDb().getRaw(
        "SELECT * FROM users WHERE id=? AND is_active=1",
        pwdForm.user_id || 1
      );
      if (!user) return errorResponse("用户不存在");
      if (pwdForm.old_password && user.password !== pwdForm.old_password) {
        return errorResponse("原密码错误");
      }
      getDb().runRaw("UPDATE users SET password=? WHERE id=?", pwdForm.new_password, user.id);
      return success({ message: "密码已修改" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function registerProjectProgressHandlers() {
  const db2 = () => getDb();
  try {
    db2().runRaw(`
      CREATE TABLE IF NOT EXISTS project_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subsidy_type_id INTEGER NOT NULL,
        village_id INTEGER NOT NULL,
        village_name TEXT DEFAULT '',
        person_name TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        stages TEXT DEFAULT '[]',
        note TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(subsidy_type_id, village_id)
      )
    `);
  } catch {
  }
  electron.ipcMain.handle("project-progress:get", (_e, projectId) => {
    try {
      const rows = db2().allRaw(`
        SELECT * FROM project_progress WHERE subsidy_type_id = ? ORDER BY village_name
      `, projectId);
      const records = rows.map((r) => ({
        ...r,
        stages: safeParse(r.stages, [])
      }));
      return success(records);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("project-progress:save", (_e, payload) => {
    try {
      const { projectId, village_id, village_name, person_name, phone, stages, note } = payload;
      const stagesJson = JSON.stringify(stages || []);
      const existing = db2().getRaw(
        "SELECT id FROM project_progress WHERE subsidy_type_id = ? AND village_id = ?",
        projectId,
        village_id
      );
      if (existing) {
        db2().runRaw(
          `UPDATE project_progress SET village_name=?, person_name=?, phone=?, stages=?, note=?, updated_at=datetime('now','localtime') WHERE id=?`,
          village_name || "",
          person_name || "",
          phone || "",
          stagesJson,
          note || "",
          existing.id
        );
      } else {
        db2().runRaw(
          `INSERT INTO project_progress (subsidy_type_id, village_id, village_name, person_name, phone, stages, note) VALUES (?,?,?,?,?,?,?)`,
          projectId,
          village_id,
          village_name || "",
          person_name || "",
          phone || "",
          stagesJson,
          note || ""
        );
      }
      return success({ message: "已保存" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("project-progress:batch", (_e, payload) => {
    try {
      const { projectId, action } = payload;
      const rows = db2().allRaw(
        "SELECT * FROM project_progress WHERE subsidy_type_id = ?",
        projectId
      );
      switch (action) {
        case "init": {
          const villages = db2().allRaw(
            "SELECT vg.*, v.village_name FROM village_group vg JOIN village v ON vg.village_id = v.id ORDER BY v.village_name, vg.group_no"
          );
          let added = 0;
          for (const v of villages) {
            const exists = rows.find((r) => r.village_id === v.id);
            if (!exists) {
              db2().runRaw(
                `INSERT INTO project_progress (subsidy_type_id, village_id, village_name, stages) VALUES (?,?,?,?)`,
                projectId,
                v.id,
                `${v.village_name}${formatGroupNoSimple(v.group_no)}`,
                "[]"
              );
              added++;
            }
          }
          return success({ message: `已初始化 ${added} 个村` });
        }
        case "sync_leaders": {
          let updated = 0;
          for (const r of rows) {
            const leader = db2().getRaw(`
              SELECT fp.real_name, fp.phone FROM farmer_profile fp
              JOIN family_household hh ON fp.household_id = hh.id
              WHERE hh.village_id = (SELECT village_id FROM village_group WHERE id = ?)
              AND fp.relation = '本人'
              LIMIT 1
            `, r.village_id);
            if (leader) {
              db2().runRaw(
                `UPDATE project_progress SET person_name=?, phone=?, updated_at=datetime('now','localtime') WHERE id=?`,
                leader.real_name || "",
                leader.phone || "",
                r.id
              );
              updated++;
            }
          }
          return success({ message: `已同步`, updated });
        }
        case "add_stage_to_all": {
          const { stage } = payload;
          for (const r of rows) {
            const stages = safeParse(r.stages, []);
            if (!stages.find((s) => s.name === stage.name)) {
              stages.push(stage);
              db2().runRaw(
                `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
                JSON.stringify(stages),
                r.id
              );
            }
          }
          return success({ message: `已添加阶段「${stage.name}」` });
        }
        case "batch_stage": {
          const { stage_name, status, date } = payload;
          for (const r of rows) {
            const stages = safeParse(r.stages, []);
            const idx = stages.findIndex((s) => s.name === stage_name);
            if (idx >= 0) {
              stages[idx] = { ...stages[idx], status, date: date || stages[idx].date };
              db2().runRaw(
                `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
                JSON.stringify(stages),
                r.id
              );
            }
          }
          return success({ message: `已批量更新「${stage_name}」` });
        }
        case "swap_stages": {
          const { stage_a, stage_b } = payload;
          for (const r of rows) {
            const stages = safeParse(r.stages, []);
            const ia = stages.findIndex((s) => s.name === stage_a);
            const ib = stages.findIndex((s) => s.name === stage_b);
            if (ia >= 0 && ib >= 0) {
              ;
              [stages[ia], stages[ib]] = [stages[ib], stages[ia]];
              db2().runRaw(
                `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
                JSON.stringify(stages),
                r.id
              );
            }
          }
          return success({ message: "已交换阶段顺序" });
        }
        default:
          return errorResponse("未知操作: " + action);
      }
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("project-progress:deleteStage", (_e, payload) => {
    try {
      const { projectId, stage_name } = payload;
      const rows = db2().allRaw(
        "SELECT * FROM project_progress WHERE subsidy_type_id = ?",
        projectId
      );
      for (const r of rows) {
        const stages = safeParse(r.stages, []);
        const filtered = stages.filter((s) => s.name !== stage_name);
        if (filtered.length !== stages.length) {
          db2().runRaw(
            `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
            JSON.stringify(filtered),
            r.id
          );
        }
      }
      return success({ message: `已删除阶段「${stage_name}」` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("project-progress:scanFiles", (_e, payload) => {
    try {
      const { projectId, path: scanPath, stage_name } = payload;
      if (!fs.existsSync(scanPath)) return errorResponse("目录不存在: " + scanPath);
      const files = fs.readdirSync(scanPath).filter((f) => {
        try {
          return fs.statSync(path.join(scanPath, f)).isFile();
        } catch {
          return false;
        }
      });
      const rows = db2().allRaw(
        "SELECT * FROM project_progress WHERE subsidy_type_id = ?",
        projectId
      );
      let matched = 0;
      for (const r of rows) {
        const vname = String(r.village_name || "");
        const found = files.some((f) => {
          const basename = f.replace(/\.[^.]+$/, "");
          return basename.includes(vname) || vname.includes(basename);
        });
        if (found) {
          const stages = safeParse(r.stages, []);
          const idx = stages.findIndex((s) => s.name === stage_name);
          if (idx >= 0) {
            stages[idx] = { ...stages[idx], status: "done", date: (/* @__PURE__ */ new Date()).toISOString() };
            db2().runRaw(
              `UPDATE project_progress SET stages=?, updated_at=datetime('now','localtime') WHERE id=?`,
              JSON.stringify(stages),
              r.id
            );
            matched++;
          }
        }
      }
      return success({ message: `扫描完成：${files.length} 个文件，匹配 ${matched} 个村` });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
}
function safeParse(val, fallback) {
  try {
    return JSON.parse(val || "[]");
  } catch {
    return fallback;
  }
}
function formatGroupNoSimple(n) {
  const map = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (n >= 1 && n <= 10) return map[n] + "组";
  return n + "组";
}
function ensureTable() {
  const db2 = getDb();
  db2.runRaw(`
    CREATE TABLE IF NOT EXISTS village_contact (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      village_id INTEGER NOT NULL UNIQUE,
      village_name TEXT DEFAULT '',
      leader_name TEXT DEFAULT '',
      leader_phone TEXT DEFAULT '',
      leader_title TEXT DEFAULT '',
      contact_name TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
}
function registerVillageContactsHandlers() {
  ensureTable();
  electron.ipcMain.handle("village-contacts:list", () => {
    try {
      const rows = getDb().allRaw(
        "SELECT * FROM village_contact ORDER BY village_name"
      );
      return success(rows);
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("village-contacts:create", (_e, body) => {
    try {
      const { village_id, village_name, leader_name, leader_phone, leader_title, contact_name, contact_phone, remark } = body;
      const r = getDb().runRaw(
        `INSERT INTO village_contact (village_id, village_name, leader_name, leader_phone, leader_title, contact_name, contact_phone, remark) VALUES (?,?,?,?,?,?,?,?)`,
        village_id,
        village_name || "",
        leader_name || "",
        leader_phone || "",
        leader_title || "",
        contact_name || "",
        contact_phone || "",
        remark || ""
      );
      return success({ id: r.lastInsertRowid });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("village-contacts:update", (_e, payload) => {
    try {
      const { id, ...data } = payload;
      const keys = Object.keys(data).filter((k) => data[k] !== void 0 && k !== "id");
      if (keys.length === 0) return errorResponse("无更新数据");
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      const vals = keys.map((k) => data[k]);
      getDb().runRaw(`UPDATE village_contact SET ${sets}, updated_at=datetime('now','localtime') WHERE id=?`, ...vals, id);
      return success(null, "更新成功");
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("village-contacts:delete", (_e, id) => {
    try {
      getDb().runRaw("DELETE FROM village_contact WHERE id=?", id);
      return success({ message: "已删除" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("village-contacts:setLead", (_e, id) => {
    try {
      const c = getDb().getRaw("SELECT village_id FROM village_contact WHERE id=?", id);
      if (!c) return errorResponse("联系人不存在");
      getDb().runRaw("UPDATE village_contact SET leader_name='', leader_phone='', leader_title='' WHERE village_id=? AND id!=?", c.village_id, id);
      getDb().runRaw("UPDATE village_contact SET leader_name='负责人', leader_title='主要负责人' WHERE id=?", id);
      return success({ message: "已设为负责人" });
    } catch (e) {
      return errorResponse(String(e));
    }
  });
  electron.ipcMain.handle("village-contacts:import", (_e, payload) => {
    try {
      const { overwrite, filePath } = payload;
      if (!fs.existsSync(filePath)) return errorResponse("文件不存在");
      const XLSX = require("xlsx");
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      let created = 0, updated = 0;
      for (const row of rows) {
        const vname = row["村名"] || row["village_name"] || "";
        const vg = getDb().getRaw("SELECT id FROM village_group WHERE id=?", Number(row["village_id"]) || 0);
        const vid = vg?.id;
        if (!vid) continue;
        const exist = getDb().getRaw("SELECT id FROM village_contact WHERE village_id=?", vid);
        if (exist && overwrite) {
          getDb().runRaw(
            "UPDATE village_contact SET leader_name=?, leader_phone=?, updated_at=datetime('now','localtime') WHERE id=?",
            row["负责人"] || row["leader_name"] || "",
            row["电话"] || row["leader_phone"] || "",
            exist.id
          );
          updated++;
        } else if (!exist) {
          getDb().runRaw(
            "INSERT INTO village_contact (village_id, village_name, leader_name, leader_phone) VALUES (?,?,?,?)",
            vid,
            vname,
            row["负责人"] || "",
            row["电话"] || ""
          );
          created++;
        }
      }
      return success({ message: `导入完成：新增${created}，更新${updated}` });
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
  registerAuthHandlers();
  registerProjectProgressHandlers();
  registerVillageContactsHandlers();
}
function ensureAppUpdateYml() {
  try {
    const exeDir = path.dirname(electron.app.getPath("exe"));
    const ymlPath = path.join(exeDir, "resources", "app-update.yml");
    if (!fs.existsSync(ymlPath)) {
      const version = electron.app.getVersion();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const content = [
        `version: ${version}`,
        "files:",
        "  - url: SubsidySystem.exe",
        "    sha512: SKIP",
        "    size: 0",
        `path: SubsidySystem.exe`,
        "sha512: SKIP",
        `releaseDate: ${now}`
      ].join("\n");
      fs.writeFileSync(ymlPath, content, "utf-8");
      console.log("[App] Created app-update.yml at", ymlPath);
    }
  } catch (e) {
    console.error("[App] Failed to create app-update.yml:", e);
  }
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
  setUpdateWindow(mainWindow);
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
  ensureAppUpdateYml();
  await initDatabase();
  runMigrations();
  registerAllIpcHandlers();
  registerUpdateEvents();
  createWindow();
  setTimeout(() => {
    if (getAutoCheckUpdate()) checkForUpdatesSilent();
  }, 3e3);
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
