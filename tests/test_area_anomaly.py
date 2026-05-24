"""
面积异常检测函数 check_area_anomaly 的单元测试

运行方式：
    cd d:\Tools\SubSidySystem
    python -m pytest tests/test_area_anomaly.py -v
    或
    python -m pytest tests/test_area_anomaly.py -v --tb=short
"""

import sys
import os

# 确保能导入项目根目录的模块
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils import check_area_anomaly
import pytest


# ═══════════════════════════════════════════
# 1. 基础场景：无异常
# ═══════════════════════════════════════════

def test_no_anomaly_when_within_limits():
    """Excel承包面积 = DB承包面积，未超限 → 无异常"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=5.0,
    )
    assert result["anomaly_type"] is None
    assert result["exceed_amount"] == 0.0


def test_no_anomaly_when_both_none():
    """两项均为 None → 无异常"""
    result = check_area_anomaly(
        excel_contract_area=None,
        db_contract_area=None,
        apply_area=None,
    )
    assert result["anomaly_type"] is None


def test_no_anomaly_when_excel_none():
    """Excel 面积为 None → 无异常"""
    result = check_area_anomaly(
        excel_contract_area=None,
        db_contract_area=5.0,
        apply_area=None,
    )
    assert result["anomaly_type"] is None


# ═══════════════════════════════════════════
# 2. 面积不一致检查（情况A）
# ═══════════════════════════════════════════

def test_contract_mismatch():
    """Excel填报承包面积 ≠ DB承包面积 → 标记不一致"""
    result = check_area_anomaly(
        excel_contract_area=6.0,
        db_contract_area=5.0,
        apply_area=6.0,
        actual_subsidy_area=5.0,
    )
    assert result["anomaly_type"] == "承包面积不一致"
    assert "Excel填报6.0亩，数据库登记5.0亩" in result["anomaly_details"]


def test_contract_mismatch_small_diff():
    """微小差异(<0.001)不算不一致"""
    result = check_area_anomaly(
        excel_contract_area=5.0005,
        db_contract_area=5.0,
        apply_area=5.0005,
        actual_subsidy_area=5.0,
    )
    assert result["anomaly_type"] is None


# ═══════════════════════════════════════════
# 3. 单行超限检查
# ═══════════════════════════════════════════

def test_single_row_exceed():
    """单行申报面积 > DB承包面积 → 面积超限"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=10.0,
        actual_subsidy_area=10.0,
    )
    assert result["anomaly_type"] == "面积超限"
    assert result["exceed_amount"] == 5.0
    assert "单行超限" in result["anomaly_details"][0]


def test_single_row_exact_no_exceed():
    """单行申报面积 = DB承包面积 → 不超限"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=5.0,
    )
    assert result["anomaly_type"] is None


def test_single_row_below_no_exceed():
    """单行申报面积 < DB承包面积 → 不超限"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=3.0,
        actual_subsidy_area=3.0,
    )
    assert result["anomaly_type"] is None


# ═══════════════════════════════════════════
# 4. 户级累计超限（情况B）
# ═══════════════════════════════════════════

