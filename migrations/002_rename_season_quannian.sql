-- 将 "全年单补" 重命名为 "耕地地力保护"
-- 影响范围：subsidy_type 和 household_area_usage_cache 表中的 season 字段

UPDATE subsidy_type SET season = '耕地地力保护' WHERE season = '全年单补';
UPDATE household_area_usage_cache SET season = '耕地地力保护' WHERE season = '全年单补';
