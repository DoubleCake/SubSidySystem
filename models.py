from sqlalchemy import (
    Column, Integer, String, SmallInteger, Date,
    DateTime, Text, DECIMAL, Numeric, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


# ═══════════════════════════════════════════
#  村 / 组 表
# ═══════════════════════════════════════════

class Village(Base):
    """村表"""
    __tablename__ = "village"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    village_name = Column(String(50), nullable=False, unique=True, comment="村名")
    created_at   = Column(DateTime, default=func.now())

    # 关联
    households = relationship("FamilyHousehold", back_populates="village")



class FamilyHousehold(Base):
    """家庭户表"""
    __tablename__ = "family_household"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    household_code  = Column(String(30), nullable=False, unique=True, comment="户编码 HH0001")
    household_name  = Column(String(50), nullable=False, comment="家庭名称")
    head_farmer_id  = Column(Integer, nullable=True, comment="户主 farmer_profile.id")
    village_id      = Column(Integer, ForeignKey("village.id"), nullable=False, comment="所属村")
    group_no        = Column(SmallInteger, nullable=False, default=1, comment="所属组，存数字：1=一组，2=二组...")
    address             = Column(String(200), nullable=True, comment="家庭现居住地址")
    registered_address  = Column(String(200), nullable=True, comment="户籍地址（批量导入来源，可编辑，变更写历史）")
    contract_area   = Column(DECIMAL(10, 2), nullable=True, comment="承包面积(亩)")
    confirmed_area  = Column(DECIMAL(10, 2), nullable=True, comment="确权面积(亩)")
    status          = Column(SmallInteger, nullable=False, default=1, comment="1在册 2注销 3迁出")
    is_manually_confirmed = Column(SmallInteger, nullable=False, default=0, comment="0未确认 1已人工确认")
    manually_confirmed_at = Column(DateTime, nullable=True, comment="人工确认时间")
    manually_confirmed_by = Column(String(50), nullable=True, comment="人工确认操作人")
    remark          = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=func.now())
    updated_at      = Column(DateTime, default=func.now(), onupdate=func.now())

    # 索引
    __table_args__ = (
        Index('ix_family_household_village_id', 'village_id'),
        Index('ix_family_household_head_farmer', 'head_farmer_id'),
    )

    # 关联
    village = relationship("Village", back_populates="households")
    members = relationship("FarmerProfile", back_populates="household",
                          foreign_keys="FarmerProfile.household_id")
    area_cache = relationship("HouseholdAreaUsageCache", back_populates="household")


class FarmerProfile(Base):
    """农户基础信息表"""
    __tablename__ = "farmer_profile"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    household_id     = Column(Integer, ForeignKey("family_household.id"), nullable=False)
    real_name        = Column(String(50), nullable=False)
    gender           = Column(SmallInteger, nullable=False, comment="1男 2女")
    id_card          = Column(String(18), nullable=False, unique=True, comment="身份证号")
    phone            = Column(String(20), nullable=True)
    bank_card        = Column(String(25), nullable=True)
    bank_name        = Column(String(100), nullable=True)
    relation         = Column(String(20), nullable=True, default="本人", comment="与户主关系")
    farmer_status    = Column(SmallInteger, nullable=False, default=1,
                              comment="1在册 2注销 3迁出 4死亡")
    own_village_id   = Column(Integer, ForeignKey("village.id"), nullable=True,
                              comment="个人所在村（出嫁/迁居等，NULL=与家庭户相同）")
    own_group_no     = Column(SmallInteger, nullable=True,
                              comment="个人所在组（NULL=与家庭户相同）")
    remark           = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=func.now())
    updated_at       = Column(DateTime, default=func.now(), onupdate=func.now())

    # 索引
    __table_args__ = (
        Index('ix_farmer_profile_household_id', 'household_id'),
        Index('ix_farmer_profile_id_card', 'id_card'),
    )

    # 关联
    household    = relationship("FamilyHousehold", back_populates="members",
                                foreign_keys=[household_id])
    applications = relationship("SubsidyApplication", back_populates="farmer")
    payments     = relationship("SubsidyPayment", back_populates="farmer")


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
    category        = Column(String(50), nullable=True, comment="补贴分类，用于同类项目对比，如：耕地保护、大豆、玉米等")
    season          = Column(String(20), nullable=False, default="全年单补",
                             comment="补贴季节/类型：大春|小春|全年单补|临时")
    apply_deadline  = Column(Date, nullable=True)
    pay_status      = Column(SmallInteger, nullable=False, default=0,
                             comment="0未发放 1部分发放 2已发放完毕")
    description        = Column(Text, nullable=True)
    count_toward_area  = Column(SmallInteger, nullable=False, default=1,
                                comment="1=按亩补贴累计入家庭承包面积 0=不计入（固定金额补贴一般选0）")
    created_at      = Column(DateTime, default=func.now())

    # 关联
    applications = relationship("SubsidyApplication", back_populates="subsidy_type")
    payments     = relationship("SubsidyPayment", back_populates="subsidy_type")


