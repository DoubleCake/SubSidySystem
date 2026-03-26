"""
Excel列映射模板路由
- 模板 CRUD
- 智能列名识别（模糊匹配）
- AI辅助列名识别
- 带模板的智能导入
- 导入日志查询
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
import json, hashlib, time
from datetime import datetime

from database import get_db
from models import ExcelColumnTemplate, ExcelImportLog

router = APIRouter(prefix="/api/excel-templates", tags=["Excel模板"])


# ── 系统字段定义（所有业务类型的可映射字段）──
SYSTEM_FIELDS = {
    "FARMER": [
        {"field": "real_name",    "label": "姓名",     "required": True,  "type": "string"},
        {"field": "id_card",      "label": "身份证号", "required": True,  "type": "id_card"},
        {"field": "phone",        "label": "手机号",   "required": False, "type": "phone"},
        {"field": "bank_card",    "label": "银行卡号", "required": False, "type": "string"},
        {"field": "bank_name",    "label": "开户行",   "required": False, "type": "string"},
        {"field": "village_name", "label": "所在村",   "required": True,  "type": "string"},
        {"field": "group_no",     "label": "所在组",   "required": True,  "type": "string"},
        {"field": "land_area",    "label": "土地面积", "required": False, "type": "decimal"},
        {"field": "address",      "label": "地址",     "required": False, "type": "string"},
        {"field": "farmer_status","label": "状态",     "required": False, "type": "status"},
    ],
    "SUBSIDY": [
        {"field": "id_card",       "label": "身份证号", "required": True,  "type": "id_card"},
        {"field": "real_name",     "label": "姓名",     "required": True,  "type": "string"},
        {"field": "actual_amount", "label": "发放金额", "required": False, "type": "decimal"},
        {"field": "apply_area",    "label": "种植面积", "required": False, "type": "decimal"},
        {"field": "contract_area", "label": "承包地面积", "required": False, "type": "decimal"},
        {"field": "trust_area",    "label": "代耕代种面积", "required": False, "type": "decimal"},
        {"field": "no_subsidy_area","label": "不予补贴面积", "required": False, "type": "decimal"},
        {"field": "bank_card",     "label": "银行卡号", "required": False, "type": "string"},
        {"field": "pay_date",      "label": "打款日期", "required": False, "type": "date"},
        {"field": "remark",        "label": "备注",     "required": False, "type": "string"},
        {"field": "village_name",  "label": "所在村",   "required": False, "type": "string"},
        {"field": "group_no",      "label": "所在组",   "required": False, "type": "string"},
    ],
    "PRECHECK": [
        {"field": "real_name",    "label": "姓名",     "required": True,  "type": "string"},
        {"field": "id_card",      "label": "身份证号", "required": True,  "type": "id_card"},
        {"field": "village_name", "label": "所在村",   "required": True,  "type": "string"},
        {"field": "group_no",     "label": "所在组",   "required": True,  "type": "string"},
        {"field": "gender",       "label": "性别",     "required": False, "type": "string"},
        {"field": "phone",        "label": "手机号",   "required": False, "type": "phone"},
        {"field": "land_area",    "label": "土地面积", "required": False, "type": "decimal"},
    ],
}

# 内置别名词典（每个系统字段的常见列名写法）
BUILTIN_ALIASES = {
    "real_name":     ["姓名", "姓名*", "户主姓名", "农户姓名", "名字", "姓 名", "户主名字", "申请人姓名"],
    "id_card":       ["身份证号", "身份证号*", "身份证", "证件号码", "居民身份证号", "身份证号码", "证件号", "ID号"],
    "phone":         ["手机号", "手机号*", "电话", "联系电话", "手机", "联系方式", "手机号码", "电话号码"],
    "bank_card":     ["银行卡号", "银行卡号*", "卡号", "账号", "银行账号", "打款账号", "收款账号", "银行卡"],
    "bank_name":     ["开户行", "开户行*", "银行", "开户银行", "开户网点", "银行名称"],
    "village_name":  ["所在村", "所在村*", "村名", "村庄", "村", "行政村", "所在行政村", "社区"],
    "group_no":      ["所在组", "所在组*", "组号", "组", "村组", "小组", "村民小组"],
    "land_area":     ["土地面积", "土地面积*", "实际种植面积", "面积", "承包面积", "土地面积（亩）", "耕地面积", "亩数", "承包面积(亩)"],
    "address":       ["地址", "地址*", "住址", "家庭住址", "详细地址"],
    "farmer_status": ["状态", "状态*", "农户状态", "在册状态"],
    "gender":        ["性别", "性 别"],
    "actual_amount": ["发放金额", "补贴金额", "实发金额", "金额", "应发金额", "补贴（元）",
                      "补贴金额（元）", "发放金额（元）", "发放额", "打款金额"],
    "apply_area":    ["种植面积", "申请面积", "补贴面积", "计补面积", "补贴面积（亩）",
                      "种植面积（亩）", "申请面积（亩）"],
    "pay_date":      ["打款日期", "发放日期", "付款日期", "拨付日期", "到账日期"],
    "remark":        ["备注", "说明", "备注信息"],
    "contract_area": ["承包地面积", "承包面积", "二轮承包面积", "承包地", "二轮承包地面积", "承包地面积(亩)", "承包面积(亩)"],
    "trust_area":    ["代耕代种面积", "代种面积", "托管面积", "代耕面积", "代耕代种面积(亩)", "代种面积(亩)", "代耕代种土地流转"],
    "no_subsidy_area": ["不予补贴面积", "不补面积", "不予补贴面积(亩)", "不补面积(亩)", "扣除面积"],
}


def fuzzy_match(col_name: str, business_type: str = "SUBSIDY") -> list[dict]:
    """模糊匹配列名，返回候选结果（含置信度）"""
    col_clean = col_name.strip().replace(" ", "").replace("（", "(").replace("）", ")")
    results = []

    for field, aliases in BUILTIN_ALIASES.items():
        # 精确匹配
        for alias in aliases:
            alias_clean = alias.replace("（","(").replace("）",")")
            if col_clean == alias_clean:
                results.append({"field": field, "confidence": 1.0, "match_type": "exact"})
                break
        else:
            # 包含匹配
            for alias in aliases:
                alias_clean = alias.replace("（","(").replace("）",")")
                if alias_clean in col_clean or col_clean in alias_clean:
                    ratio = len(alias_clean) / max(len(col_clean), len(alias_clean))
                    results.append({"field": field, "confidence": round(0.6 + ratio * 0.3, 2),
                                    "match_type": "contains"})
                    break

    # 去重取最高置信度
    best: dict[str, dict] = {}
    for r in results:
        f = r["field"]
        if f not in best or r["confidence"] > best[f]["confidence"]:
            best[f] = r

    return sorted(best.values(), key=lambda x: -x["confidence"])


# ══════════════════════════════════════
#  模板 CRUD
# ══════════════════════════════════════

@router.get("")
def list_templates(
    business_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(ExcelColumnTemplate).filter(ExcelColumnTemplate.is_active == 1)
    if business_type:
        q = q.filter(ExcelColumnTemplate.business_type == business_type)
    tmps = q.order_by(ExcelColumnTemplate.use_count.desc()).all()
    return [_tmpl_out(t) for t in tmps]


@router.get("/{tmpl_id}")
def get_template(tmpl_id: int, db: Session = Depends(get_db)):
    t = db.get(ExcelColumnTemplate, tmpl_id)
    if not t: raise HTTPException(404, "模板不存在")
    return _tmpl_out(t)


@router.post("")
def create_template(data: dict, db: Session = Depends(get_db)):
    # column_mapping 如果是 list 则 JSON 序列化
    cm = data.get("column_mapping", [])
    if isinstance(cm, list): cm = json.dumps(cm, ensure_ascii=False)
    sr = data.get("skip_rules")
    if isinstance(sr, list): sr = json.dumps(sr, ensure_ascii=False)
    vm = data.get("value_mapping")
    if isinstance(vm, dict): vm = json.dumps(vm, ensure_ascii=False)

    tmpl = ExcelColumnTemplate(
        template_name   = data.get("template_name", "未命名模板"),
        template_year   = data.get("template_year"),
        region_name     = data.get("region_name"),
        business_type   = data.get("business_type", "SUBSIDY"),
        subsidy_type_id = data.get("subsidy_type_id"),
        header_row      = data.get("header_row", 1),
        data_start_row  = data.get("data_start_row", 2),
        skip_footer_rows= data.get("skip_footer_rows", 0),
        column_mapping  = cm,
        skip_rules      = sr,
        value_mapping   = vm,
        created_by      = data.get("created_by", "操作员"),
    )
    db.add(tmpl); db.commit(); db.refresh(tmpl)
    return {"id": tmpl.id, "message": "模板创建成功"}


@router.put("/{tmpl_id}")
def update_template(tmpl_id: int, data: dict, db: Session = Depends(get_db)):
    tmpl = db.get(ExcelColumnTemplate, tmpl_id)
    if not tmpl: raise HTTPException(404, "模板不存在")
    for k, v in data.items():
        if not hasattr(tmpl, k): continue
        if k in ("column_mapping", "skip_rules") and isinstance(v, list):
            v = json.dumps(v, ensure_ascii=False)
        if k == "value_mapping" and isinstance(v, dict):
            v = json.dumps(v, ensure_ascii=False)
        if k not in ("id", "created_at"): setattr(tmpl, k, v)
    db.commit()
    return {"message": "更新成功"}


@router.delete("/{tmpl_id}")
def delete_template(tmpl_id: int, db: Session = Depends(get_db)):
    tmpl = db.get(ExcelColumnTemplate, tmpl_id)
    if not tmpl: raise HTTPException(404, "模板不存在")
    tmpl.is_active = 0; db.commit()
    return {"message": "已删除"}


def _tmpl_out(t: ExcelColumnTemplate) -> dict:
    return {
        "id": t.id, "template_name": t.template_name,
        "template_year": t.template_year, "region_name": t.region_name,
        "business_type": t.business_type, "subsidy_type_id": t.subsidy_type_id,
        "header_row": t.header_row, "data_start_row": t.data_start_row,
        "skip_footer_rows": t.skip_footer_rows,
        "column_mapping": json.loads(t.column_mapping) if t.column_mapping else [],
        "skip_rules": json.loads(t.skip_rules) if t.skip_rules else [],
        "value_mapping": json.loads(t.value_mapping) if t.value_mapping else {},
        "use_count": t.use_count,
        "last_used_at": str(t.last_used_at) if t.last_used_at else None,
        "created_at": str(t.created_at),
    }


# ══════════════════════════════════════
#  智能列名识别
# ══════════════════════════════════════

@router.post("/detect-columns")
def detect_columns(payload: dict, db: Session = Depends(get_db)):
    """
    输入：Excel 的列名列表 + 业务类型
    输出：每列的识别结果 + 推荐的已有模板
    """
    columns      = payload.get("columns", [])    # Excel 实际列名列表
    business_type = payload.get("business_type", "SUBSIDY")
    sample_rows  = payload.get("sample_rows", []) # 前3行数据示例

    result = []
    for col in columns:
        matches = fuzzy_match(col, business_type)
        best    = matches[0] if matches else None
        result.append({
            "excel_column": col,
            "suggested_field":      best["field"] if best else None,
            "suggested_confidence": best["confidence"] if best else 0,
            "match_type":           best["match_type"] if best else None,
            "alternatives":         matches[1:3],   # 备选
            "auto_confirm":         best["confidence"] >= 0.9 if best else False,
        })

    # 推荐已有模板（列名命中率 >= 60%）
    templates = db.query(ExcelColumnTemplate).filter(
        ExcelColumnTemplate.business_type == business_type,
        ExcelColumnTemplate.is_active == 1,
    ).order_by(ExcelColumnTemplate.use_count.desc()).limit(10).all()

    recommended = []
    for t in templates:
        try:
            mapping = json.loads(t.column_mapping)
            template_aliases = set()
            for m in mapping:
                template_aliases.update(a.lower() for a in m.get("aliases", []))
            hit = sum(1 for c in columns if any(c.lower() in a or a in c.lower()
                                                for a in template_aliases))
            match_rate = hit / max(len(columns), 1)
            if match_rate >= 0.4:
                recommended.append({
                    "id": t.id, "template_name": t.template_name,
                    "match_rate": round(match_rate, 2),
                    "use_count": t.use_count,
                })
        except Exception:
            pass

    recommended.sort(key=lambda x: (-x["match_rate"], -x["use_count"]))

    return {
        "columns": result,
        "recommended_templates": recommended[:3],
        "system_fields": SYSTEM_FIELDS.get(business_type, []),
        "auto_confirm_count": sum(1 for r in result if r["auto_confirm"]),
        "unrecognized_count": sum(1 for r in result if not r["suggested_field"]),
    }


@router.post("/ai-detect")
async def ai_detect_columns(payload: dict, db: Session = Depends(get_db)):
    """
    调用 AI 接口辅助识别列名（置信度低时使用）
    """
    import os
    import httpx

    columns      = payload.get("columns", [])
    sample_rows  = payload.get("sample_rows", [])
    business_type = payload.get("business_type", "SUBSIDY")

    system_fields_desc = "\n".join(
        f"- {f['field']}（{f['label']}）"
        for f in SYSTEM_FIELDS.get(business_type, [])
    )

    prompt = f"""你是一个农业补贴管理系统的数据分析助手。
