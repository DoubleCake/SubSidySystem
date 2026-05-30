"""
数据迁移：为旧数据填充 apply_area_no_calc 默认值

背景：
  - 新字段 apply_area_no_calc 添加后，新导入的数据已有值
  - 旧数据的 apply_area_no_calc 为 NULL，但 apply_area 包含的是完整的补贴面积
  - 由于无法自动判断旧数据中多少面积应计入不计超限，因此将 NULL 设为 0
  - （旧数据的 apply_area 全部视为计入超限面积）

执行内容：
  1. SubsidyApplication: UPDATE apply_area_no_calc = 0 WHERE apply_area_no_calc IS NULL
  2. SubsidyPayment:    UPDATE apply_area_no_calc = 0 WHERE apply_area_no_calc IS NULL
  3. 重新计算所有家庭户的面积缓存
"""

import sys
import os

# 将项目根目录加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import SessionLocal
from models import SubsidyApplication, SubsidyPayment
from sqlalchemy import func, update


def main():
    db = SessionLocal()
    try:
        # ---------- 1. SubsidyApplication ----------
        app_null = db.query(func.count(SubsidyApplication.id)).filter(
            SubsidyApplication.apply_area_no_calc.is_(None)
        ).scalar()
        print(f"[SubsidyApplication] 待修复: {app_null} 条 (apply_area_no_calc IS NULL)")

        if app_null > 0:
            db.execute(
                update(SubsidyApplication).where(
                    SubsidyApplication.apply_area_no_calc.is_(None)
                ).values(apply_area_no_calc=0)
            )
            db.commit()
            print(f"  → 已更新 {app_null} 条，设置 apply_area_no_calc = 0")

        # 验证
        app_remaining = db.query(func.count(SubsidyApplication.id)).filter(
            SubsidyApplication.apply_area_no_calc.is_(None)
        ).scalar()
        print(f"  → 剩余 NULL: {app_remaining} 条")

        # ---------- 2. SubsidyPayment ----------
        pay_null = db.query(func.count(SubsidyPayment.id)).filter(
            SubsidyPayment.apply_area_no_calc.is_(None)
        ).scalar()
        print(f"\n[SubsidyPayment] 待修复: {pay_null} 条 (apply_area_no_calc IS NULL)")

        if pay_null > 0:
            db.execute(
                update(SubsidyPayment).where(
                    SubsidyPayment.apply_area_no_calc.is_(None)
                ).values(apply_area_no_calc=0)
            )
            db.commit()
            print(f"  → 已更新 {pay_null} 条，设置 apply_area_no_calc = 0")

        pay_remaining = db.query(func.count(SubsidyPayment.id)).filter(
            SubsidyPayment.apply_area_no_calc.is_(None)
        ).scalar()
        print(f"  → 剩余 NULL: {pay_remaining} 条")

        # ---------- 3. 重新计算面积缓存 ----------
        print("\n[缓存] 重新计算所有家庭户面积缓存...")
        from services.household_service import recalc_all_household_caches
        count = recalc_all_household_caches(db)
        print(f"  → 已重新计算 {count} 个家庭户的缓存")

        print("\n✅ 迁移完成")
    finally:
        db.close()


if __name__ == "__main__":
    main()