class SubsidyApplication(Base):
    """补贴申请记录表（核心业务表）"""
    __tablename__ = "subsidy_application"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    farmer_id           = Column(Integer, ForeignKey("farmer_profile.id"), nullable=False)
    subsidy_type_id     = Column(Integer, ForeignKey("subsidy_type.id"), nullable=False)
    apply_year          = Column(SmallInteger, nullable=False)
    apply_amount        = Column(DECIMAL(10, 2), nullable=True, comment="申请金额")
    actual_amount       = Column(DECIMAL(10, 2), nullable=True, comment="实发金额")
    apply_area          = Column(DECIMAL(10, 2), nullable=True, comment="实际补贴面积(亩)=承包地+代耕代种")
    contract_area       = Column(DECIMAL(10, 2), nullable=True, comment="承包地面积(亩)")
    trust_area          = Column(DECIMAL(10, 2), nullable=True, comment="代耕代种面积(亩)")
    no_subsidy_area     = Column(DECIMAL(10, 2), nullable=True, comment="不予补贴面积(亩)")
    pay_status          = Column(SmallInteger, nullable=False, default=0,
                                 comment="0待审核 1审核通过 2已发放 3驳回")
    pay_date            = Column(Date, nullable=True)
    apply_village_id    = Column(Integer, ForeignKey("village.id"), nullable=True, comment="申请时村ID（快照）")
    apply_group_no      = Column(SmallInteger, nullable=True, comment="申请时组号（整数，快照）")
    apply_village_name  = Column(String(50), nullable=True, comment="冗余：申请时村名（快照）")
    apply_group_display = Column(String(20), nullable=True, comment="冗余：申请时组显示名（快照，如'一组'）")
    bank_card_snapshot  = Column(String(25), nullable=True, comment="发放时银行卡快照")
    operator_id         = Column(Integer, nullable=True)
    remark              = Column(Text, nullable=True)
    created_at          = Column(DateTime, default=func.now())
    updated_at          = Column(DateTime, default=func.now(), onupdate=func.now())
    # 代领相关字段
    is_proxy            = Column(SmallInteger, nullable=False, default=0, comment="0=普通,1=代领")

    # 索引
    __table_args__ = (
        UniqueConstraint("farmer_id", "subsidy_type_id", "apply_year",
                         name="uq_farmer_subsidy_year"),
        Index('ix_subsidy_application_farmer_year', 'farmer_id', 'apply_year'),
        Index('ix_subsidy_application_subsidy_type', 'subsidy_type_id'),
    )

    # 关联
    farmer       = relationship("FarmerProfile", back_populates="applications")
    subsidy_type = relationship("SubsidyType", back_populates="applications")
    proxy_relations = relationship("SubsidyProxy", back_populates="application")


