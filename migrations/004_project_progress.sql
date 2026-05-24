-- 补贴项目进度跟踪表
CREATE TABLE IF NOT EXISTS project_progress (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    subsidy_type_id INTEGER NOT NULL REFERENCES subsidy_type(id),
    village_id      INTEGER NOT NULL REFERENCES village(id),
    village_name    VARCHAR(50) NOT NULL,
    person_name     VARCHAR(30),
    phone           VARCHAR(20),
    stages          TEXT NOT NULL DEFAULT '[]',
    note            TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(subsidy_type_id, village_id)
);
CREATE INDEX IF NOT EXISTS ix_project_progress_project ON project_progress(subsidy_type_id);
CREATE INDEX IF NOT EXISTS ix_project_progress_village ON project_progress(village_id);
