-- 性能优化：补全高频查询索引

-- land_trust 表（当前无任何索引）
CREATE INDEX IF NOT EXISTS ix_land_trust_owner_year ON land_trust(owner_household_id, trust_year, is_active);
CREATE INDEX IF NOT EXISTS ix_land_trust_operator_year ON land_trust(operator_household_id, trust_year, is_active);
CREATE INDEX IF NOT EXISTS ix_land_trust_year_active ON land_trust(trust_year, is_active);
CREATE INDEX IF NOT EXISTS ix_land_trust_type_year ON land_trust(trust_type, trust_year, is_active);

-- subsidy_application 补贴类型+年度维度查询
CREATE INDEX IF NOT EXISTS ix_subsidy_app_type_year ON subsidy_application(subsidy_type_id, apply_year);