def test_cumulative_exceed_no_farmland():
    """户级累计超限，无耕地地力保护补贴面积 → 使用承包面积作为参考"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=3.0,
        season="耕地地力保护",
        hh_used=4.0,  # 户级已有 4 亩
        actual_subsidy_area=3.0,
    )
    # hh_total = 4 + 3 = 7 > 5 → 超限
    assert result["anomaly_type"] == "面积超限"
    assert "累计超限" in result["anomaly_details"][0]
    assert result["hh_total"] == 7.0


def test_cumulative_exceed_with_farmland():
    """大春/小春：户级累计 > 耕地地力保护补贴面积 → 超限"""
    result = check_area_anomaly(
        excel_contract_area=6.0,
        db_contract_area=6.0,  # 承包面积 6
        apply_area=6.0,
        season="小春",
        hh_used=5.0,  # 已有 5 亩
        farmland_protection_area=8.0,  # 耕地补贴 8 亩
        actual_subsidy_area=6.0,
    )
    # hh_total = 5 + 6 = 11 > 8 → 超限（参考耕地补贴而不是承包面积）
    assert result["anomaly_type"] == "面积超限"
    assert "参考耕地地力保护补贴面积:8.0亩" in result["anomaly_details"][0]
    assert result["exceed_amount"] == 3.0  # 11 - 8


def test_cumulative_within_farmland():
    """大春/小春：户级累计 <= 耕地地力保护补贴面积 → 不超限"""
    result = check_area_anomaly(
        excel_contract_area=3.0,
        db_contract_area=3.0,
        apply_area=3.0,
        season="大春",
        hh_used=4.0,  # 已有 4 亩
        farmland_protection_area=8.0,  # 耕地补贴 8 亩
        actual_subsidy_area=3.0,
    )
    # hh_total = 4 + 3 = 7 ≤ 8 → 不超限
    assert result["anomaly_type"] is None


def test_cumulative_exceed_farmland_zero():
    """大春/小春：耕地地力保护补贴面积为 0 → 回退承包面积继续检查"""
    result = check_area_anomaly(
        excel_contract_area=3.0,
        db_contract_area=3.0,
        apply_area=3.0,
        season="小春",
        hh_used=2.0,
        farmland_protection_area=0.0,
        actual_subsidy_area=3.0,
    )
    # 回退使用 db_c=3.0 作为参考 → hh_total=2+3=5 > 3 → 超限
    assert result["anomaly_type"] == "面积超限"
    assert "回退使用承包面积" in result["anomaly_details"][0]
    assert "累计超限" in result["anomaly_details"][1]


def test_cumulative_no_season():
    """无 season 参数 → 不检查户级累计"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=3.0,
        season=None,
        hh_used=10.0,
        actual_subsidy_area=3.0,
    )
    assert result["anomaly_type"] is None


def test_cumulative_invalid_season():
    """非季节类补贴 → 不检查户级累计"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=3.0,
        season="其他",
        hh_used=10.0,
        actual_subsidy_area=3.0,
    )
    assert result["anomaly_type"] is None


# ═══════════════════════════════════════════
# 5. 组合场景：多种异常同时出现
# ═══════════════════════════════════════════

def test_mismatch_and_exceed():
    """承包面积不一致 + 单行超限"""
    result = check_area_anomaly(
        excel_contract_area=8.0,
        db_contract_area=5.0,
        apply_area=8.0,
    )
    assert "承包面积不一致" in result["anomaly_type"]
    assert "面积超限" in result["anomaly_type"]


def test_mismatch_and_cumulative_exceed():
    """承包面积不一致 + 户级累计超限"""
    result = check_area_anomaly(
        excel_contract_area=6.0,
        db_contract_area=5.0,
        apply_area=6.0,
        season="耕地地力保护",
        hh_used=4.0,
    )
    # 不一致：6 vs 5； 累计：4+6=10 > 5
    assert "承包面积不一致" in result["anomaly_type"]
    assert "面积超限" in result["anomaly_type"]


# ═══════════════════════════════════════════
# 6. 代耕代种/ignore_trust_in 场景
# ═══════════════════════════════════════════

def test_trust_in_reduces_self_occupy():
    """代耕代种进面积应从自有占用中扣除"""
    result = check_area_anomaly(
        excel_contract_area=10.0,
        db_contract_area=8.0,
        apply_area=10.0,
        excel_trust_in=2.0,
        ignore_trust_in=False,
    )
    # self_occupy = 10 - 2 = 8 → 不超过 8 → 无超限
    # 但 contract mismatch: 10 vs 8
    assert result["anomaly_type"] == "承包面积不一致"
    assert result["self_occupy"] == 8.0


def test_trust_in_ignored_by_default():
    """ignore_trust_in=True 时忽略代耕代种"""
    result = check_area_anomaly(
        excel_contract_area=10.0,
        db_contract_area=8.0,
        apply_area=10.0,
        excel_trust_in=2.0,
        ignore_trust_in=True,
    )
    # self_occupy = 10（忽略代耕代种）> 8 → 超限 + 不一致
    assert "面积超限" in result["anomaly_type"]


# ═══════════════════════════════════════════
# 7. 大春/小春特殊场景
# ═══════════════════════════════════════════

def test_dachun_uses_farmland_area():
    """大春使用耕地地力保护补贴面积作为参考上限"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,  # 承包面积 5
        apply_area=5.0,
        season="大春",
        hh_used=6.0,
        farmland_protection_area=8.0,  # 耕地补贴只有 8 亩
        actual_subsidy_area=5.0,
    )
    # hh_total = 6 + 5 = 11 > 8 → 超限（尽管 11 < 20）
    assert result["anomaly_type"] == "面积超限"
    assert "参考耕地地力保护补贴面积:8.0亩" in result["anomaly_details"][0]


