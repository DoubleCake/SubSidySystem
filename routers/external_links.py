"""
外联查询路由
功能：
  1. 管理外部网站链接（增删改查）
  2. 保存查询记录（批量查询 + 备注）
  3. 查询记录列表（分页、搜索、导出）
  
设计思路：
  外部网站分两类——
  A. 纯跳转类：点击直接打开网页（前端 iframe 或新标签页）
  B. 查询类：有身份证/姓名等查询字段，支持批量输入 + 记录留存
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, Text, DateTime, SmallInteger
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional
import json

from database import Base, get_db

router = APIRouter(prefix="/api/external", tags=["外联查询"])


# ─────────────────────────────────────
#  模型（在本文件内定义，轻量）
# ─────────────────────────────────────

class ExternalSite(Base):
    """外部网站配置表"""
    __tablename__ = "external_site"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    name         = Column(String(100), nullable=False, comment="网站名称")
    url          = Column(String(500), nullable=False, comment="网站地址")
    site_type    = Column(String(20), nullable=False, default="link",
                          comment="link=纯跳转 query=支持查询")
    query_field  = Column(String(50), nullable=True,
                          comment="查询字段名（身份证/姓名/手机号）")
    query_method = Column(String(10), nullable=True, default="GET",
                          comment="GET=URL参数 POST=表单提交")
    url_param    = Column(String(50), nullable=True,
                          comment="URL 查询参数名，如 ?id_card=xxx 中的 id_card")
    description  = Column(String(200), nullable=True)
    sort_order   = Column(Integer, nullable=False, default=0, comment="排序")
    is_active    = Column(SmallInteger, nullable=False, default=1)
    created_at   = Column(DateTime, default=func.now())


class QueryRecord(Base):
    """查询记录表"""
    __tablename__ = "query_record"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    site_id      = Column(Integer, nullable=True, comment="关联外部网站ID，手动记录可为空")
    site_name    = Column(String(100), nullable=False, default="手动记录")
    query_type   = Column(String(50), nullable=False, default="身份证查询",
                          comment="查询类型标签")
    query_input  = Column(Text, nullable=False, comment="查询的内容（可多个，JSON数组）")
    query_count  = Column(Integer, nullable=False, default=1, comment="本次查询数量")
    result_note  = Column(Text, nullable=True, comment="查询结果备注/说明")
    purpose      = Column(String(200), nullable=True, comment="查询目的")
    operator     = Column(String(50), nullable=False, default="操作员")
    tags         = Column(String(200), nullable=True, comment="标签，逗号分隔")
    created_at   = Column(DateTime, default=func.now())


# ─────────────────────────────────────
#  请求数据结构
# ─────────────────────────────────────

class SiteCreate(BaseModel):
    name: str
    url: str
    site_type: str = "link"
    query_field: Optional[str] = None
    query_method: Optional[str] = "GET"
    url_param: Optional[str] = None
    description: Optional[str] = None
    sort_order: int = 0


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    site_type: Optional[str] = None
    query_field: Optional[str] = None
    url_param: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[int] = None


class RecordCreate(BaseModel):
    site_id: Optional[int] = None
    site_name: str = "手动记录"
    query_type: str = "身份证查询"
    query_inputs: list[str]          # 查询的内容列表（支持批量）
    result_note: Optional[str] = None
    purpose: Optional[str] = None
    operator: str = "操作员"
    tags: Optional[str] = None       # 逗号分隔标签


class RecordUpdate(BaseModel):
    result_note: Optional[str] = None
    purpose: Optional[str] = None
    tags: Optional[str] = None


# ─────────────────────────────────────
#  建表（运行时自动创建）
# ─────────────────────────────────────

def ensure_tables(db: Session):
    """确保表存在（首次访问时调用）"""
    from database import engine
    Base.metadata.create_all(bind=engine, tables=[ExternalSite.__table__, QueryRecord.__table__])


# ─────────────────────────────────────
#  外部网站 CRUD
# ─────────────────────────────────────

@router.get("/sites")
def list_sites(db: Session = Depends(get_db)):
    """获取所有外部网站（按排序）"""
    ensure_tables(db)
    sites = db.query(ExternalSite).order_by(ExternalSite.sort_order, ExternalSite.id).all()
    return [
        {
            "id": s.id, "name": s.name, "url": s.url,
            "site_type": s.site_type, "query_field": s.query_field,
            "query_method": s.query_method, "url_param": s.url_param,
            "description": s.description, "sort_order": s.sort_order,
            "is_active": s.is_active,
        }
        for s in sites
    ]


@router.post("/sites")
def create_site(data: SiteCreate, db: Session = Depends(get_db)):
    ensure_tables(db)
    site = ExternalSite(**data.model_dump())
    db.add(site); db.commit(); db.refresh(site)
    return {"id": site.id, "message": "创建成功"}


@router.put("/sites/{site_id}")
def update_site(site_id: int, data: SiteUpdate, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    site = db.get(ExternalSite, site_id)
    if not site:
        raise HTTPException(404, "网站不存在")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(site, k, v)
    db.commit()
    return {"message": "更新成功"}


@router.delete("/sites/{site_id}")
def delete_site(site_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    site = db.get(ExternalSite, site_id)
    if not site:
        raise HTTPException(404, "网站不存在")
    db.delete(site); db.commit()
    return {"message": "已删除"}


# ─────────────────────────────────────
#  查询记录
# ─────────────────────────────────────

@router.post("/records")
def create_record(data: RecordCreate, db: Session = Depends(get_db)):
    """
    保存一次查询记录。
    支持批量输入（query_inputs 是列表），统一存为一条记录，
    前端可以把多个查询内容合并提交。
    """
    ensure_tables(db)
    record = QueryRecord(
        site_id=data.site_id,
        site_name=data.site_name,
        query_type=data.query_type,
        query_input=json.dumps(data.query_inputs, ensure_ascii=False),
        query_count=len(data.query_inputs),
        result_note=data.result_note,
        purpose=data.purpose,
        operator=data.operator,
        tags=data.tags,
    )
    db.add(record); db.commit(); db.refresh(record)
    return {"id": record.id, "message": f"已保存 {record.query_count} 条查询记录"}


@router.get("/records")
def list_records(
    site_id:    Optional[int] = Query(None),
    query_type: Optional[str] = Query(None),
    search:     Optional[str] = Query(None, description="搜索查询内容或备注"),
    tags:       Optional[str] = Query(None, description="按标签筛选"),
    date_from:  Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    date_to:    Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    page:       int           = Query(1, ge=1),
    page_size:  int           = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """查询记录列表，支持多维度筛选"""
    ensure_tables(db)
    q = db.query(QueryRecord)

    if site_id:    q = q.filter(QueryRecord.site_id == site_id)
    if query_type: q = q.filter(QueryRecord.query_type == query_type)
    if search:     q = q.filter(
        (QueryRecord.query_input.contains(search)) |
        (QueryRecord.result_note.contains(search)) |
        (QueryRecord.purpose.contains(search))
    )
    if tags:       q = q.filter(QueryRecord.tags.contains(tags))
    if date_from:  q = q.filter(QueryRecord.created_at >= date_from)
    if date_to:    q = q.filter(QueryRecord.created_at <= date_to + " 23:59:59")

    total = q.count()
    records = q.order_by(QueryRecord.created_at.desc()).offset((page-1)*page_size).limit(page_size).all()

    items = []
    for r in records:
        try:
            inputs = json.loads(r.query_input)
        except Exception:
            inputs = [r.query_input]
        items.append({
            "id": r.id, "site_id": r.site_id, "site_name": r.site_name,
            "query_type": r.query_type, "query_inputs": inputs,
            "query_count": r.query_count, "result_note": r.result_note,
            "purpose": r.purpose, "operator": r.operator,
            "tags": r.tags, "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.put("/records/{record_id}")
def update_record(record_id: int, data: RecordUpdate, db: Session = Depends(get_db)):
    """补充/修改查询记录的备注和标签"""
    from fastapi import HTTPException
    ensure_tables(db)
    record = db.get(QueryRecord, record_id)
    if not record:
        raise HTTPException(404, "记录不存在")
    if data.result_note is not None: record.result_note = data.result_note
    if data.purpose     is not None: record.purpose     = data.purpose
    if data.tags        is not None: record.tags        = data.tags
    db.commit()
    return {"message": "更新成功"}


@router.delete("/records/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    ensure_tables(db)
    record = db.get(QueryRecord, record_id)
    if not record:
        raise HTTPException(404, "记录不存在")
    db.delete(record); db.commit()
    return {"message": "已删除"}


@router.get("/records/stats")
def record_stats(db: Session = Depends(get_db)):
    """查询记录统计：按类型、按网站、按日期汇总，用于分析页"""
    ensure_tables(db)
    by_type = db.query(
        QueryRecord.query_type,
        func.count(QueryRecord.id).label("times"),
        func.sum(QueryRecord.query_count).label("total_items"),
    ).group_by(QueryRecord.query_type).all()

    by_site = db.query(
        QueryRecord.site_name,
        func.count(QueryRecord.id).label("times"),
    ).group_by(QueryRecord.site_name).order_by(func.count(QueryRecord.id).desc()).all()

    return {
        "total_records": db.query(func.count(QueryRecord.id)).scalar() or 0,
        "total_items": db.query(func.sum(QueryRecord.query_count)).scalar() or 0,
        "by_type": [{"type": r.query_type, "times": r.times, "total_items": r.total_items} for r in by_type],
        "by_site": [{"site": r.site_name, "times": r.times} for r in by_site],
    }
