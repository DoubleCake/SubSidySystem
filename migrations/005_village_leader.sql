-- Village 表增加村负责人字段
ALTER TABLE village ADD COLUMN leader_name VARCHAR(30);
ALTER TABLE village ADD COLUMN leader_phone VARCHAR(20);
ALTER TABLE village_group ADD COLUMN leader_name VARCHAR(30);
ALTER TABLE village_group ADD COLUMN leader_phone VARCHAR(20);