class SubsidyPayment(Base):
    """补贴发放记录表（独立于申报表）"""
    __tablename__ = "subsidy_payment"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    farmer_id           = Column(Integer, ForeignKey("farmer_profile.id"), nullable=False)
    subsidy_type_id     = Column(Integer, ForeignKey("subsidy_type.id"), nullable=False)
    payment_year        = Column(SmallInteger, nullable=False, comment="发放年份")
    amount              = Column(DECIMAL(10, 2), nullable=True, comment="发放金额")
    payment_date        = Column(Date, nullable=True, comment="打款日期")
    payment_village_id  = Column(Integer, ForeignKey("village.id"), nullable=True, comment="发放时村ID（快照）")
    payment_group_no    = Column(SmallInteger, nullable=True, comment="发放时组号（整数，快照）")
    payment_village_name= Column(String(50), nullable=True, comment="冗余：发放时村名（快照）")
    payment_group_display= Column(String(20), nullable=True, comment="冗余：发放时组显示名（快照，如'一组'）")
    apply_area          = Column(DECIMAL(10, 2), nullable=True, comment="实际补贴面积(亩)")
    contract_area       = Column(DECIMAL(10, 2), nullable=True, comment="承包地面积(亩)")
    trust_area          = Column(DECIMAL(10, 2), nullable=True, comment="代耕代种面积(亩)")
    no_subsidy_area     = Column(DECIMAL(10, 2), nullable=True, comment="不予补贴面积(亩)")
    bank_card           = Column(String(25), nullable=True, comment="银行卡号")
    bank_name           = Column(String(50), nullable=True, comment="开户行")
    operator_id         = Column(Integer, nullable=True)
    remark              = Column(Text, nullable=True)
    proxy_remark        = Column(Text, nullable=True, comment="代领备注")
    pay_status          = Column(SmallInteger, nullable=False, default=2, comment="发放状态: 0=待发放,1=部分发放,2=已发放")
    # 代领相关字段
    is_proxy            = Column(SmallInteger, nullable=False, default=0, comment="0=普通,1=代领")
    created_at          = Column(DateTime, default=func.now())
    updated_at          = Column(DateTime, default=func.now(), onupdate=func.now())

    # 索引
    __table_args__ = (
        UniqueConstraint("farmer_id", "subsidy_type_id", "payment_year",
                         name="uq_payment_farmer_subsidy_year"),
        Index('ix_subsidy_payment_farmer_year', 'farmer_id', 'payment_year'),
        Index('ix_subsidy_payment_subsidy_type', 'subsidy_type_id'),
    )

    # 关联
    farmer       = relationship("FarmerProfile", back_populates="payments")
    subsidy_type = relationship("SubsidyType", back_populates="payments")
    proxy_relations = relationship("SubsidyProxy", back_populates="payment")


class SubsidyProxy(Base):
    """补贴代领关系表"""
    __tablename__ = "subsidy_proxy"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    # 关联的补贴记录（申请或发放）
    application_id      = Column(Integer, ForeignKey("subsidy_application.id"), nullable=True)
    payment_id          = Column(Integer, ForeignKey("subsidy_payment.id"), nullable=True)
    # 所属补贴项目类型（创建时代项目信息存储在此）
    subsidy_type_id     = Column(Integer, ForeignKey("subsidy_type.id"), nullable=True)
    # 实际受益人（面积计入此家庭）
    beneficiary_farmer_id = Column(Integer, ForeignKey("farmer_profile.id"), nullable=False)
    # 代领人（实际领钱的人）
    proxy_farmer_id     = Column(Integer, ForeignKey("farmer_profile.id"), nullable=False)
    # 代领类型: proxy=代人领取, receive=被人代领
    proxy_type          = Column(String(20), nullable=False, comment="proxy=代人领取, receive=被人代领")
    # 代领关系说明
    remark              = Column(Text, nullable=True)
    created_at          = Column(DateTime, default=func.now())
    updated_at          = Column(DateTime, default=func.now(), onupdate=func.now())

    # 索引
    __table_args__ = (
        Index('ix_subsidy_proxy_application', 'application_id'),
        Index('ix_subsidy_proxy_payment', 'payment_id'),
        Index('ix_subsidy_proxy_beneficiary', 'beneficiary_farmer_id'),
        Index('ix_subsidy_proxy_proxy', 'proxy_farmer_id'),
    )

    # 关联
    application = relationship("SubsidyApplication", back_populates="proxy_relations")
    payment = relationship("SubsidyPayment", back_populates="proxy_relations")
    beneficiary_farmer = relationship("FarmerProfile", foreign_keys=[beneficiary_farmer_id])
    proxy_farmer = relationship("FarmerProfile", foreign_keys=[proxy_farmer_id])


