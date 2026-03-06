from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import os

from database import get_db
from models import SubsidyApplication, FarmerProfile, FamilyHousehold, VillageGroup, SubsidyType
from schemas import AIAnalyzeRequest
from utils import desensitize_farmer

router = APIRouter(prefix="/api/ai", tags=["AI分析"])


def _build_analysis_data(year: int, village_name: str | None, db: Session) -> dict:
    """收集并脱敏，构造发给AI的数据包"""
    apps_q = db.query(SubsidyApplication).filter(SubsidyApplication.apply_year == year)

    if village_name:
        vg_ids = [v.id for v in db.query(VillageGroup)
                  .filter(VillageGroup.village_name == village_name).all()]
        hh_ids = [h.id for h in db.query(FamilyHousehold)
                  .filter(FamilyHousehold.village_group_id.in_(vg_ids)).all()]
        f_ids  = [f.id for f in db.query(FarmerProfile)
                  .filter(FarmerProfile.household_id.in_(hh_ids)).all()]
        apps_q = apps_q.filter(SubsidyApplication.farmer_id.in_(f_ids))

    apps = apps_q.all()
    prev_apps = db.query(SubsidyApplication).filter(
        SubsidyApplication.apply_year == year - 1
    ).all()

    # 脱敏农户信息
    farmer_cache = {}
    for a in apps + prev_apps:
        if a.farmer_id not in farmer_cache:
            f = db.get(FarmerProfile, a.farmer_id)
            if f:
                vg = db.get(VillageGroup, f.household.village_group_id) if f.household else None
                farmer_cache[a.farmer_id] = desensitize_farmer({
                    "id": f.id,
                    "name": f.real_name,
                    "gender": "男" if f.gender == 1 else "女",
                    "id_card": f.id_card,
                    "phone": f.phone or "",
                    "bank_card": f.bank_card or "",
                    "village": vg.full_name if vg else "",
                    "status": f.farmer_status,
                })

    def fmt_apps(app_list):
        return [
            {
                "farmer_name": farmer_cache.get(a.farmer_id, {}).get("name", "未知"),
                "farmer_id_masked": farmer_cache.get(a.farmer_id, {}).get("id_card", ""),
                "village": farmer_cache.get(a.farmer_id, {}).get("village", ""),
                "subsidy_name": a.subsidy_type.subsidy_name if a.subsidy_type else "",
                "apply_amount": float(a.apply_amount or 0),
                "actual_amount": float(a.actual_amount or 0),
                "pay_status": a.pay_status,
            }
            for a in app_list
        ]

    cur_farmers  = set(a.farmer_id for a in apps)
    prev_farmers = set(a.farmer_id for a in prev_apps)

    return {
        "year": year,
        "village_filter": village_name or "全部",
        "current_year_applications": fmt_apps(apps),
        "last_year_applications": fmt_apps(prev_apps),
        "statistics": {
            "current_farmer_count": len(cur_farmers),
            "last_farmer_count": len(prev_farmers),
            "new_farmer_count": len(cur_farmers - prev_farmers),
            "exit_farmer_count": len(prev_farmers - cur_farmers),
            "current_total_amount": round(sum(float(a.actual_amount or 0) for a in apps), 2),
            "last_total_amount": round(sum(float(a.actual_amount or 0) for a in prev_apps), 2),
        },
    }


@router.post("/analyze")
def ai_analyze(req: AIAnalyzeRequest, db: Session = Depends(get_db)):
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="未配置 ANTHROPIC_API_KEY 环境变量，请在 start.bat 中设置"
        )

    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=500, detail="请先 pip install anthropic")

    # 构造脱敏数据
    data = _build_analysis_data(req.year, req.village_name, db)

    prompt = f"""你是一位农村补贴管理专家助手。以下是{req.year}年度的补贴发放脱敏数据（所有身份证、手机号均已脱敏处理）：

```json
{__import__('json').dumps(data, ensure_ascii=False, indent=2)}
```

请根据以上数据回答：{req.question}

要求：
1. 用简洁的中文回答，分点列出
2. 重点关注：金额异常、新增/退出农户原因推断、与上年对比变化
3. 如有疑似异常数据请明确指出
4. 最后给出1-2条管理建议
"""

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    return {
        "result": message.content[0].text,
        "data_preview": {
            "year": data["year"],
            "statistics": data["statistics"],
            "record_count": len(data["current_year_applications"]),
        },
    }
