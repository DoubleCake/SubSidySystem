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
    description        = Column(Text, nullable=True)
    count_toward_area  = Column(SmallInteger, nullable=False, default=1,
                                comment="1=按亩补贴累计入家庭承包面积 0=不计入（固定金额补贴一般选0）")
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


class SubsidyEligibilityRule(Base):
    """补贴资格规则表 —— 每个补贴项目可以配置多条规则"""
    __tablename__ = "subsidy_eligibility_rule"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    subsidy_type_id  = Column(Integer, ForeignKey("subsidy_type.id"), nullable=False)
    rule_name        = Column(String(100), nullable=False, comment="规则名称")
    rule_desc        = Column(Text, nullable=True, comment="规则说明（给操作员看）")

    # ── 人员条件 ──
    require_farmer_status = Column(SmallInteger, nullable=True, default=1,
                                   comment="要求农户状态：1在册 2注销 3迁出 4死亡 null不限")
    require_age_min  = Column(SmallInteger, nullable=True, comment="最小年龄（岁），null不限")
    require_age_max  = Column(SmallInteger, nullable=True, comment="最大年龄（岁），null不限")

    # ── 土地条件 ──
    require_land_type    = Column(String(20), nullable=True, comment="要求地块类型，null不限")
    require_min_area     = Column(DECIMAL(10,2), nullable=True, comment="最小面积（亩），null不限")
    require_max_area     = Column(DECIMAL(10,2), nullable=True, comment="最大面积（亩），null不限")
    require_not_idle     = Column(SmallInteger, nullable=False, default=0,
                                  comment="1=要求土地未撂荒，0=不限")
    require_contract_valid = Column(SmallInteger, nullable=False, default=0,
                                    comment="1=要求承包合同在有效期内，0=不限")

    # ── 叠加规则 ──
    can_combine_with_others = Column(SmallInteger, nullable=False, default=1,
                                     comment="1=可与其他补贴叠加 0=不可叠加")
    exclusive_with       = Column(Text, nullable=True, comment="不可同时发放的补贴type_id，JSON数组")

    # ── 状态 ──
    is_active     = Column(SmallInteger, nullable=False, default=1)
    created_at    = Column(DateTime, default=func.now())
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())

    subsidy_type  = relationship("SubsidyType", backref="eligibility_rules")


class ExcelColumnTemplate(Base):
    """Excel列映射模板 —— 记录各村各年度Excel的列名映射关系"""
    __tablename__ = "excel_column_template"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    template_name  = Column(String(200), nullable=False, comment="模板名称")
    template_year  = Column(SmallInteger, nullable=True, comment="适用年度，null=通用")
    region_name    = Column(String(100), nullable=True, comment="适用村组名称，null=通用")
    business_type  = Column(String(20), nullable=False, default="SUBSIDY",
                            comment="FARMER农户/SUBSIDY补贴/PLANTING种植")
    subsidy_type_id = Column(Integer, nullable=True, comment="关联补贴类型，business_type=SUBSIDY时")

    # ── 解析配置 ──
    header_row       = Column(SmallInteger, nullable=False, default=1, comment="表头行号")
    data_start_row   = Column(SmallInteger, nullable=False, default=2, comment="数据起始行")
    skip_footer_rows = Column(SmallInteger, nullable=False, default=0, comment="跳过末尾行数")

    # ── 列映射（JSON数组）──
    column_mapping  = Column(Text, nullable=False, comment="列名映射规则 JSON")
    # 格式：[{"system_field":"real_name","aliases":["姓名","户主姓名"],"required":true,"transform":""}]

    # ── 跳过规则（JSON数组）──
    skip_rules      = Column(Text, nullable=True, comment="跳过行规则 JSON")
    # 格式：[{"field":"real_name","condition":"is_empty"}]

    # ── 值映射（JSON对象）──
    value_mapping   = Column(Text, nullable=True, comment="字段值翻译 JSON")
    # 格式：{"farmer_status":{"在册":1,"正常":1,"注销":2}}

    use_count       = Column(Integer, nullable=False, default=0, comment="使用次数")
    last_used_at    = Column(DateTime, nullable=True)
    created_by      = Column(String(50), nullable=True)
    is_active       = Column(SmallInteger, nullable=False, default=1)
    created_at      = Column(DateTime, default=func.now())
    updated_at      = Column(DateTime, default=func.now(), onupdate=func.now())