class HouseholdAreaUsageCache(Base):
    """家庭户面积占用缓存表 - 预计算各家庭户每年每季节的补贴面积占用"""
    __tablename__ = "household_area_usage_cache"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    household_id  = Column(Integer, ForeignKey("family_household.id"), nullable=False)
    year          = Column(SmallInteger, nullable=False)
    season        = Column(String(20), nullable=False)  # 大春/小春/全年单补/临时
    apply_area    = Column(Numeric(10, 2), default=0, comment="申报面积汇总")
    payment_area  = Column(Numeric(10, 2), default=0, comment="发放面积汇总")
    used_area     = Column(Numeric(10, 2), default=0, comment="最终使用面积(=payment_area if exists else apply_area)")
    created_at    = Column(DateTime, default=func.now())
    updated_at    = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("household_id", "year", "season", name="uq_hh_year_season"),
        Index('ix_hh_area_cache_household', 'household_id'),
        Index('ix_hh_area_cache_year', 'year'),
    )

    # 关联
    household = relationship("FamilyHousehold", back_populates="area_cache")


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
                             MANUAL_CONFIRM=人工确认信息
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

    # 索引
    __table_args__ = (
        Index('ix_household_event_hh_year', 'household_id', 'event_year'),
    )

    household = relationship("FamilyHousehold", foreign_keys=[household_id],
                              backref="events")


class VillageGroup(Base):
    """村组定义表 —— 记录各村下辖的组，独立于家庭户存在"""
    __tablename__ = "village_group"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    village_id = Column(Integer, ForeignKey("village.id"), nullable=False)
    group_no   = Column(String(20), nullable=False, comment="组名，如：一组、二组")

    __table_args__ = (
        UniqueConstraint("village_id", "group_no", name="uq_village_group"),
        Index("ix_village_group_village", "village_id"),
    )

    village = relationship("Village", backref="groups")


class VillageLandInfo(Base):
    """村级土地基础信息扩展表"""
    __tablename__ = "village_land_info"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    village_id      = Column(Integer, ForeignKey("village.id"), nullable=False, unique=True)
    survey_year     = Column(SmallInteger, nullable=True, comment="调查年度")
    paddy_area      = Column(DECIMAL(10, 2), nullable=True, comment="水田面积(亩)")
    dry_land_area   = Column(DECIMAL(10, 2), nullable=True, comment="旱地面积(亩)")
    arable_area     = Column(DECIMAL(10, 2), nullable=True, comment="实际可耕种面积(亩)")
    irrigation_level = Column(String(20), nullable=True, comment="灌溉条件: 完善/一般/无")
    terrain_type    = Column(String(20), nullable=True, comment="地形类型: 平坝/丘陵/山地")
    soil_quality    = Column(String(20), nullable=True, comment="土壤质量: 优/良/一般/差")
    remark          = Column(Text, nullable=True)
    updated_at      = Column(DateTime, default=func.now(), onupdate=func.now())

    village = relationship("Village", backref="land_info")


