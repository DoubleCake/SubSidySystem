import { getDb } from './connection'

/**
 * 数据库自动迁移 — 创建表和索引
 * 使用 CREATE TABLE IF NOT EXISTS 确保幂等
 */
export function runMigrations(): void {
  const db = getDb()

  db.exec('PRAGMA foreign_keys = ON')

  // ═══════════════════════════════════════════
  //  创建所有表
  // ═══════════════════════════════════════════
  db.exec(`
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
  `)

  // ═══════════════════════════════════════════
  //  创建索引
  // ═══════════════════════════════════════════
  const indexes = [
    'CREATE INDEX IF NOT EXISTS ix_family_household_village_id ON family_household(village_id)',
    'CREATE INDEX IF NOT EXISTS ix_family_household_head_farmer ON family_household(head_farmer_id)',
    'CREATE INDEX IF NOT EXISTS ix_farmer_profile_household_id ON farmer_profile(household_id)',
    'CREATE INDEX IF NOT EXISTS ix_farmer_profile_id_card ON farmer_profile(id_card)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_application_farmer_year ON subsidy_application(farmer_id, apply_year)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_application_subsidy_type ON subsidy_application(subsidy_type_id)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_payment_farmer_year ON subsidy_payment(farmer_id, payment_year)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_payment_subsidy_type ON subsidy_payment(subsidy_type_id)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_application ON subsidy_proxy(application_id)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_payment ON subsidy_proxy(payment_id)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_beneficiary ON subsidy_proxy(beneficiary_farmer_id)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_proxy_proxy ON subsidy_proxy(proxy_farmer_id)',
    'CREATE INDEX IF NOT EXISTS ix_hh_area_cache_household ON household_area_usage_cache(household_id)',
    'CREATE INDEX IF NOT EXISTS ix_hh_area_cache_year ON household_area_usage_cache(year)',
    'CREATE INDEX IF NOT EXISTS ix_household_event_hh_year ON household_event(household_id, event_year)',
    'CREATE INDEX IF NOT EXISTS ix_village_group_village ON village_group(village_id)',
    'CREATE INDEX IF NOT EXISTS ix_agri_task_alloc_task ON agri_task_allocation(task_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_village_id ON large_farmer(village_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_status ON large_farmer(status)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_id_card ON large_farmer(id_card)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_grade ON large_farmer(farmer_grade)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_lf_id ON large_farmer_parcel(large_farmer_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_village_id ON large_farmer_parcel(village_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_high_std ON large_farmer_parcel(is_high_standard)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_demo ON large_farmer_parcel(is_demonstration)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_parcel_trust_id ON large_farmer_parcel(trust_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_lf_id ON large_farmer_trust(large_farmer_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_owner_id ON large_farmer_trust(owner_household_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_year ON large_farmer_trust(trust_year)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_land_trust ON large_farmer_trust(land_trust_id)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_end_date ON large_farmer_trust(end_date)',
    'CREATE INDEX IF NOT EXISTS ix_large_farmer_trust_parcel_village ON large_farmer_trust(parcel_village_id)',

    // 家庭户查询性能优化
    'CREATE INDEX IF NOT EXISTS ix_subsidy_application_beneficiary ON subsidy_application(beneficiary_id)',
    'CREATE INDEX IF NOT EXISTS ix_subsidy_application_beneficiary_year ON subsidy_application(beneficiary_id, apply_year)',
    'CREATE INDEX IF NOT EXISTS ix_family_household_confirmed ON family_household(is_manually_confirmed)',
    'CREATE INDEX IF NOT EXISTS ix_land_trust_owner_hh ON land_trust(owner_household_id)',
    'CREATE INDEX IF NOT EXISTS ix_land_trust_operator_hh ON land_trust(operator_household_id)',
  ]

  for (const idx of indexes) {
    db.exec(idx)
  }

  // ═══════════════════════════════════════════
  //  兼容旧数据库 — 逐列补充（ALTER TABLE ADD COLUMN）
  //  对应 Python main.py 中 migrate_db() 的全部增量迁移
  // ═══════════════════════════════════════════

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
    "ALTER TABLE large_farmer_trust ADD COLUMN reminder_sent SMALLINT DEFAULT 0",
  ]

  for (const stmt of alterStatements) {
    try { db.exec(stmt) } catch { /* 列已存在，忽略 */ }
  }
}