请分析以下Excel列名，将每列映射到系统字段。

系统可用字段：
{system_fields_desc}

Excel列名：{json.dumps(columns, ensure_ascii=False)}

数据样例（前3行）：{json.dumps(sample_rows[:3], ensure_ascii=False)}

请返回JSON格式，每列一个对象：
[{{"excel_column":"列名","system_field":"字段名或null","confidence":0.95,"reason":"简短说明"}}]

只返回JSON，不要其他文字。"""

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        # 没有API Key时退化到规则匹配
        fallback = []
        for col in columns:
            matches = fuzzy_match(col, business_type)
            best = matches[0] if matches else None
            fallback.append({
                "excel_column": col,
                "system_field": best["field"] if best else None,
                "confidence": best["confidence"] if best else 0,
                "reason": "规则匹配（AI未配置）",
            })
        return {"results": fallback, "source": "rule_based"}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={"model": "claude-sonnet-4-6", "max_tokens": 1000,
                      "messages": [{"role": "user", "content": prompt}]},
            )
        data = resp.json()
        text = data["content"][0]["text"]
        # 提取 JSON
        import re
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            results = json.loads(match.group())
            return {"results": results, "source": "ai"}
    except Exception as e:
        pass

    # AI 失败时退化
    fallback = []
    for col in columns:
        matches = fuzzy_match(col, business_type)
        best = matches[0] if matches else None
        fallback.append({
            "excel_column": col,
            "system_field": best["field"] if best else None,
            "confidence": best["confidence"] if best else 0,
            "reason": "规则匹配（AI调用失败）",
        })
    return {"results": fallback, "source": "rule_based_fallback"}


# ══════════════════════════════════════
#  带模板的智能导入
# ══════════════════════════════════════

@router.post("/smart-import")
def smart_import(payload: dict, db: Session = Depends(get_db)):
    """
    使用列映射规则导入数据，并记录导入日志
    输入：{template_id?, column_mapping, rows(原始Excel行), business_type, subsidy_type_id?, year?}
    """
    from datetime import date as date_type

    template_id   = payload.get("template_id")
    raw_mapping   = payload.get("column_mapping", [])  # 前端确认后的映射
    raw_rows      = payload.get("rows", [])             # 原始Excel行（key=Excel列名）
    business_type = payload.get("business_type", "SUBSIDY")
    subsidy_type_id = payload.get("subsidy_type_id")
    year          = payload.get("year", date_type.today().year)
    file_name     = payload.get("file_name", "未知文件")
    file_hash     = payload.get("file_hash")
    operator      = payload.get("operator", "操作员")

    t0 = time.time()

    # 检查文件是否已导入过
    if file_hash:
        existing = db.execute(text(
            "SELECT id, file_name, created_at FROM excel_import_log WHERE file_hash=:h ORDER BY created_at DESC LIMIT 1"
        ), {"h": file_hash}).fetchone()
        if existing:
            return {"duplicate": True, "previous_import": dict(existing._mapping),
                    "message": f"该文件已于 {existing.created_at} 导入过，如需重新导入请忽略此提示"}

    # 构建列名→系统字段的映射字典
    col_to_field: dict[str, dict] = {}
    for m in raw_mapping:
        excel_col    = m.get("excel_column", "")
        system_field = m.get("system_field")
        transform    = m.get("transform", "")
        if excel_col and system_field:
            col_to_field[excel_col] = {"field": system_field, "transform": transform}

    # 值映射（状态翻译等）
    value_map: dict = {}
    if template_id:
        tmpl = db.get(ExcelColumnTemplate, template_id)
        if tmpl and tmpl.value_mapping:
            try: value_map = json.loads(tmpl.value_mapping)
            except: pass

    # 数据转换
    def apply_transform(val, transform: str):
        if val is None or val == "": return None
        if transform == "strip_spaces": return str(val).strip()
        if transform == "to_yuan" and val:
            try: return float(str(val).replace(",","").strip()) / 100
            except: return val
        return val

    def map_value(field: str, val):
        if field in value_map and str(val) in value_map[field]:
            return value_map[field][str(val)]
        return val

    # 转换所有行
    mapped_rows = []
    skip_rules = []
    if template_id:
        tmpl = db.get(ExcelColumnTemplate, template_id)
        if tmpl and tmpl.skip_rules:
            try: skip_rules = json.loads(tmpl.skip_rules)
            except: pass

    for raw_row in raw_rows:
        row: dict = {}
        skip = False

        for excel_col, target in col_to_field.items():
            val = raw_row.get(excel_col)
            val = apply_transform(val, target["transform"])
            val = map_value(target["field"], val)
            row[target["field"]] = val

        # 跳过规则
        for rule in skip_rules:
            f   = rule.get("field", "")
            cond = rule.get("condition", "")
            rv  = row.get(f, "")
            if cond == "is_empty" and (rv is None or str(rv).strip() == ""):
                skip = True; break
            if cond == "contains" and rule.get("value", "") in str(rv):
                skip = True; break
            if cond == "not_18_digits" and len(str(rv or "").strip()) != 18:
                skip = True; break

        if not skip:
            mapped_rows.append(row)

    # 根据业务类型分发给对应的导入逻辑
    if business_type == "SUBSIDY":
        from routers.subsidies import batch_import_applications
        result = batch_import_applications(
            {"rows": [{**r, "subsidy_type_id": subsidy_type_id, "apply_year": year,
                       "pay_status": 2} for r in mapped_rows]}, db
        )


# def _vg_to_village_and_group(db: Session, vg: VillageGroup) -> tuple[int, str]:
#     """将 VillageGroup 记录转换为 (village_id, group_no)"""
#     from models import Village
#     from utils import normalize_group_no
#     village = db.query(Village).filter(Village.village_name == vg.village_name).first()
#     if not village:
#         village = Village(village_name=vg.village_name)
#         db.add(village)
#         db.flush()
#     gno = normalize_group_no(vg.group_no)
#     return village.id, gno


#     if business_type == "FARMER":
#         from models import FarmerProfile, FamilyHousehold, VillageGroup, Village
#         from utils import normalize_group_no
#         from sqlalchemy import text as _text
#         created2, skipped2, errors2 = 0, 0, []
#         for row in mapped_rows:
#             ic = str(row.get('id_card', '')).strip()
#             nm = str(row.get('real_name', '')).strip()
#             if not ic or not nm: errors2.append(f'缺少身份证或姓名'); continue
#             if db.query(FarmerProfile).filter(FarmerProfile.id_card == ic).first():
#                 skipped2 += 1; continue
#             vn = str(row.get('village_name', '')).strip()
#             gn = str(row.get('group_no', '')).strip()
#             vg = db.query(VillageGroup).filter_by(village_name=vn, group_no=gn).first()
#             if not vg:
#                 vg = VillageGroup(village_name=vn or '未知村', group_no=gn or '一组', full_name=f'{vn}{gn}')
#                 db.add(vg); db.flush()
#             vid, gno = _vg_to_village_and_group(db, vg)
#             fp = FarmerProfile(household_id=0, real_name=nm, id_card=ic, gender=1,
#                                phone=row.get('phone'), bank_card=row.get('bank_card'),
#                                bank_name=row.get('bank_name'), is_head=1, farmer_status=1)
#             db.add(fp); db.flush()
#             hh = FamilyHousehold(household_code=f'HH{fp.id:05d}', household_name=f'{nm}户',
#                                  head_farmer_id=fp.id, village_id=vid, group_no=gno, status=1)
#             db.add(hh); db.flush(); fp.household_id = hh.id; created2 += 1
#         db.commit()
#         result = {'created': created2, 'skipped': skipped2, 'errors': errors2}
#     else:
#         result = {"created": 0, "skipped": 0, "errors": ["不支持的业务类型"]}

#     duration_ms = int((time.time() - t0) * 1000)

#     # 记录导入日志
#     log = ExcelImportLog(
#         template_id      = template_id,
#         template_name    = payload.get("template_name"),
#         file_name        = file_name,
#         file_hash        = file_hash,
#         business_type    = business_type,
#         region_name      = payload.get("region_name"),
#         import_year      = year,
#         total_rows       = len(raw_rows),
#         valid_rows       = len(mapped_rows),
#         created_count    = result.get("created", 0),
#         updated_count    = result.get("updated", 0),
#         skipped_count    = result.get("skipped", 0),
#         error_count      = len(result.get("errors", [])),
#         rule_failed_count = payload.get("rule_failed_count", 0),
#         error_detail     = json.dumps(result.get("errors", [])[:50], ensure_ascii=False),
#         column_mapping_used = json.dumps(raw_mapping, ensure_ascii=False),
#         operator         = operator,
#         import_duration_ms = duration_ms,
#     )
#     db.add(log); db.commit()

#     # 更新模板使用次数
#     if template_id:
#         db.execute(text("UPDATE excel_column_template SET use_count=use_count+1, last_used_at=CURRENT_TIMESTAMP WHERE id=:id"),
#                    {"id": template_id})
#         db.commit()

#     return {**result, "log_id": log.id, "duration_ms": duration_ms,
#             "valid_rows": len(mapped_rows), "skipped_by_rules": len(raw_rows) - len(mapped_rows)}


# ══════════════════════════════════════
#  导入日志
# ══════════════════════════════════════

@router.get("/logs")
def list_logs(
    business_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
    db: Session = Depends(get_db),
):
    q = db.execute(text("""
        SELECT id, template_name, file_name, business_type, region_name, import_year,
               total_rows, created_count, skipped_count, error_count, rule_failed_count,
               operator, import_duration_ms, created_at
        FROM excel_import_log
        """ + (f"WHERE business_type='{business_type}'" if business_type else "") + """
        ORDER BY created_at DESC
        LIMIT :lim OFFSET :off
    """), {"lim": page_size, "off": (page-1)*page_size}).fetchall()
    total = db.execute(text("SELECT COUNT(*) FROM excel_import_log")).scalar()
    return {"total": total, "items": [dict(r._mapping) for r in q]}


@router.get("/system-fields")
def get_system_fields(business_type: str = Query("SUBSIDY")):
    return SYSTEM_FIELDS.get(business_type, [])
