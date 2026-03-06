from sqlalchemy import (
    Column, Integer, String, SmallInteger, Date,
    DateTime, Text, DECIMAL, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class VillageGroup(Base):
    """村组字典表"""
    __tablename__ = "village_group"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    village_name = Column(String(50), nullable=False, comment="村名")
    group_no     = Column(String(20), nullable=False, comment="组号")
    full_name    = Column(String(80), nullable=False, comment="村+组全称")
    created_at   = Column(DateTime, default=func.now())

    # 关联
    households = relationship("FamilyHousehold", back_populates="village_group")


class FamilyHousehold(Base):
    """家庭户表"""
    __tablename__ = "family_household"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    household_code  = Column(String(30), nullable=False, unique=True, comment="户编码 HH0001")
    household_name  = Column(String(50), nullable=False, comment="家庭名称")
    head_farmer_id  = Column(Integer, nullable=True, comment="户主 farmer_profile.id")
    village_group_id= Column(Integer, ForeignKey("village_group.id"), nullable=False)
    address         = Column(String(200), nullable=True)
    land_area       = Column(DECIMAL(10, 2), nullable=True, comment="土地面积(亩)")
    status          = Column(SmallInteger, nullable=False, default=1, comment="1在册 2注销 3迁出")
    member_count    = Column(Integer, nullable=False, default=1)
    remark          = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=func.now())
    updated_at      = Column(DateTime, default=func.now(), onupdate=func.now())

    # 关联
    village_group = relationship("VillageGroup", back_populates="households")
    members       = relationship("FarmerProfile", back_populates="household",
                                 foreign_keys="FarmerProfile.household_id")


class FarmerProfile(Base):
    """农户基础信息表"""
    __tablename__ = "farmer_profile"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    household_id     = Column(Integer, ForeignKey("family_household.id"), nullable=False)
    real_name        = Column(String(50), nullable=False)
    gender           = Column(SmallInteger, nullable=False, comment="1男 2女")
    id_card          = Column(String(18), nullable=False, unique=True, comment="身份证号")
    birth_date       = Column(Date, nullable=True, comment="从身份证解析")
    phone            = Column(String(20), nullable=True)
    bank_card        = Column(String(25), nullable=True)
    bank_name        = Column(String(100), nullable=True)
    is_head          = Column(SmallInteger, nullable=False, default=1, comment="1户主 0成员")
    relation         = Column(String(20), nullable=True, default="本人", comment="与户主关系")
    farmer_status    = Column(SmallInteger, nullable=False, default=1,
                              comment="1在册 2注销 3迁出 4死亡")
    remark           = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=func.now())
    updated_at       = Column(DateTime, default=func.now(), onupdate=func.now())

    # 关联
    household    = relationship("FamilyHousehold", back_populates="members",
                                foreign_keys=[household_id])
    applications = relationship("SubsidyApplication", back_populates="farmer")


class SubsidyType(Base):
    """补贴类型表"""
    __tablename__ = "subsidy_type"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    subsidy_name    = Column(String(100), nullable=False, comment="补贴名称")
    subsidy_year    = Column(SmallInteger, nullable=False, comment="补贴年度")
    calc_mode       = Column(String(10), nullable=False, default="fixed", comment="fixed=固定金额 per_mu=按亩计算")
    standard_amount = Column(DECIMAL(10, 2), nullable=True, comment="补贴标准金额（fixed:每户/人; per_mu:每亩）")
    standard_unit   = Column(String(20), nullable=True, comment="元/亩 元/人 元/户")
    fund_source     = Column(String(50), nullable=True, comment="中央/省级/县级")
    apply_deadline  = Column(Date, nullable=True)
    pay_status      = Column(SmallInteger, nullable=False, default=0,
                             comment="0未发放 1部分发放 2已发放完毕")
    description     = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=func.now())

    # 关联
    applications = relationship("SubsidyApplication", back_populates="subsidy_type")


class SubsidyApplication(Base):
    """补贴申请记录表（核心业务表）"""
    __tablename__ = "subsidy_application"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    farmer_id           = Column(Integer, ForeignKey("farmer_profile.id"), nullable=False)
    subsidy_type_id     = Column(Integer, ForeignKey("subsidy_type.id"), nullable=False)
    apply_year          = Column(SmallInteger, nullable=False)
    apply_amount        = Column(DECIMAL(10, 2), nullable=True, comment="申请金额")
    actual_amount       = Column(DECIMAL(10, 2), nullable=True, comment="实发金额")
    apply_area          = Column(DECIMAL(10, 2), nullable=True, comment="申请面积(亩)")
    pay_status          = Column(SmallInteger, nullable=False, default=0,
                                 comment="0待审核 1审核通过 2已发放 3驳回")
    pay_date            = Column(Date, nullable=True)
    bank_card_snapshot  = Column(String(25), nullable=True, comment="发放时银行卡快照")
    operator_id         = Column(Integer, nullable=True)
    remark              = Column(Text, nullable=True)
    created_at          = Column(DateTime, default=func.now())
    updated_at          = Column(DateTime, default=func.now(), onupdate=func.now())

    # 同一农户同年同补贴不能重复
    __table_args__ = (
        UniqueConstraint("farmer_id", "subsidy_type_id", "apply_year",
                         name="uq_farmer_subsidy_year"),
    )

    # 关联
    farmer       = relationship("FarmerProfile", back_populates="applications")
    subsidy_type = relationship("SubsidyType", back_populates="applications")


class AuditLog(Base):
    """操作日志表"""
    __tablename__ = "audit_log"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    operator_id   = Column(Integer, nullable=True)
    operator_name = Column(String(50), nullable=False, default="系统")
    action        = Column(String(50), nullable=False,
                           comment="CREATE/UPDATE/DELETE/QUERY/EXPORT/AI_ANALYZE")
    table_name    = Column(String(50), nullable=False)
    record_id     = Column(Integer, nullable=True)
    before_data   = Column(Text, nullable=True, comment="修改前JSON")
    after_data    = Column(Text, nullable=True, comment="修改后JSON")
    ip_address    = Column(String(50), nullable=True)
    created_at    = Column(DateTime, default=func.now())
