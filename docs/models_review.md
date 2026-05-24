# models.py 数据库模型评审报告

## 当前表结构一览

| 表名 | 说明 | 核心关联 |
|------|------|----------|
| `village_group` | 村组字典表 | FK← family_household |
| `family_household` | 家庭户表 | FK→ village_group, 1:N→ farmer_profile |
| `farmer_profile` | 农户基础信息表 | FK→ family_household, 1:N→ subsidy_application |
| `subsidy_type` | 补贴类型表 | 1:N→ subsidy_application, 1:N→ subsidy_eligibility_rule |
| `subsidy_application` | 补贴申请记录表 | FK→ farmer_profile, FK→ subsidy_type |
| `audit_log` | 操作日志表 | 独立 |
| `subsidy_eligibility_rule` | 补贴资格规则表 | FK→ subsidy_type |
| `excel_column_template` | Excel列映射模板 | 独立 |
| `excel_import_log` | Excel导入日志 | 独立 |
| `land_trust` | 土地流转台账 | FK→ family_household (owner + operator) |
| `household_event` | 家庭户变更事件记录 | FK→ family_household |
| `error_library` | 错误库 | 游离，无村组FK |

---

## 待改进项清单

---


### [ ] #6 SubsidyEligibilityRule.exclusive_with 存 JSON 字符串

**位置**: `models.py` 第181行

**问题**:
```python
exclusive_with = Column(Text, nullable=True)  # JSON 数组存多个 subsidy_type_id
```

**影响**: 正常设计，但查询"某补贴不能和哪些补贴同享"需要解析 JSON。

**建议方案**: 当前可接受。如果需要高效查询，可新建 `SubsidyExclusionRule` 关联表。

---

