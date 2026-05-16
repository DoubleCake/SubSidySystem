"""
统一响应格式工具
提供标准化的成功/错误响应包装函数。

使用约定：
  - 成功: return success(data={...})
  - 列表: return success_list(items=[...], total=100, page=1, page_size=20)
  - 错误: raise NotFound("农户不存在")

注意：现有接口保持向后兼容，新接口建议使用本工具。
"""

from fastapi.responses import JSONResponse


def success(data: object = None, message: str = "操作成功") -> dict:
    """标准成功响应"""
    return {"code": 0, "message": message, "data": data}


def success_list(
    items: list,
    total: int = None,
    page: int = None,
    page_size: int = None,
    message: str = "查询成功",
    **extra,
) -> dict:
    """分页列表响应"""
    result = {"code": 0, "message": message, "data": {"items": items}}
    if total is not None:
        result["data"]["total"] = total
    if page is not None:
        result["data"]["page"] = page
    if page_size is not None:
        result["data"]["page_size"] = page_size
    if extra:
        result["data"].update(extra)
    return result


def error_response(code: int, message: str, detail: object = None) -> JSONResponse:
    """标准错误响应（FastAPI JSONResponse，用于全局异常处理器）"""
    content = {"code": code, "message": message}
    if detail is not None:
        content["detail"] = detail
    return JSONResponse(status_code=code, content=content)


def paginated_query(
    db, query, page: int = 1, page_size: int = 20, order_by=None
) -> tuple[list, int]:
    """通用分页查询辅助"""
    total = query.count()
    if order_by is not None:
        query = query.order_by(order_by)
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return items, total
