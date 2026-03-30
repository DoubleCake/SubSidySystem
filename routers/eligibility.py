"""
补贴资格规则路由
- CRUD 规则配置
- check_eligibility：给一批申请记录跑规则，返回通过/不通过/警告
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
import json
from datetime import date

from database import get_db
from models import SubsidyEligibilityRule, SubsidyType, FarmerProfile, FamilyHousehold
from utils import parse_id_card

router = APIRouter(prefix="/api/eligibility", tags=["资格规则"])


# ══════════════════════════════════════
#  规则 CRUD
# ══════════════════════════════════════

@router.get("/rules")
def list_rules(
    subsidy_type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(SubsidyEligibilityRule)
    if subsidy_type_id:
        q = q.filter(SubsidyEligibilityRule.subsidy_type_id == subsidy_type_id)
    rules = q.filter(SubsidyEligibilityRule.is_active == 1).all()
    return [_rule_out(r) for r in rules]


@router.post("/rules")
def create_rule(data: dict, db: Session = Depends(get_db)):
    rule = SubsidyEligibilityRule(**{
        k: v for k, v in data.items()
        if hasattr(SubsidyEligibilityRule, k) and k not in ('id', 'created_at', 'updated_at')
    })
    db.add(rule); db.commit(); db.refresh(rule)
    return {"id": rule.id, "message": "创建成功"}


@router.put("/rules/{rule_id}")
def update_rule(rule_id: int, data: dict, db: Session = Depends(get_db)):
    rule = db.get(SubsidyEligibilityRule, rule_id)
    if not rule: raise HTTPException(404, "规则不存在")
    for k, v in data.items():
        if hasattr(rule, k) and k not in ('id', 'created_at'):
            setattr(rule, k, v)
    db.commit()
    return {"message": "更新成功"}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(SubsidyEligibilityRule, rule_id)
    if not rule: raise HTTPException(404, "规则不存在")
    rule.is_active = 0; db.commit()
    return {"message": "已禁用"}


def _rule_out(r: SubsidyEligibilityRule) -> dict:
    return {
        "id": r.id, "subsidy_type_id": r.subsidy_type_id,
        "rule_name": r.rule_name, "rule_desc": r.rule_desc,
        "require_farmer_status": r.require_farmer_status,
        "require_age_min": r.require_age_min, "require_age_max": r.require_age_max,
        "require_land_type": r.require_land_type,
        "require_min_area": float(r.require_min_area) if r.require_min_area else None,
        "require_max_area": float(r.require_max_area) if r.require_max_area else None,
        "require_not_idle": r.require_not_idle,
        "require_contract_valid": r.require_contract_valid,
        "can_combine_with_others": r.can_combine_with_others,
        "exclusive_with": json.loads(r.exclusive_with) if r.exclusive_with else [],
        "is_active": r.is_active,
    }


# ══════════════════════════════════════
#  核心：资格批量检查引擎
# ══════════════════════════════════════

@router.post("/check")
def check_eligibility(payload: dict, db: Session = Depends(get_db)):
    """
    对一批候选记录跑资格规则检查。
    输入：{subsidy_type_id, year, rows: [{id_card, real_name, apply_area?, ...}]}
    输出：{passed:[], failed:[], warning:[]}
    """
    subsidy_type_id = payload.get("subsidy_type_id")
    year            = payload.get("year", date.today().year)
    rows            = payload.get("rows", [])

    if not subsidy_type_id:
        raise HTTPException(400, "缺少 subsidy_type_id")

    # 拉取该补贴的所有有效规则
    rules = db.query(SubsidyEligibilityRule).filter(
        SubsidyEligibilityRule.subsidy_type_id == subsidy_type_id,
        SubsidyEligibilityRule.is_active == 1,
    ).all()

    # 补贴项目信息
    st = db.get(SubsidyType, subsidy_type_id)

    passed, failed, warning = [], [], []

    for row in rows:
        id_card   = str(row.get("id_card", "")).strip()
        real_name = str(row.get("real_name", "")).strip()
        apply_area = row.get("apply_area")

        issues    = []   # 不通过的问题列表
        warns     = []   # 警告列表

        # 查找农户
        fp = db.query(FarmerProfile).filter(FarmerProfile.id_card == id_card).first()
        if not fp:
            # 找不到农户 - 警告（可能是新农户，需要创建）
            warns.append(f"身份证 {id_card[:6]}***{id_card[-4:]} 在系统中不存在，将自动创建")
            warning.append({**row, "id_card_masked": f"{id_card[:6]}***{id_card[-4:]}",
                            "warnings": warns, "issues": []})
            continue

        hh = db.get(FamilyHousehold, fp.household_id) if fp.household_id else None

        # 计算年龄（从身份证解析）
        age = None
        parsed = parse_id_card(fp.id_card)
        if parsed and parsed.get("birth_date"):
            ref = date(year, 12, 31)
            bd = parsed["birth_date"]
            age = ref.year - bd.year - (
                (ref.month, ref.day) < (bd.month, bd.day)
            )

        # 逐条规则检查
        for rule in rules:

            # 1. 农户状态检查
            if rule.require_farmer_status is not None:
                if fp.farmer_status != rule.require_farmer_status:
                    status_map = {1:"在册",2:"注销",3:"迁出",4:"死亡"}
                    actual = status_map.get(fp.farmer_status, str(fp.farmer_status))
                    required = status_map.get(rule.require_farmer_status, str(rule.require_farmer_status))
                    issues.append(f"【{rule.rule_name}】农户状态为「{actual}」，要求「{required}」")

            # 2. 年龄范围检查
            if rule.require_age_min is not None and age is not None:
                if age < rule.require_age_min:
                    issues.append(f"【{rule.rule_name}】年龄 {age} 岁，要求最小 {rule.require_age_min} 岁")
            if rule.require_age_max is not None and age is not None:
                if age > rule.require_age_max:
                    issues.append(f"【{rule.rule_name}】年龄 {age} 岁，要求最大 {rule.require_age_max} 岁")
            if (rule.require_age_min or rule.require_age_max) and age is None:
                warns.append(f"【{rule.rule_name}】规则要求年龄校验，但该农户无出生日期记录")

            # 3. 承包面积检查
            if rule.require_min_area is not None and hh:
                contracted = float(hh.contract_area or 0)
                check_area = float(apply_area or contracted)
                if check_area < float(rule.require_min_area):
                    issues.append(f"【{rule.rule_name}】申请面积 {check_area} 亩，要求最小 {rule.require_min_area} 亩")
            if rule.require_max_area is not None and apply_area:
                if float(apply_area) > float(rule.require_max_area):
                    issues.append(f"【{rule.rule_name}】申请面积 {apply_area} 亩，超过最大限额 {rule.require_max_area} 亩")

            # 4. 叠加检查（本年度是否已有互斥补贴）
            if rule.exclusive_with:
                try:
                    excl_ids = json.loads(rule.exclusive_with)
                    if excl_ids:
                        existing = db.execute(text("""
                            SELECT st.subsidy_name FROM subsidy_application sa
                            JOIN subsidy_type st ON sa.subsidy_type_id = st.id
                            WHERE sa.farmer_id = :fid AND sa.apply_year = :yr
                              AND sa.subsidy_type_id IN ({})
                            LIMIT 1
                        """.format(",".join(str(i) for i in excl_ids))),
                            {"fid": fp.id, "yr": year}).fetchone()
                        if existing:
                            issues.append(f"【{rule.rule_name}】本年度已领取「{existing[0]}」，两者不可叠加")
                except Exception:
                    pass

        # 检查是否重复申请（同人同年同补贴）
        dup = db.execute(text("""
            SELECT id FROM subsidy_application
            WHERE farmer_id=:fid AND subsidy_type_id=:stid AND apply_year=:yr LIMIT 1
        """), {"fid": fp.id, "stid": subsidy_type_id, "yr": year}).fetchone()
        if dup:
            warns.append(f"本年度已有申请记录（id={dup[0]}），导入将跳过")

        # 面积超领检查（按季节分组）
        if apply_area and apply_area > 0 and hh and hh.contract_area:
            contracted = float(hh.contract_area)
            season = st.season if st else "全年单补"

            if season == "全年单补":
                # 单独计算，不累加其他补贴
                if float(apply_area) > contracted:
                    issues.append(f"【超领】申请面积 {apply_area} 亩超出承包面积 {contracted:.2f} 亩")

            elif season in ("大春", "小春"):
                # 同季节求和
                used_season = db.execute(text("""
                    SELECT COALESCE(SUM(sa.apply_area), 0)
                    FROM subsidy_application sa
                    JOIN subsidy_type st ON sa.subsidy_type_id = st.id
                    WHERE sa.farmer_id = :fid AND sa.apply_year = :yr
                      AND st.season = :season
                      AND st.count_toward_area = 1
                      AND sa.pay_status != 3
                      AND sa.subsidy_type_id != :stid
                """), {"fid": fp.id, "yr": year, "season": season, "stid": subsidy_type_id}).scalar() or 0
                total_after = float(used_season) + float(apply_area)
                if total_after > contracted:
                    issues.append(f"【{season}超领】本季已用 {float(used_season):.2f} 亩 + 本次 {float(apply_area):.2f} 亩 = {total_after:.2f} 亩，超出承包面积 {contracted:.2f} 亩")

            elif season == "临时":
                # 双重检查：季节组 + 全年单补单独检查
                used_season = db.execute(text("""
                    SELECT COALESCE(SUM(sa.apply_area), 0)
                    FROM subsidy_application sa
                    JOIN subsidy_type st ON sa.subsidy_type_id = st.id
                    WHERE sa.farmer_id = :fid AND sa.apply_year = :yr
                      AND st.season IN ('大春', '小春')
                      AND st.count_toward_area = 1
                      AND sa.pay_status != 3
                """), {"fid": fp.id, "yr": year}).scalar() or 0
                total_season = float(used_season) + float(apply_area)
                if total_season > contracted:
                    issues.append(f"【临时-季节组超领】{season}组已用 {float(used_season):.2f} 亩 + 本次 {float(apply_area):.2f} 亩 = {total_season:.2f} 亩，超出承包面积 {contracted:.2f} 亩")
                if float(apply_area) > contracted:
                    issues.append(f"【临时-单独检查】申请面积 {apply_area} 亩超出承包面积 {contracted:.2f} 亩")

        item = {
            "id_card":        id_card,
            "id_card_masked": f"{id_card[:6]}***{id_card[-4:]}",
            "real_name":      fp.real_name,
            "farmer_id":      fp.id,
            "age":            age,
            "farmer_status":  fp.farmer_status,
            "apply_area":     apply_area,
            "issues":         issues,
            "warnings":       warns,
            **{k: v for k, v in row.items() if k not in ('id_card', 'real_name')},
        }

        if issues:
            failed.append(item)
        elif warns:
            warning.append(item)
        else:
            passed.append(item)

    return {
        "total":   len(rows),
        "passed":  len(passed),
        "failed":  len(failed),
        "warning": len(warning),
        "passed_list":  passed,
        "failed_list":  failed,
        "warning_list": warning,
        "rules_applied": len(rules),
    }


# ══════════════════════════════════════
#  预置规则模板（快速配置用）
# ══════════════════════════════════════

@router.get("/rule-templates")
def get_rule_templates():
    """返回常用规则的预置模板，方便快速创建"""
    return [
        {
            "name": "在册农户",
            "desc": "要求农户状态为在册（未注销/迁出/死亡）",
            "preset": {"rule_name": "在册状态检查", "require_farmer_status": 1}
        },
        {
            "name": "高龄补贴（80岁）",
            "desc": "要求申请人年龄不低于80周岁",
            "preset": {"rule_name": "高龄条件检查", "require_age_min": 80}
        },
        {
            "name": "面积下限",
            "desc": "要求申请面积不低于指定亩数",
            "preset": {"rule_name": "最小面积检查", "require_min_area": 0.1}
        },
        {
            "name": "大春作物补贴",
            "desc": "水稻、玉米、大豆等大春作物，面积受季节组总额管控",
            "preset": {"rule_name": "大春作物检查", "require_not_idle": 0}
        },
        {
            "name": "小春作物补贴",
            "desc": "小麦、油菜等小春作物，面积受季节组总额管控",
            "preset": {"rule_name": "小春作物检查", "require_not_idle": 0}
        },
        {
            "name": "耕地地力保护补贴",
            "desc": "全年单补类型，单独计算面积，不与季节组累加",
            "preset": {"rule_name": "耕地保护检查", "require_not_idle": 0}
        },
    ]