class AgriTask(Base):
    """农业任务表"""
    __tablename__ = "agri_task"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    task_name    = Column(String(100), nullable=False, comment="任务名称")
    crop_type    = Column(String(30), nullable=False, comment="作物类型: 水稻/玉米/大豆/油菜/小麦/其他")
    total_area   = Column(DECIMAL(10, 2), nullable=False, comment="总任务面积(亩)")
    task_year    = Column(SmallInteger, nullable=False, comment="年度")
    season       = Column(String(20), nullable=True, comment="季节: 大春/小春")
    alloc_method = Column(String(30), nullable=False, comment="分配方式: CONTRACT_AREA/PADDY_AREA/DRY_AREA/ARABLE_AREA/HISTORY_AREA")
    status       = Column(String(20), nullable=False, default="DRAFT",
                          comment="DRAFT草稿/ISSUED已下达/DONE完成")
    description  = Column(Text, nullable=True)
    operator     = Column(String(50), nullable=True)
    created_at   = Column(DateTime, default=func.now())
    updated_at   = Column(DateTime, default=func.now(), onupdate=func.now())

    allocations = relationship("AgriTaskAllocation", back_populates="task", cascade="all, delete-orphan")


class AgriTaskAllocation(Base):
    """农业任务分解明细（按村）"""
    __tablename__ = "agri_task_allocation"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    task_id      = Column(Integer, ForeignKey("agri_task.id"), nullable=False)
    village_id   = Column(Integer, ForeignKey("village.id"), nullable=False)
    village_name = Column(String(50), nullable=False, comment="村名快照")
    alloc_area   = Column(DECIMAL(10, 2), nullable=False, comment="分配面积(亩)")
    alloc_ratio  = Column(DECIMAL(8, 6), nullable=True, comment="分配比例(0-1)")
    basis_area   = Column(DECIMAL(10, 2), nullable=True, comment="计算依据面积(亩)")
    actual_area  = Column(DECIMAL(10, 2), nullable=True, comment="实际完成面积(亩)")
    remark       = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("task_id", "village_id", name="uq_agritask_village"),
        Index("ix_agri_task_alloc_task", "task_id"),
    )

    task    = relationship("AgriTask", back_populates="allocations")
    village = relationship("Village")


class ErrorLibrary(Base):
    """错误库 —— 存储已验证为错误的人员信息"""
    __tablename__ = "error_library"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    real_name       = Column(String(50), nullable=False, comment="姓名")
    id_card         = Column(String(18), nullable=False, comment="身份证号")
    error_type      = Column(String(20), nullable=False, comment="错误类型：身份证错误/重复人员/已故/身份冒用/其他")
    error_reason    = Column(Text, nullable=False, comment="错误原因详情")
    source          = Column(String(20), nullable=False, default="手动录入", comment="来源：预检发现/外部核查/手动录入")
    village_name    = Column(String(50), nullable=True, comment="所在村")
    group_no        = Column(String(20), nullable=True, comment="所在组")
    subsidy_name    = Column(String(100), nullable=True, comment="补贴分类名称")
    discovered_date = Column(String(10), nullable=True, comment="发现日期 YYYY-MM-DD")
    subsidy_type_id = Column(Integer, nullable=True, comment="关联补贴类型（可空）")
    remark          = Column(Text, nullable=True, comment="备注")
    created_at      = Column(DateTime, default=func.now())


