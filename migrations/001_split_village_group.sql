-- ============================================================
-- 迁移脚本：将 village_group 表拆分为 village 表
-- FamilyHousehold 直接存储 group_no 字符串（无 Group 表）
-- FamilyHousehold 通过 village_id → Village 关联
-- 执行时间：2026-03-26
-- ============================================================

-- ── 1. 创建 village 表（假设 SQLAlchemy 已通过 create_all() 创建，或手动执行）──
-- CREATE TABLE IF NOT EXISTS village (
--     id INTEGER PRIMARY KEY AUTOINCREMENT,
--     village_name VARCHAR(50) NOT NULL UNIQUE,
--     created_at DATETIME
-- );

-- ── 2. 插入去重的村名到 village 表 ──────────────────────────
INSERT INTO village (village_name)
SELECT DISTINCT village_name
FROM village_group
WHERE village_name IS NOT NULL AND village_name != ''
  AND NOT EXISTS (SELECT 1 FROM village WHERE village.village_name = village_group.village_name);

-- ── 3. 更新 family_household 的 village_id ─────────────────
-- 通过 village_group 表的 village_name 找 village.id
UPDATE family_household hh
SET hh.village_id = (
    SELECT v.id FROM village v
    WHERE v.village_name = (
        SELECT vg.village_name FROM village_group vg WHERE vg.id = hh.village_group_id
    )
    LIMIT 1
)
WHERE hh.village_group_id IS NOT NULL
  AND (hh.village_id IS NULL OR hh.village_id = 0);

-- ── 4. 更新 family_household 的 group_no ────────────────────
-- 直接使用 village_group.group_no，无需查找中间表
-- 注意：group_no 直接存储字符串（如"一组"、"二组"），不需要做数字转换
-- （normalize_group_no 在应用层处理导入时的"1"→"一组"转换）
UPDATE family_household hh
SET hh.group_no = (
    SELECT normalize_group_no(vg.group_no) FROM village_group vg WHERE vg.id = hh.village_group_id
)
WHERE hh.village_group_id IS NOT NULL
  AND (hh.group_no IS NULL OR hh.group_no = '');

-- ── 5. 验证迁移结果 ────────────────────────────────────────
-- SELECT COUNT(*) AS orphan_hh FROM family_household
-- WHERE village_id IS NULL OR village_id = 0 OR group_no IS NULL OR group_no = '';

-- SELECT COUNT(*) AS village_count FROM village;
-- SELECT COUNT(*) AS hh_with_village FROM family_household WHERE village_id IS NOT NULL AND village_id > 0;

-- ── 6. 可选：清理 family_household 的 village_group_id 列 ───
-- SQLite 不支持 DROP COLUMN，如需清理需重建表：
-- ALTER TABLE family_household RENAME TO family_household_old;
-- （重新 create_all 再从 old 表迁移数据）

-- ============================================================
-- 注意：
-- - village_group 表保留不做任何修改（兼容保留）
-- - 无 Group 表，group_no 直接存储在 FamilyHousehold 中
-- - 如需查询"某村下有哪些组"：
--   SELECT DISTINCT group_no FROM family_household WHERE village_id = :village_id
-- ============================================================
