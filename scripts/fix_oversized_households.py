"""
修复：将异常合并的家庭户拆分为独立家庭户（每人独立成户）
适用场景：批量导入时因地址为空导致多人错误合并到同一户

用法：python scripts/fix_oversized_households.py
"""
import sys
sys.path.insert(0, '.')

from database import SessionLocal
from models import FamilyHousehold, FarmerProfile, HouseholdEvent
from utils import gen_household_code
from datetime import datetime

THRESHOLD = 10  # 超过此人数即视为异常户


def list_abnormal():
    """列出所有异常户"""
    db = SessionLocal()
    oversized = db.query(
        FamilyHousehold.id, FamilyHousehold.household_name
    ).filter(FamilyHousehold.status == 1).all()

    results = []
    for hh in oversized:
        cnt = db.query(FarmerProfile.id).filter(
            FarmerProfile.household_id == hh.id,
            FarmerProfile.farmer_status == 1,
        ).count()
        if cnt > THRESHOLD:
            results.append({"id": hh.id, "name": hh.household_name, "count": cnt})
    db.close()
    return results


def split_households(hh_ids: list[int]) -> dict:
    """
    对指定的异常户执行拆分，每人独立成户。
    原户保留第一个人，其余每人新建一个家庭户。
    """
    db = SessionLocal()
    now = datetime.now()
    total_split = 0
    total_created = 0

    for hh_id in hh_ids:
        hh = db.get(FamilyHousehold, hh_id)
        if not hh:
            print(f"  ID={hh_id} 不存在，跳过")
            continue

        members = db.query(FarmerProfile).filter(
            FarmerProfile.household_id == hh_id,
            FarmerProfile.farmer_status == 1,
        ).order_by(FarmerProfile.id).all()

        if len(members) <= 1:
            continue

        # 第一个人留守原户
        keep_member = members[0]
        split_members = members[1:]

        for m in split_members:
            # 生成唯一编码
            base_code = gen_household_code(m.id)
            code = base_code
            suffix = 1
            while db.query(FamilyHousehold.id).filter(
                FamilyHousehold.household_code == code
            ).first():
                code = f"{base_code}_{suffix}"
                suffix += 1

            new_hh = FamilyHousehold(
                household_code=code,
                household_name=f"{m.real_name}户",
                head_farmer_id=m.id,
                village_id=hh.village_id,
                group_no=hh.group_no or 1,
                registered_address=hh.registered_address,
                status=1,
            )
            db.add(new_hh)
            db.flush()
            total_created += 1

            m.household_id = new_hh.id
            m.relation = "本人"

            db.add(HouseholdEvent(
                household_id=new_hh.id,
                event_type="FOUND",
                event_year=now.year,
                description=f"批量拆分修复（原户{hh.household_name}拆分出）",
                operator="系统修复",
            ))
            db.add(HouseholdEvent(
                household_id=hh_id,
                event_type="MEMBER_REMOVE",
                farmer_id=m.id,
                farmer_name=m.real_name,
                event_year=now.year,
                description=f"拆分修复：{m.real_name} 迁出至新户 {new_hh.household_name}",
                operator="系统修复",
            ))
            total_split += 1

        # 更新原户户主
        hh.head_farmer_id = keep_member.id

        print(f"  {hh.household_name}(ID={hh_id}): 分出 {len(split_members)} 人，原户保留 1 人")

    db.commit()
    db.close()

    return {"split": total_split, "created": total_created}


if __name__ == "__main__":
    abnormal = list_abnormal()
    if not abnormal:
        print(f"没有超过 {THRESHOLD} 人的异常家庭户")
        sys.exit(0)

    print(f"发现 {len(abnormal)} 个异常户（超过 {THRESHOLD} 人）：")
    for a in abnormal:
        print(f"  ID={a['id']} | {a['name']} | {a['count']}人")

    print("\n即将对以上家庭户执行拆分：每人独立成户")
    print("确认执行？(yes/no): ", end="", flush=True)
    confirm = sys.stdin.readline().strip()
    if confirm != "yes":
        print("已取消")
        sys.exit(0)

    result = split_households([a["id"] for a in abnormal])
    print(f"\n完成！共拆分 {result['split']} 人，新建 {result['created']} 个家庭户")