class LargeFarmer(Base):
    """
    种植大户/家庭农场/合作社信息表
    记录规模经营主体的基本信息，用于管理与普通农户的代耕代种关联
    """
    __tablename__ = "large_farmer"

    id                  = Column(Integer, primary_key=True, autoincrement=True)

    # 基本信息
    operator_name       = Column(String(100), nullable=False, comment="经营者姓名/主体名称")
    operator_type       = Column(String(20), nullable=False, default="FAMILY_FARM",
                                  comment="FAMILY_FARM家庭农场/COOPERATIVE合作社/LARGE_PLANTER种植大户/OTHER其他")
    id_card             = Column(String(18), nullable=True, comment="负责人身份证号")
    phone               = Column(String(20), nullable=True, comment="联系电话")
    bank_card           = Column(String(25), nullable=True, comment="银行卡号")
    bank_name           = Column(String(100), nullable=True, comment="开户行")

    # 所属村组
    village_id          = Column(Integer, ForeignKey("village.id"), nullable=False, comment="所属村")
    group_no            = Column(SmallInteger, nullable=True, comment="所属组")
    address             = Column(String(200), nullable=True, comment="经营地址")

    # 规模信息
    total_managed_area  = Column(DECIMAL(10, 2), nullable=True, comment="总经营面积(亩)")
    own_contract_area   = Column(DECIMAL(10, 2), nullable=True, comment="自有承包面积(亩)")
    trust_in_area       = Column(DECIMAL(10, 2), nullable=True, comment="流入面积(亩)")

    # 经营信息
    main_crops          = Column(String(200), nullable=True, comment="主要种植作物")
    registration_no     = Column(String(50), nullable=True, comment="工商注册号/统一社会信用代码")
    registration_date   = Column(Date, nullable=True, comment="注册日期")

    # 大户评级
    farmer_grade        = Column(String(20), nullable=True,
                                  comment="PROVINCIAL省级/MUNICIPAL市级/COUNTY县级/ORDINARY普通")
    credit_score        = Column(SmallInteger, nullable=True, comment="信用评分(0-100)")

    # 状态
    status              = Column(SmallInteger, nullable=False, default=1, comment="1正常 2注销")
    is_verified         = Column(SmallInteger, nullable=False, default=0, comment="0未审核 1已审核")
    verified_by         = Column(String(50), nullable=True, comment="审核人")
    verified_date       = Column(Date, nullable=True, comment="审核日期")

    remark              = Column(Text, nullable=True, comment="备注")
    operator            = Column(String(50), nullable=True, comment="录入人")
    created_at          = Column(DateTime, default=func.now())
    updated_at          = Column(DateTime, default=func.now(), onupdate=func.now())

    # 索引
    __table_args__ = (
        Index('ix_large_farmer_village_id', 'village_id'),
        Index('ix_large_farmer_status', 'status'),
        Index('ix_large_farmer_id_card', 'id_card'),
        Index('ix_large_farmer_grade', 'farmer_grade'),
    )

    # 关联
    village = relationship("Village")
    trust_relations = relationship("LargeFarmerTrust", back_populates="large_farmer")
    parcels = relationship("LargeFarmerParcel", back_populates="large_farmer")


