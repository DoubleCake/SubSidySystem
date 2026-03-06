"""
初始化模拟数据脚本
运行方式：python seed_data.py
"""
from database import engine, SessionLocal
from models import Base, VillageGroup, FamilyHousehold, FarmerProfile, SubsidyType, SubsidyApplication
from utils import parse_id_card, gen_household_code
from datetime import date

def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if db.query(FarmerProfile).count() > 0:
        print("数据库已有数据，跳过初始化")
        db.close()
        return

    print("开始写入模拟数据...")

    # ── 村组 ──
    vgs = [
        VillageGroup(village_name="红星村", group_no="一组", full_name="红星村一组"),
        VillageGroup(village_name="红星村", group_no="二组", full_name="红星村二组"),
        VillageGroup(village_name="红星村", group_no="三组", full_name="红星村三组"),
        VillageGroup(village_name="光明村", group_no="一组", full_name="光明村一组"),
        VillageGroup(village_name="光明村", group_no="二组", full_name="光明村二组"),
        VillageGroup(village_name="和平村", group_no="一组", full_name="和平村一组"),
    ]
    db.add_all(vgs)
    db.flush()
    vg = {v.full_name: v.id for v in vgs}

    # ── 农户原始数据 ──
    raw = [
        ("张国强", "510123196503154231", "13812340001", "6222021234560001", "农业银行红星支行", "红星村一组", "红星村一组12号", 3.5, 1),
        ("李秀英", "510123197208224562", "13812340002", "6222021234560002", "农业银行红星支行", "红星村一组", "红星村一组15号", 2.8, 1),
        ("王建军", "510123198001073891", "13812340003", "6222021234560003", "建设银行光明支行", "红星村二组", "红星村二组3号",  5.2, 1),
        ("赵梅",   "510123197512185124", "13812340004", "6222021234560004", "农业银行红星支行", "红星村二组", "红星村二组7号",  1.9, 1),
        ("陈志远", "510123196811224517", "13812340005", "6222021234560005", "邮储银行和平支行", "红星村三组", "红星村三组20号", 4.1, 1),
        ("刘翠花", "510123196205314528", "13812340006", "6222021234560006", "农业银行光明支行", "光明村一组", "光明村一组8号",  2.3, 1),
        ("孙大海", "510123197709124539", "13812340007", "6222021234560007", "农业银行光明支行", "光明村一组", "光明村一组11号", 6.7, 1),
        ("周小燕", "510123198807185540", "13812340008", "6222021234560008", "建设银行光明支行", "光明村二组", "光明村二组2号",  1.5, 1),
        ("吴长贵", "510123195904224551", "13812340009", "6222021234560009", "邮储银行和平支行", "光明村二组", "光明村二组9号",  8.0, 1),
        ("郑芳",   "510123199103074562", "13812340010", "6222021234560010", "农业银行和平支行", "和平村一组", "和平村一组5号",  2.1, 1),
        ("冯德胜", "510123197406154573", "13812340011", "6222021234560011", "农业银行和平支行", "和平村一组", "和平村一组18号", 3.8, 1),
        ("蒋淑华", "510123196702284584", "13812340012", "6222021234560012", "建设银行红星支行", "红星村一组", "红星村一组33号", 2.6, 2),  # 注销
        ("韩明亮", "510123198503134595", "13812340013", "6222021234560013", "邮储银行光明支行", "光明村一组", "光明村一组22号", 4.4, 1),
        ("杨春梅", "510123197001215606", "13812340014", "6222021234560014", "农业银行红星支行", "红星村三组", "红星村三组6号",  3.0, 1),
        ("胡大柱", "510123196309274617", "13812340015", "6222021234560015", "农业银行和平支行", "和平村一组", "和平村一组30号", 5.5, 3),  # 迁出
    ]

    farmers = []
    for name, id_card, phone, bank_card, bank_name, vg_name, address, land_area, status in raw:
        parsed = parse_id_card(id_card)
        farmer = FarmerProfile(
            household_id=0,
            real_name=name,
            gender=parsed["gender"],
            id_card=id_card,
            birth_date=parsed["birth_date"],
            phone=phone,
            bank_card=bank_card,
            bank_name=bank_name,
            is_head=1,
            relation="本人",
            farmer_status=status,
        )
        db.add(farmer)
        db.flush()

        hh = FamilyHousehold(
            household_code=gen_household_code(farmer.id),
            household_name=f"{name}户",
            head_farmer_id=farmer.id,
            village_group_id=vg[vg_name],
            address=address,
            land_area=land_area,
            status=status,
            member_count=1,
        )
        db.add(hh)
        db.flush()

        farmer.household_id = hh.id
        farmers.append(farmer)

    db.flush()
    print(f"  ✓ 写入 {len(farmers)} 名农户")

    # ── 补贴类型 ──
    types = [
        SubsidyType(subsidy_name="粮食直补",         subsidy_year=2024, standard_amount=120, standard_unit="元/亩", fund_source="中央", pay_status=2),
        SubsidyType(subsidy_name="农机购置补贴",     subsidy_year=2024, standard_amount=500, standard_unit="元/户", fund_source="省级", pay_status=1),
        SubsidyType(subsidy_name="低保生活补助",     subsidy_year=2024, standard_amount=800, standard_unit="元/人", fund_source="县级", pay_status=2),
        SubsidyType(subsidy_name="耕地地力保护补贴", subsidy_year=2024, standard_amount=90,  standard_unit="元/亩", fund_source="中央", pay_status=0),
        SubsidyType(subsidy_name="粮食直补",         subsidy_year=2023, standard_amount=110, standard_unit="元/亩", fund_source="中央", pay_status=2),
        SubsidyType(subsidy_name="农机购置补贴",     subsidy_year=2023, standard_amount=480, standard_unit="元/户", fund_source="省级", pay_status=2),
        SubsidyType(subsidy_name="低保生活补助",     subsidy_year=2023, standard_amount=750, standard_unit="元/人", fund_source="县级", pay_status=2),
    ]
    db.add_all(types)
    db.flush()

    # id映射
    t24_grain   = types[0].id
    t24_machine = types[1].id
    t24_welfare = types[2].id
    t24_land    = types[3].id
    t23_grain   = types[4].id
    t23_machine = types[5].id
    t23_welfare = types[6].id

    # farmer id 映射（按 raw 顺序）
    fid = {raw[i][0]: farmers[i].id for i in range(len(raw))}

    # ── 补贴申请（2024） ──
    apps_2024 = [
        (fid["张国强"], t24_grain,   2024, 420,  420,  3.5,  2, date(2024,7,15)),
        (fid["张国强"], t24_machine, 2024, 500,  500,  None, 2, date(2024,8,20)),
        (fid["李秀英"], t24_grain,   2024, 336,  336,  2.8,  2, date(2024,7,15)),
        (fid["王建军"], t24_grain,   2024, 624,  624,  5.2,  2, date(2024,7,15)),
        (fid["王建军"], t24_land,    2024, 468,  None, 5.2,  0, None),
        (fid["赵梅"],   t24_welfare, 2024, 800,  800,  None, 2, date(2024,6,1)),
        (fid["陈志远"], t24_grain,   2024, 492,  492,  4.1,  2, date(2024,7,15)),
        (fid["刘翠花"], t24_grain,   2024, 276,  276,  2.3,  2, date(2024,7,15)),
        (fid["孙大海"], t24_grain,   2024, 804,  804,  6.7,  2, date(2024,7,15)),
        (fid["孙大海"], t24_machine, 2024, 500,  500,  None, 1, None),
        (fid["周小燕"], t24_welfare, 2024, 800,  800,  None, 2, date(2024,6,1)),
        (fid["吴长贵"], t24_grain,   2024, 960,  960,  8.0,  2, date(2024,7,15)),
        (fid["郑芳"],   t24_grain,   2024, 252,  252,  2.1,  2, date(2024,7,15)),
        (fid["冯德胜"], t24_grain,   2024, 456,  456,  3.8,  2, date(2024,7,15)),
        (fid["韩明亮"], t24_machine, 2024, 500,  500,  None, 2, date(2024,8,20)),
        (fid["杨春梅"], t24_grain,   2024, 360,  360,  3.0,  2, date(2024,7,15)),
    ]

    # ── 补贴申请（2023） ──
    apps_2023 = [
        (fid["张国强"], t23_grain,   2023, 385,  385,  3.5,  2, date(2023,7,10)),
        (fid["张国强"], t23_machine, 2023, 480,  480,  None, 2, date(2023,8,15)),
        (fid["李秀英"], t23_grain,   2023, 308,  308,  2.8,  2, date(2023,7,10)),
        (fid["王建军"], t23_grain,   2023, 572,  572,  5.2,  2, date(2023,7,10)),
        (fid["陈志远"], t23_grain,   2023, 451,  451,  4.1,  2, date(2023,7,10)),
        (fid["刘翠花"], t23_grain,   2023, 253,  253,  2.3,  2, date(2023,7,10)),
        (fid["孙大海"], t23_grain,   2023, 737,  737,  6.7,  2, date(2023,7,10)),
        (fid["吴长贵"], t23_grain,   2023, 880,  880,  8.0,  2, date(2023,7,10)),
        (fid["冯德胜"], t23_grain,   2023, 418,  418,  3.8,  2, date(2023,7,10)),
        (fid["蒋淑华"], t23_grain,   2023, 286,  286,  2.6,  2, date(2023,7,10)),  # 已注销
        (fid["杨春梅"], t23_grain,   2023, 330,  330,  3.0,  2, date(2023,7,10)),
        (fid["赵梅"],   t23_welfare, 2023, 750,  750,  None, 2, date(2023,6,1)),
        (fid["周小燕"], t23_welfare, 2023, 750,  750,  None, 2, date(2023,6,1)),
    ]

    for farmer_id, st_id, year, apply_a, actual_a, area, pay_s, pay_d in apps_2024 + apps_2023:
        f = db.get(FarmerProfile, farmer_id)
        app = SubsidyApplication(
            farmer_id=farmer_id,
            subsidy_type_id=st_id,
            apply_year=year,
            apply_amount=apply_a,
            actual_amount=actual_a,
            apply_area=area,
            pay_status=pay_s,
            pay_date=pay_d,
            bank_card_snapshot=f"****{f.bank_card[-4:]}" if f and f.bank_card else None,
        )
        db.add(app)

    db.commit()
    print(f"  ✓ 写入 {len(apps_2024)} 条2024年补贴记录")
    print(f"  ✓ 写入 {len(apps_2023)} 条2023年补贴记录")
    print("\n✅ 模拟数据初始化完成！")
    db.close()


if __name__ == "__main__":
    seed()
