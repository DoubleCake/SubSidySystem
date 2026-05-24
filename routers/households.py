"""
家庭户管理路由（HTTP 编排层）
业务逻辑在 services/household_service.py 中实现
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from services import household_service
from schemas import HouseholdManualConfirm, HouseholdBatchConfirm


router = APIRouter(prefix="/api/households", tags=["家庭户管理"])


# ─────────────────────────────────────
#  请求数据结构
# ─────────────────────────────────────

class HouseholdUpdate(BaseModel):
    household_name: Optional[str] = None
    contract_area: Optional[float] = None
    confirmed_area: Optional[float] = None
    village_id: Optional[int] = None
    group_no: Optional[int] = None
    address: Optional[str] = None
    status: Optional[int] = None
    remark: Optional[str] = None


class MemberMoveRequest(BaseModel):
    farmer_id: int
    target_household_id: int
    relation: Optional[str] = "成员"
    is_head: Optional[int] = 0


class MemberCreate(BaseModel):
    real_name: str
    id_card: str
    gender: Optional[int] = None
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    relation: Optional[str] = "成员"
    is_head: Optional[int] = 0
    farmer_status: Optional[int] = 1
    remark: Optional[str] = None


class MemberUpdate(BaseModel):
    real_name: Optional[str] = None
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    relation: Optional[str] = None
    is_head: Optional[int] = None
    farmer_status: Optional[int] = None
    remark: Optional[str] = None
    event_date: Optional[str] = None
    village_id: Optional[int] = None
    group_no: Optional[int] = None


class ConfirmedAreaRow(BaseModel):
    real_name: str
    id_card: str
    confirmed_area: float


class ConfirmedAreaImportRequest(BaseModel):
    rows: list[ConfirmedAreaRow]


class HouseholdBuildRow(BaseModel):
    household_id: str
    id_card: str
    real_name: Optional[str] = None
    is_head: Optional[int] = 0
    relation: Optional[str] = "成员"
    contract_area: Optional[float] = None
    village_name: Optional[str] = None
    group_no: Optional[str] = None
    phone: Optional[str] = None
    bank_card: Optional[str] = None
    bank_name: Optional[str] = None
    farmer_status: Optional[int] = 1
    gender: Optional[int] = None
    address: Optional[str] = None


class HouseholdBuildRequest(BaseModel):
    rows: list[HouseholdBuildRow]


class HouseholdMergeRequest(BaseModel):
    source_household_id: int
    target_household_id: int
    operator: Optional[str] = None


# ─────────────────────────────────────
#  村组下拉选项
# ─────────────────────────────────────

@router.get("/group-options")
def list_group_options(db: Session = Depends(get_db)):
    return household_service.list_group_options(db)


# ─────────────────────────────────────
#  家庭户列表
# ─────────────────────────────────────

@router.get("")
def list_households(
    village_name:  Optional[str] = Query(None),
    status:        Optional[int] = Query(1, description="家庭户状态：1在册 2注销 3迁出，默认仅显示在册"),
    overdrawn_only: bool         = Query(False, description="只显示超领家庭"),
    confirmed_only: Optional[int] = Query(None, description="只显示已确认/未确认的家庭户"),
    search:        Optional[str] = Query(None, description="搜索户名/户主姓名"),
    year:          Optional[int] = Query(None, description="指定年度计算面积占用"),
    min_app_count: Optional[int] = Query(None, description="最少补贴记录数"),
    page:          int           = Query(1, ge=1),
    page_size:     int           = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    return household_service.list_households(
        db, village_name=village_name, status=status,
        overdrawn_only=overdrawn_only, confirmed_only=confirmed_only,
        search=search, year=year, min_app_count=min_app_count,
        page=page, page_size=page_size,
    )


# ─────────────────────────────────────
#  超领预警列表
# ─────────────────────────────────────

@router.get("/alert/overdrawn")
def list_overdrawn_households(
    year: Optional[int] = Query(None, description="指定年度，不传则取最近有补贴的年度"),
    village_name: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    return household_service.list_overdrawn_households(db, year, village_name)


# ─────────────────────────────────────
#  创建家庭户
# ─────────────────────────────────────

from schemas import HouseholdCreate as HouseholdCreateSchema


@router.post("")
def create_household(data: HouseholdCreateSchema, db: Session = Depends(get_db)):
    return household_service.create_household(db, data.model_dump())


class QuickCreateSchema(BaseModel):
    real_name: str
    id_card: str
    village_name: str = ""
    group_no: str = ""


@router.post("/quick-create")
def quick_create(data: QuickCreateSchema, db: Session = Depends(get_db)):
    """快速创建家庭户+农户，用于流转等场景中查不到时快速新建"""
    return household_service.quick_create_household(db, data.real_name, data.id_card, data.village_name, data.group_no)


# ─────────────────────────────────────
#  家庭户详情
# ─────────────────────────────────────

@router.get("/{household_id}")
def get_household(
    household_id: int,
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    return household_service.get_household(db, household_id, year)


# ─────────────────────────────────────
#  更新家庭户
# ─────────────────────────────────────

@router.put("/{household_id}")
def update_household(
    household_id: int,
    data: HouseholdUpdate,
    db: Session = Depends(get_db)
):
    return household_service.update_household(db, household_id, data.model_dump())


# ─────────────────────────────────────
#  删除家庭户
# ─────────────────────────────────────

@router.delete("/{household_id}")
def delete_household(household_id: int, db: Session = Depends(get_db)):
    return household_service.delete_household(db, household_id)


# ─────────────────────────────────────
#  成员管理
# ─────────────────────────────────────

@router.get("/{household_id}/members")
def list_members(household_id: int, db: Session = Depends(get_db)):
    return household_service.list_members(db, household_id)


@router.post("/{household_id}/members")
def add_member(household_id: int, data: MemberCreate, db: Session = Depends(get_db)):
    return household_service.add_member(db, household_id, data.model_dump())


@router.put("/{household_id}/members/{farmer_id}")
def update_member(household_id: int, farmer_id: int, data: MemberUpdate, db: Session = Depends(get_db)):
    return household_service.update_member(db, household_id, farmer_id, data.model_dump())


@router.delete("/{household_id}/members/{farmer_id}")
def remove_member(
    household_id: int,
    farmer_id: int,
    action: str = Query("detach", description="detach=迁出, delete=彻底删除（需无补贴记录）"),
    db: Session = Depends(get_db)
):
    return household_service.remove_member(db, household_id, farmer_id, action)


@router.post("/member/move")
def move_member(req: MemberMoveRequest, db: Session = Depends(get_db)):
    return household_service.move_member(db, req.farmer_id, req.target_household_id, req.relation, req.is_head)


@router.post("/{household_id}/members/batch-import")
def batch_import_members(household_id: int, payload: dict, db: Session = Depends(get_db)):
    rows = payload.get("rows", [])
    year = int(payload.get("year", __import__('datetime').date.today().year))
    operator = payload.get("operator", "批量导入")
    return household_service.batch_import_members(db, household_id, rows, year, operator)


# ─────────────────────────────────────
#  面积缓存管理
# ─────────────────────────────────────

@router.post("/recalc-cache")
def recalc_all_caches(db: Session = Depends(get_db)):
    count = household_service.recalc_all_household_caches(db)
    return {"message": f"已重新计算 {count} 个家庭户的面积缓存"}


@router.post("/{household_id}/recalc-cache")
def recalc_single_household_cache(household_id: int, db: Session = Depends(get_db)):
    household_service.recalc_household_area_cache(household_id, db)
    return {"message": f"已重新计算家庭户 {household_id} 的面积缓存"}


# ─────────────────────────────────────
#  历年面积占用
# ─────────────────────────────────────

@router.get("/{household_id}/area-by-year")
def get_area_by_year(household_id: int, db: Session = Depends(get_db)):
    return household_service.get_area_by_year(db, household_id)


# ─────────────────────────────────────
#  批量组建家庭户
# ─────────────────────────────────────

@router.post("/batch-build")
def batch_build_households(req: HouseholdBuildRequest, db: Session = Depends(get_db)):
    return household_service.batch_build_households(db, [r.model_dump() for r in req.rows])


# ─────────────────────────────────────
#  分户 / 合户
# ─────────────────────────────────────

@router.post("/{household_id}/split")
def split_household(household_id: int, data: dict, db: Session = Depends(get_db)):
    return household_service.split_household(db, household_id, data)


@router.post("/merge")
def merge_households(req: HouseholdMergeRequest, db: Session = Depends(get_db)):
    return household_service.merge_households(db, req.source_household_id, req.target_household_id, req.operator)


# ─────────────────────────────────────
#  确权面积导入 / 导出
# ─────────────────────────────────────

@router.post("/import-confirmed-area")
def import_confirmed_area(req: ConfirmedAreaImportRequest, db: Session = Depends(get_db)):
    return household_service.import_confirmed_area(db, [r.model_dump() for r in req.rows])


@router.get("/export-confirmed-area-diff")
def export_confirmed_area_diff_endpoint(db: Session = Depends(get_db)):
    """导出全部家庭户的确权面积与承包面积对比 Excel"""
    from fastapi.responses import StreamingResponse
    from export_utils import export_confirmed_area_diff

    data = household_service.export_confirmed_area_diff_data(db)
    output = export_confirmed_area_diff(data)
    headers = {"Content-Disposition": "attachment; filename*=UTF-8''%E7%A1%AE%E6%9D%83%E9%9D%A2%E7%A7%AF%E5%AF%B9%E6%AF%94.xlsx"}
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)


# ─────────────────────────────────────
#  人工确认 / 取消确认 / 批量确认
# ─────────────────────────────────────

@router.post("/{household_id}/manual-confirm")
def manual_confirm_household(
    household_id: int,
    req: HouseholdManualConfirm,
    db: Session = Depends(get_db)
):
    return household_service.manual_confirm(db, household_id, req.operator, req.remark)


@router.post("/{household_id}/cancel-confirm")
def cancel_manual_confirm(
    household_id: int,
    req: HouseholdManualConfirm,
    db: Session = Depends(get_db)
):
    return household_service.cancel_confirm(db, household_id, req.operator, req.remark)


@router.post("/batch-confirm")
def batch_confirm_households(
    req: HouseholdBatchConfirm,
    db: Session = Depends(get_db)
):
    if not req.household_ids:
        raise HTTPException(400, "未提供要确认的家庭户ID列表")
    return household_service.batch_confirm(db, req.household_ids, req.operator, req.remark)


# ─────────────────────────────────────
#  事件 / 历史快照
# ─────────────────────────────────────

@router.get("/{household_id}/events")
def list_events(
    household_id: int,
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50),
):
    return household_service.list_events(db, household_id, page, page_size)


@router.post("/{household_id}/events")
def add_event(household_id: int, data: dict, db: Session = Depends(get_db)):
    return household_service.add_event(db, household_id, data)


@router.delete("/{household_id}/events/{event_id}")
def undo_event(household_id: int, event_id: int, db: Session = Depends(get_db)):
    return household_service.undo_event(db, household_id, event_id)


@router.get("/{household_id}/history-dates")
def get_history_dates(household_id: int, db: Session = Depends(get_db)):
    return household_service.get_history_dates(db, household_id)


@router.get("/{household_id}/history-years")
def get_history_years(household_id: int, db: Session = Depends(get_db)):
    return household_service.get_history_years(db, household_id)


@router.get("/{household_id}/history/{year}")
def get_history_snapshot(household_id: int, year: int, db: Session = Depends(get_db)):
    return household_service.get_history_snapshot(db, household_id, year)


@router.get("/{household_id}/snapshot-at/{date}")
def get_snapshot_at_date(household_id: int, date: str, db: Session = Depends(get_db)):
    return household_service.get_snapshot_at_date(db, household_id, date)


@router.get("/{household_id}/snapshot-by-event/{event_id}")
def get_snapshot_by_event(household_id: int, event_id: int, db: Session = Depends(get_db)):
    return household_service.get_snapshot_by_event(db, household_id, event_id)


# ─────────────────────────────────────
#  刷新缓存（批量/单个）
# ─────────────────────────────────────

@router.post("/refresh-cache")
def refresh_area_cache(
    household_id: Optional[int] = Query(None, description="指定家庭户ID，不传则刷新所有"),
    db: Session = Depends(get_db)
):
    if household_id:
        from models import FamilyHousehold
        hh = db.query(FamilyHousehold).filter(FamilyHousehold.id == household_id).first()
        if not hh:
            raise HTTPException(404, "家庭户不存在")
        household_service.recalc_household_area_cache(household_id, db)
        return {
            "message": f"已刷新家庭户 {hh.household_name} 的面积缓存",
            "household_id": household_id,
            "household_name": hh.household_name,
        }
    else:
        count = household_service.recalc_all_household_caches(db)
        return {"message": f"已刷新全部 {count} 个家庭户的面积缓存", "total": count}


# ─────────────────────────────────────
#  重新计算未确认家庭户承包地面积
# ─────────────────────────────────────

@router.post("/recalc-unconfirmed-contract-area")
def recalc_unconfirmed_contract_area(db: Session = Depends(get_db)):
    return household_service.recalc_unconfirmed_contract_area(db)