class LargeFarmerParcel(Base):
    """
    大户地块明细表
    记录大户经营的具体地块信息，包括位置、面积、片区标识等
    """
    __tablename__ = "large_farmer_parcel"

    id                  = Column(Integer, primary_key=True, autoincrement=True)

    # 所属大户
    large_farmer_id     = Column(Integer, ForeignKey("large_farmer.id"), nullable=False,
                                   comment="大户ID")

    # 关联的代耕代种记录（可选）
    trust_id            = Column(Integer, ForeignKey("large_farmer_trust.id"), nullable=True,
                                   comment="关联的代耕代种记录ID")

    # 地块基本信息
    parcel_name         = Column(String(100), nullable=True, comment="地块名称")
    area                = Column(DECIMAL(10, 2), nullable=False, comment="地块面积(亩)")

    # 地块位置（归属村组）
    village_id          = Column(Integer, ForeignKey("village.id"), nullable=False, comment="地块所属村")
    group_no            = Column(SmallInteger, nullable=True, comment="地块所属组")
    parcel_location     = Column(String(200), nullable=True, comment="地块位置描述")

    # 地块四至
    boundary_east       = Column(String(100), nullable=True, comment="东至")
    boundary_west       = Column(String(100), nullable=True, comment="西至")
    boundary_south      = Column(String(100), nullable=True, comment="南至")
    boundary_north      = Column(String(100), nullable=True, comment="北至")

    # 片区标识
    is_high_standard    = Column(SmallInteger, nullable=False, default=0, comment="是否高标准农田")
    is_demonstration    = Column(SmallInteger, nullable=False, default=0, comment="是否示范片区")
    zone_name           = Column(String(100), nullable=True, comment="片区名称")
    zone_type           = Column(String(50), nullable=True, comment="片区类型")

    # 地力等级
    soil_grade          = Column(String(20), nullable=True,
                                  comment="EXCELLENT优等/GOOD良/MEDIUM中/POOR差")
    soil_type           = Column(String(50), nullable=True, comment="土壤类型")
    irrigation_level    = Column(String(20), nullable=True, comment="灌溉条件：完善/一般/无")

    # 地图信息
    map_coordinates     = Column(Text, nullable=True, comment="地图坐标点（JSON数组：[[lng,lat],...]）")
    map_geojson         = Column(Text, nullable=True, comment="GeoJSON格式的地块边界")
    map_center_lng      = Column(DECIMAL(12, 8), nullable=True, comment="地图中心经度")
    map_center_lat      = Column(DECIMAL(12, 8), nullable=True, comment="地图中心纬度")
    map_zoom            = Column(SmallInteger, nullable=True, comment="地图缩放级别")

    # 种植信息
    current_crop        = Column(String(50), nullable=True, comment="当前作物")
    planting_season     = Column(String(20), nullable=True, comment="种植季节：大春/小春")
    planting_year       = Column(SmallInteger, nullable=True, comment="种植年度")

    # 状态
    is_active           = Column(SmallInteger, nullable=False, default=1, comment="1有效 0无效")
    remark              = Column(Text, nullable=True, comment="备注")
    operator            = Column(String(50), nullable=True, comment="录入人")
    created_at          = Column(DateTime, default=func.now())
    updated_at          = Column(DateTime, default=func.now(), onupdate=func.now())

    # 索引
    __table_args__ = (
        Index('ix_large_farmer_parcel_lf_id', 'large_farmer_id'),
        Index('ix_large_farmer_parcel_village_id', 'village_id'),
        Index('ix_large_farmer_parcel_high_std', 'is_high_standard'),
        Index('ix_large_farmer_parcel_demo', 'is_demonstration'),
        Index('ix_large_farmer_parcel_trust_id', 'trust_id'),
    )

    # 关联
    large_farmer = relationship("LargeFarmer", back_populates="parcels")
    village = relationship("Village", foreign_keys=[village_id])