class ExcelImportLog(Base):
    """Excel导入日志 —— 永久保留，可追溯每次导入"""
    __tablename__ = "excel_import_log"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    template_id      = Column(Integer, nullable=True, comment="使用的模板id，null=未使用模板")
    template_name    = Column(String(200), nullable=True, comment="模板名称快照")
    file_name        = Column(String(500), nullable=False, comment="原始文件名")
    file_hash        = Column(String(64), nullable=True, comment="文件SHA256，防重复导入")
    business_type    = Column(String(20), nullable=False)
    region_name      = Column(String(100), nullable=True)
    import_year      = Column(SmallInteger, nullable=True)

    # ── 结果统计 ──
    total_rows       = Column(Integer, nullable=False, default=0)
    valid_rows       = Column(Integer, nullable=False, default=0)
    created_count    = Column(Integer, nullable=False, default=0)
    updated_count    = Column(Integer, nullable=False, default=0)
    skipped_count    = Column(Integer, nullable=False, default=0)
    error_count      = Column(Integer, nullable=False, default=0)
    warning_count    = Column(Integer, nullable=False, default=0)
    rule_failed_count = Column(Integer, nullable=False, default=0, comment="资格规则不通过数")

    # ── 详情（JSON）──
    error_detail     = Column(Text, nullable=True)
    warning_detail   = Column(Text, nullable=True)
    rule_fail_detail = Column(Text, nullable=True, comment="资格规则不通过的明细")
    column_mapping_used = Column(Text, nullable=True, comment="本次实际使用的列映射快照")

    operator         = Column(String(50), nullable=True)
    import_duration_ms = Column(Integer, nullable=True)
    created_at       = Column(DateTime, default=func.now())


class LandTrust(Base):
    """
    土地流转/代耕代种台账
    记录家庭户之间的土地经营权委托关系（一年一签，按年度管理）
    
    核心逻辑：
    - 流出方（owner）：承包人，将土地委托给他人耕种
    - 流入方（operator）：实际耕种人，可申请该地块的种粮补贴
    - 面积计入：流入方可耕种面积增加，流出方纯承包面积不变（权属不变）
    """
    __tablename__ = "land_trust"

    id                   = Column(Integer, primary_key=True, autoincrement=True)

    # ── 流出方（承包权人）──
    owner_household_id   = Column(Integer, ForeignKey("family_household.id"), nullable=False,
                                   comment="流出方：土地承包人家庭户")

    # ── 流入方（经营权人，可为空表示撂荒/集体统一）──
    operator_household_id = Column(Integer, ForeignKey("family_household.id"), nullable=True,
                                    comment="流入方：实际耕种人家庭户，null=撂荒或集体")

    # ── 流转类型 ──
    trust_type           = Column(String(20), nullable=False, default="ENTRUST",
                                   comment="ENTRUST代耕代种/RENT出租/TRANSFER流转/IDLE撂荒/COLLECTIVE集体统一")

    # ── 面积与时间（核心字段，都可选）──
    area                 = Column(DECIMAL(10, 2), nullable=True, comment="流转面积（亩），null=未精确量")
    trust_year           = Column(SmallInteger, nullable=False, comment="流转年度（一年一签）")
    start_date           = Column(Date, nullable=True, comment="开始日期，可仅填年度")
    end_date             = Column(Date, nullable=True, comment="结束日期，可仅填年度")

    # ── 经济条款（全部可选）──
    annual_fee           = Column(DECIMAL(10, 2), nullable=True, comment="年租金（元/亩），null=未记录")
    payment_method       = Column(String(20), nullable=True,
                                   comment="支付方式：CASH现金/GRAIN粮食折算/FREE无偿/OTHER其他")
    fee_note             = Column(Text, nullable=True, comment="租金备注")

    # ── 地块关联（可选，有地块台账时关联）──
    parcel_desc          = Column(String(200), nullable=True, comment="地块描述（无地块台账时的文字记录）")

    # ── 数据可信度（核心设计，宽松处理）──
    data_reliability     = Column(String(20), nullable=False, default="VILLAGE_CONFIRM",
                                   comment="CERTIFIED有合同/VILLAGE_CONFIRM村委确认/SELF_REPORT自报/SUSPECTED存疑")

    # ── 补贴影响配置 ──
    affect_subsidy_calc  = Column(SmallInteger, nullable=False, default=1,
                                   comment="1=纳入补贴面积计算/0=仅作记录不影响计算")

    # ── 审核信息 ──
    verified_by          = Column(String(50), nullable=True)
    verified_date        = Column(Date, nullable=True)
    note                 = Column(Text, nullable=True)
    operator             = Column(String(50), nullable=True, comment="录入人")
    is_active            = Column(SmallInteger, nullable=False, default=1)
    created_at           = Column(DateTime, default=func.now())
    updated_at           = Column(DateTime, default=func.now(), onupdate=func.now())

    # ── 关联 ──
    owner_household    = relationship("FamilyHousehold", foreign_keys=[owner_household_id],
                                       backref="trust_out_records")
    operator_household = relationship("FamilyHousehold", foreign_keys=[operator_household_id],
                                       backref="trust_in_records")


