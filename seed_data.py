"""
模拟数据脚本 v2 —— 追加模式（不重复插入已有身份证）
运行：cd D:\Tools\subsidy_system && python seed_data.py
生成约 120 名农户，覆盖多个村组，含 2023/2024 年度补贴记录
"""
import random, sys, os, datetime
sys.path.insert(0, os.path.dirname(__file__))
from database import SessionLocal, engine
from models import Base, VillageGroup, FamilyHousehold, FarmerProfile, SubsidyType, SubsidyApplication
from utils import gen_household_code, parse_id_card
from sqlalchemy import func

random.seed(42)

VILLAGES = [
    ("红星村",  ["一组","二组","三组","四组"]),
    ("青山村",  ["一组","二组","三组"]),
    ("幸福村",  ["一组","二组","四组","五组"]),
    ("民主村",  ["一组","二组","三组"]),
    ("新建村",  ["一组","二组"]),
]
SURNAMES = list("王李张刘陈杨黄赵周吴徐孙马朱胡郭林何高梁唐郑罗宋谢韩曹许邓萧冯曾程蔡彭潘袁于董余苏叶")
GIVEN_M = ["国强","建国","志明","文军","海波","建华","荣华","卫东","振宇","立新","光明","永强","文斌","胜利","建设","大勇","志刚","军民","长江","明德","发强","庆丰","国华","文杰","建平","忠诚","永福","玉林","金山","正平"]
GIVEN_F = ["秀英","桂花","凤英","玉兰","淑芬","翠花","丽华","桂英","春梅","玉珍","凤仙","秀珍","梅花","彩霞","香花","淑英","桂珍","凤凰","美珍","素英","文华","惠芳","淑珍","春花","玉华","秀华","月英","桂兰","翠云"]
BANKS  = ["中国农业银行","中国工商银行","中国建设银行","中国邮政储蓄银行","农村商业银行"]
RELATIONS = ["妻子","儿子","女儿","父亲","母亲","兄弟","姐妹"]

def rand_id(y,m,d,gender,seq):
    area = random.choice(["510123","510124","510125","510126","510181"])
    body = f"{area}{y:04d}{m:02d}{d:02d}{(seq*2-1 if gender==1 else seq*2)%999+1:03d}"
    w=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]; ck="10X98765432"
    return body + ck[sum(int(body[i])*w[i] for i in range(17))%11]

def rand_phone():
    return random.choice(["138","139","150","151","158","159","186","187"])+str(random.randint(10000000,99999999))

def rand_bank():
    return "6228"+"".join([str(random.randint(0,9)) for _ in range(15)])

def rand_name(g):
    return random.choice(SURNAMES)+(random.choice(GIVEN_M) if g==1 else random.choice(GIVEN_F))

