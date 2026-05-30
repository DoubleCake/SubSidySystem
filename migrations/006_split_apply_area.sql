-- 补贴申请表：新增不计入超限计算的补贴面积字段
ALTER TABLE subsidy_application ADD COLUMN apply_area_no_calc DECIMAL(10, 2) DEFAULT NULL COMMENT '不计入超限计算的补贴面积(亩)';

-- 补贴发放表：新增不计入超限计算的补贴面积字段
ALTER TABLE subsidy_payment ADD COLUMN apply_area_no_calc DECIMAL(10, 2) DEFAULT NULL COMMENT '不计入超限计算的补贴面积(亩)';