class LargeFarmerTrust(Base):
    """
    大户与普通农户的代耕代种关联表
    记录大户从普通农户流入土地的详细信息
    """
    __tablename__ = "large_farmer_trust"

    id                   = Column(Integer, primary_key=True, autoincrement=True)

    # 关联大户
    large_farmer_id      = Column(Integer, ForeignKey("large_farmer.id"), nullable=False,
                                   comment="大户ID")

    # 流出方（普通农户）
    owner_household_id   = Column(Integer, ForeignKey("family_household.id"), nullable=False,
                                   comment="流出方家庭户ID")

    # 关联土地流转台账（可选，与land_trust表对应）
    land_trust_id        = Column(Integer, ForeignKey("land_trust.id"), nullable=True,
                                   comment="关联的土地流转记录ID")

    # 流转信息
    trust_year           = Column(SmallInteger, nullable=False, comment="流转年度")
    area                 = Column(DECIMAL(10, 2), nullable=False, comment="流转面积(亩)")
    trust_type           = Column(String(20), nullable=False, default="ENTRUST",
                                   comment="ENTRUST代耕代种/RENT出租/TRANSFER流转")

    # 地块归属村组
    parcel_village_id    = Column(Integer, ForeignKey("village.id"), nullable=True,
                                   comment="地块所属村（可与大户所属村不同）")
    parcel_group_no      = Column(SmallInteger, nullable=True, comment="地块所属组")

    # 地块信息
    parcel_desc          = Column(String(200), nullable=True, comment="地块描述")
    parcel_location      = Column(String(200), nullable=True, comment="地块位置")

    # 片区标识
    is_high_standard     = Column(SmallInteger, nullable=False, default=0, comment="是否高标准农田")
    is_demonstration     = Column(SmallInteger, nullable=False, default=0, comment="是否示范片区")
    zone_name            = Column(String(100), nullable=True, comment="片区名称")

    # 合同信息
    contract_no          = Column(String(50), nullable=True, comment="合同编号")
    start_date           = Column(Date, nullable=True, comment="流转开始日期")
    end_date             = Column(Date, nullable=True, comment="流转结束日期")

    # 合同到期提醒
    reminder_sent        = Column(SmallInteger, nullable=False, default=0, comment="是否已发送到期提醒")
    reminder_days        = Column(SmallInteger, nullable=True, comment="提前提醒天数")

    # 租金信息
    annual_fee           = Column(DECIMAL(10, 2), nullable=True, comment="年租金(元/亩)")
    total_fee            = Column(DECIMAL(10, 2), nullable=True, comment="总租金")
    payment_method       = Column(String(20), nullable=True,
                                   comment="支付方式：CASH现金/GRAIN粮食折算/FREE无偿/OTHER其他")
    payment_status       = Column(String(20), nullable=True,
                                   comment="支付状态：UNPAID未支付/PARTIAL部分支付/PAID已支付")

    # 数据状态
    data_reliability     = Column(String(20), nullable=False, default="VILLAGE_CONFIRM",
                                   comment="CERTIFIED有合同/VILLAGE_CONFIRM村委确认/SELF_REPORT自报/SUSPECTED存疑")
    is_active            = Column(SmallInteger, nullable=False, default=1, comment="1有效 0无效")
    affect_subsidy_calc  = Column(SmallInteger, nullable=False, default=1,
                                   comment="1=纳入补贴面积计算/0=仅作记录不影响计算")

    note                 = Column(Text, nullable=True, comment="备注")
    operator             = Column(String(50), nullable=True, comment="录入人")
    created_at           = Column(DateTime, default=func.now())
    updated_at           = Column(DateTime, default=func.now(), onupdate=func.now())

    # 索引
    __table_args__ = (
        Index('ix_large_farmer_trust_lf_id', 'large_farmer_id'),
        Index('ix_large_farmer_trust_owner_id', 'owner_household_id'),
        Index('ix_large_farmer_trust_year', 'trust_year'),
        Index('ix_large_farmer_trust_land_trust', 'land_trust_id'),
        Index('ix_large_farmer_trust_end_date', 'end_date'),
        Index('ix_large_farmer_trust_parcel_village', 'parcel_village_id'),
    )

    # 关联
    large_farmer = relationship("LargeFarmer", back_populates="trust_relations")
    owner_household = relationship("FamilyHousehold", foreign_keys=[owner_household_id])
    land_trust = relationship("LandTrust")
    parcel_village = relationship("Village", foreign_keys=[parcel_village_id])


class LargeFarmerContractReminder(Base):
    """
    大户合同到期提醒记录表
    """
    __tablename__ = "large_farmer_contract_reminder"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    trust_id            = Column(Integer, ForeignKey("large_farmer_trust.id"), nullable=False,
                                  comment="代耕代种记录ID")
    large_farmer_id     = Column(Integer, ForeignKey("large_farmer.id"), nullable=False,
                                  comment="大户ID")
    reminder_type       = Column(String(20), nullable=False,
                                  comment="EXPIRING即将到期/EXPIRED已到期")
    reminder_date       = Column(Date, nullable=False, comment="提醒日期")
    contract_end_date   = Column(Date, nullable=False, comment="合同到期日期")
    days_before         = Column(SmallInteger, nullable=True, comment="提前天数")
    is_sent             = Column(SmallInteger, nullable=False, default=0, comment="是否已发送")
    sent_at             = Column(DateTime, nullable=True, comment="发送时间")
    note                = Column(Text, nullable=True, comment="备注")
    created_at          = Column(DateTime, default=func.now())