class HouseholdEvent(Base):
    """
    家庭户变更事件记录
    凡是影响家庭户结构、土地面积的重要事件都记录在此
    是家庭户"历史"的主要载体
    """
    __tablename__ = "household_event"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    household_id    = Column(Integer, ForeignKey("family_household.id"), nullable=False,
                             comment="主体家庭户")
    related_hh_id   = Column(Integer, nullable=True,
                             comment="关联家庭户（分户时的新户、合户时的被并入户）")

    event_type      = Column(String(30), nullable=False,
                             comment="""
                             FOUND=建档登记
                             MEMBER_ADD=成员新增
                             MEMBER_REMOVE=成员移出
                             MEMBER_STATUS=成员状态变更（死亡/迁出等）
                             HEAD_CHANGE=户主变更
                             SPLIT=分户（一户变两户）
                             MERGE=合户（两户合一户）
                             LAND_CHANGE=土地面积变更
                             STATUS_CHANGE=家庭户状态变更
                             REMARK=备注说明（无具体分类的记录）
                             """)
    event_year      = Column(SmallInteger, nullable=False, comment="事件发生年度")
    event_date      = Column(Date, nullable=True, comment="事件日期，精确到天时填写")
    date_accuracy   = Column(String(10), nullable=False, default="YEAR",
                             comment="日期精度：EXACT精确/MONTH月/YEAR仅知年份")

    # 变更快照（JSON）
    before_snapshot = Column(Text, nullable=True, comment="事件前状态JSON快照")
    after_snapshot  = Column(Text, nullable=True, comment="事件后状态JSON快照")

    # 关联农户（成员新增/移出/状态变更时）
    farmer_id       = Column(Integer, nullable=True, comment="涉及的具体农户id")
    farmer_name     = Column(String(50), nullable=True, comment="涉及农户姓名（冗余，防关联断裂）")

    # 描述与证明
    description     = Column(Text, nullable=False, default="", comment="事件描述")
    evidence_type   = Column(String(20), nullable=True,
                             comment="证明材料类型：NONE/ID_CARD/HOUSEHOLD_REG/VILLAGE_PROOF/COURT/OTHER")
    evidence_note   = Column(String(200), nullable=True, comment="证明材料说明")

    operator        = Column(String(50), nullable=True, comment="操作人")
    created_at      = Column(DateTime, default=func.now())

    household = relationship("FamilyHousehold", foreign_keys=[household_id],
                              backref="events")