def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    print("=== 模拟数据生成（追加模式）===")

    # 1. 村组
    vg_map = {}
    for vname, groups in VILLAGES:
        for gno in groups:
            ex = db.query(VillageGroup).filter_by(village_name=vname, group_no=gno).first()
            if ex: vg_map[(vname,gno)]=ex.id; continue
            vg = VillageGroup(village_name=vname, group_no=gno, full_name=f"{vname}{gno}")
            db.add(vg); db.flush(); vg_map[(vname,gno)]=vg.id
    db.commit()
    print(f"  村组: {len(vg_map)} 个")

    # 2. 补贴类型（按季节分类）
    # 季节分类: 大春|小春|耕地地力保护|临时
    # 固定金额类: 不按面积计算，参与面积检查
    season_types = {
        "大春": ["水稻补贴", "玉米补贴", "大豆补贴"],
        "小春": ["小麦补贴", "油菜补贴"],
        "耕地地力保护": ["耕地地力保护补贴"],
    }
    fixed_types = ["农村低保补助", "高龄老人补贴", "残疾人补贴", "生育补贴"]

    all_st_ids = []  # [(id, year, amount, season), ...]
    for year in [2020]:
        for season, names in season_types.items():
            for name in names:
                ex = db.query(SubsidyType).filter_by(subsidy_name=name, subsidy_year=year).first()
                if not ex:
                    amt = round(random.uniform(100, 300), 2)
                    ex = SubsidyType(
                        subsidy_name=name, subsidy_year=year, calc_mode="per_mu",
                        standard_amount=amt, standard_unit="元/亩",
                        fund_source=random.choice(["中央", "省级", "县级"]),
                        season=season,
                        pay_status=2
                    )
                    db.add(ex); db.flush()
                all_st_ids.append((ex.id, year, float(ex.standard_amount), ex.season))
        for name in fixed_types:
            ex = db.query(SubsidyType).filter_by(subsidy_name=name, subsidy_year=year).first()
            if not ex:
                amt = round(random.uniform(500, 2000), 2)
                ex = SubsidyType(subsidy_name=name, subsidy_year=year, calc_mode="fixed",
                    standard_amount=amt, standard_unit="元/人", fund_source="县级",
                    season="耕地地力保护",
                    pay_status=2)
                db.add(ex); db.flush()
            all_st_ids.append((ex.id, year, float(ex.standard_amount), "耕地地力保护"))
    db.commit()
    print(f"  补贴类型: {len(all_st_ids)} 个")

    # 3. 农户 + 家庭户
    created_f, created_hh = 0, 0
    all_farmer_ids = []
    for (vname,gno), vg_id in vg_map.items():
        for hh_i in range(random.randint(7,11)):
            g_head = random.choice([1,1,1,2])
            by = random.randint(1950,1985)
            bm, bd = random.randint(1,12), random.randint(1,28)
            id_head = rand_id(by,bm,bd,g_head,hh_i+1)
            if db.query(FarmerProfile).filter_by(id_card=id_head).first(): continue

            name_head = rand_name(g_head)
            land = round(random.uniform(0.5,8.0),2)
            hh = FamilyHousehold(household_code="TEMP",household_name=f"{name_head}户",
                village_group_id=vg_id,address=f"{vname}{gno}{hh_i+1}号",
                land_area=land,status=1)
            db.add(hh); db.flush()
            hh.household_code = gen_household_code(hh.id)
            head = FarmerProfile(household_id=hh.id,real_name=name_head,gender=g_head,
                id_card=id_head,
                phone=rand_phone() if random.random()>0.2 else None,
                bank_card=rand_bank(),bank_name=random.choice(BANKS),
                relation="本人",farmer_status=1)
            db.add(head); db.flush()
            hh.head_farmer_id = head.id
            all_farmer_ids.append((head.id, hh.id, land))
            created_f += 1

            for mi in range(random.randint(0,2)):
                mg = random.choice([1,2]); mby = random.randint(1960,2005)
                mid = rand_id(mby,random.randint(1,12),random.randint(1,28),mg,hh_i*10+mi+1)
                if db.query(FarmerProfile).filter_by(id_card=mid).first(): continue
                m = FarmerProfile(household_id=hh.id,real_name=rand_name(mg),gender=mg,
                    id_card=mid,
                    phone=rand_phone() if random.random()>0.5 else None,
                    bank_card=rand_bank() if random.random()>0.4 else None,
                    bank_name=random.choice(BANKS) if random.random()>0.4 else None,
                    relation=random.choice(RELATIONS),
                    farmer_status=random.choices([1,1,1,2,3],weights=[80,5,5,5,5])[0])
                db.add(m); db.flush()
                all_farmer_ids.append((m.id, hh.id, land))
                created_f += 1
            created_hh += 1
    db.commit()
    print(f"  农户: {created_f} 人, 家庭户: {created_hh} 户")

    # 4. 补贴申请
    created_app = 0
    # 按面积补贴（大春/小春/耕地地力保护）
    area_st_ids = [(sid, yr, amt, s) for sid, yr, amt, s in all_st_ids
                   if db.get(SubsidyType, sid).calc_mode == "per_mu"]
    # 固定金额补贴（按人/户）
    fixed_st_ids = [(sid, yr, amt) for sid, yr, amt, s in all_st_ids
                    if db.get(SubsidyType, sid).calc_mode == "fixed"]

    # 按面积补贴的申请
    heads = db.query(FarmerProfile).join(
        FamilyHousehold, FamilyHousehold.head_farmer_id == FarmerProfile.id
    ).filter(FarmerProfile.farmer_status == 1).all()
    for h in heads:
        hh = db.get(FamilyHousehold, h.household_id)
        land = float(hh.land_area or 0) if hh else 0
        if land <= 0: continue
        for (st_id, year, amt_per_mu, season) in area_st_ids:
            if random.random() > 0.85: continue
            ex = db.query(SubsidyApplication).filter_by(farmer_id=h.id, subsidy_type_id=st_id, apply_year=year).first()
            if ex: continue
            area = round(land * random.uniform(0.6, 1.0), 2)
            amount = round(area * amt_per_mu, 2)
            ps = 2  # 2020年度数据已发放
            pdate = datetime.date(year, random.randint(7, 11), random.randint(1, 28)) if ps == 2 else None
            db.add(SubsidyApplication(
                farmer_id=h.id, subsidy_type_id=st_id, apply_year=year,
                apply_area=area, apply_amount=amount, actual_amount=amount if ps >= 1 else None,
                pay_status=ps, pay_date=pdate,
                bank_card_snapshot=h.bank_card[-4:] if h.bank_card else None))
            created_app += 1

    # 固定金额补贴申请
    all_fp = db.query(FarmerProfile).filter_by(farmer_status=1).all()
    for (st_id, year, amt) in fixed_st_ids:
        chosen = random.sample(all_fp, min(int(len(all_fp) * random.uniform(0.2, 0.4)), len(all_fp)))
        for f in chosen:
            if db.query(SubsidyApplication).filter_by(farmer_id=f.id, subsidy_type_id=st_id, apply_year=year).first():
                continue
            ps = 2  # 2020年度数据已发放
            pdate = datetime.date(year, random.randint(7, 11), random.randint(1, 28)) if ps == 2 else None
            db.add(SubsidyApplication(
                farmer_id=f.id, subsidy_type_id=st_id, apply_year=year,
                apply_amount=amt, actual_amount=amt if ps == 2 else None,
                pay_status=ps, pay_date=pdate,
                bank_card_snapshot=f.bank_card[-4:] if f.bank_card else None))
            created_app += 1
    db.commit()
    print(f"  补贴记录: {created_app} 条")

    tf = db.query(FarmerProfile).count()
    th = db.query(FamilyHousehold).count()
    ta = db.query(SubsidyApplication).count()
    print(f"\n=== 完成 === 数据库总计: {tf} 农户 / {th} 家庭户 / {ta} 补贴记录")
    db.close()

if __name__ == "__main__":
    main()