def test_xiaochun_uses_farmland_area():
    """小春使用耕地地力保护补贴面积作为参考上限"""
    result = check_area_anomaly(
        excel_contract_area=3.0,
        db_contract_area=3.0,
        apply_area=3.0,
        season="小春",
        hh_used=4.0,
        farmland_protection_area=5.0,
        actual_subsidy_area=3.0,
    )
    # hh_total = 4 + 3 = 7 > 5 → 超限
    assert result["anomaly_type"] == "面积超限"

def test_dachun_without_farmland_fallback_to_contract():
    """大春无耕地保护面积时回退到承包面积"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=3.0,
        season="大春",
        hh_used=3.0,
        farmland_protection_area=None,  # 无耕地补贴数据
        actual_subsidy_area=3.0,
    )
    # hh_total = 3+3=6 > 5 → 超限（参考承包面积）
    assert result["anomaly_type"] == "面积超限"
    assert "累计超限" in result["anomaly_details"][1]


def test_dachun_all_within_farmland():
    """大春各种面积均在限额内 → 无异常"""
    result = check_area_anomaly(
        excel_contract_area=2.0,
        db_contract_area=2.0,
        apply_area=2.0,
        season="大春",
        hh_used=3.0,
        farmland_protection_area=10.0,
    )
    # hh_total=5 < 10, 单价不超限 → 无异常
    assert result["anomaly_type"] is None


# ═══════════════════════════════════════════
# 8. 边界场景
# ═══════════════════════════════════════════

def test_excel_zero_db_positive():
    """Excel填报为0，DB有面积 → 承包面积不一致"""
    result = check_area_anomaly(
        excel_contract_area=0.0,
        db_contract_area=5.0,
        apply_area=0.0,
    )
    assert result["anomaly_type"] == "承包面积不一致"


def test_excel_positive_db_zero():
    """Excel有面积，DB为0 → 承包面积不一致（但不超限）"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=0.0,
        apply_area=5.0,
    )
    assert result["anomaly_type"] == "承包面积不一致"
    # db_c > 0 为 False，所以不会单行超限


def test_excel_positive_db_zero_with_farmland():
    """Excel有面积，DB为0，有耕地保护面积 → 累计超限"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=0.0,
        apply_area=5.0,
        season="小春",
        hh_used=6.0,
        farmland_protection_area=8.0,
    )
    # 不一致标记 + hh_total=11 > 8 → 累计超限
    assert result["anomaly_type"] is not None
    assert "承包面积不一致" in result["anomaly_type"]


def test_excel_zero_db_zero():
    """Excel和DB都为0 → 无异常（无数据可比较）"""
    result = check_area_anomaly(
        excel_contract_area=0.0,
        db_contract_area=0.0,
        apply_area=0.0,
        season="小春",
        hh_used=0.0,
        farmland_protection_area=5.0,
    )
    assert result["anomaly_type"] is None


def test_negative_area_does_not_crash():
    """负面积不会导致崩溃（异常数据容错）"""
    result = check_area_anomaly(
        excel_contract_area=-1.0,
        db_contract_area=5.0,
        apply_area=-1.0,
    )
    # -1 vs 5 → 不一致
    assert result["anomaly_type"] == "承包面积不一致"


# ═══════════════════════════════════════════
# 9. 返回值完整性验证
# ═══════════════════════════════════════════

def test_return_keys():
    """验证返回值包含所有必需的字段"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=5.0,
        season="小春",
        hh_used=2.0,
        farmland_protection_area=10.0,
    )
    required_keys = [
        "anomaly_type", "anomaly_details", "exceed_amount",
        "self_occupy", "hh_total", "final_subsidy",
        "db_contract_area", "hh_used", "reference_area", "area_source",
    ]
    for key in required_keys:
        assert key in result, f"缺少返回值: {key}"


def test_return_values_correct():
    """验证返回值计算的正确性"""
    result = check_area_anomaly(
        excel_contract_area=5.0,
        db_contract_area=5.0,
        apply_area=5.0,
        season="小春",
        hh_used=3.0,
        farmland_protection_area=6.0,
    )
    # hh_total=8, reference=6, exceed=2
    # self_occupy=5, final_subsidy=5
    assert result["self_occupy"] == 5.0
    assert result["hh_used"] == 3.0
    assert result["hh_total"] == 8.0
    assert result["final_subsidy"] == 5.0
    assert result["reference_area"] == 6.0
    assert result["area_source"] == "耕地地力保护补贴面积"
    assert result["exceed_amount"] == 2.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
