"""
异步后台任务

使用 FastAPI BackgroundTasks 将耗时操作（如缓存重算）放到响应之后执行，
减少接口等待时间。

使用方法：
  1. 在路由函数参数中声明 background_tasks: BackgroundTasks
  2. background_tasks.add_task(recalc_cache_task, db, household_ids)
  3. 注意：BackgroundTasks 不接受依赖注入的 db，需要在任务内创建新 session
"""

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from core.exceptions import AppException


def run_cache_recalculation(
    db_factory, household_ids: list[int]
) -> None:
    """
    后台运行面积缓存重算（使用独立的 db session）。
    由 BackgroundTasks.add_task 调用。

    用法：
        background_tasks.add_task(
            run_cache_recalculation,
            lambda: next(get_db()),
            [1, 2, 3],
        )
    """
    try:
        db: Session = db_factory()
        from services.subsidy_service import recalc_household_cache
        recalc_household_cache(db, household_ids)
        db.close()
    except Exception:
        pass  # 后台任务异常不影响主流程
