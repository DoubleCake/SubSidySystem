"""
补贴类型预检配置工具
为每种补贴类型生成合理的默认检查配置，
按 calc_mode 决定是否启用面积检查。
"""

import json

# ── 默认检查配置结构 ──

DEFAULT_CHECK_CONFIG: dict = {
    "checks": {
        "format": True,         # 格式检查（姓名/身份证/手机号）
        "village": True,        # 村组存在性
        "duplicate": True,      # Excel 内部重复身份证
        "gender": True,         # 性别一致性
        "error_library": True,  # 错误库命中
        "area_anomaly": True,   # 面积异常
        "db_compare": True,     # 数据库比对（新增/减少/变更）
    },
}


def generate_default_config(
    season: str = "耕地地力保护",
    category: str | None = None,
    calc_mode: str = "fixed",
) -> str:
    """
    根据补贴类型的 season + calc_mode 生成合理的默认检查配置 JSON。
    """
    config = {
        "checks": {
            "format": True,
            "village": True,
            "duplicate": True,
            "gender": True,
            "error_library": True,
            "area_anomaly": True,
            "db_compare": True,
        },
    }

    # 固定金额补贴 → 不检查面积
    if calc_mode == "fixed":
        config["checks"]["area_anomaly"] = False

    return json.dumps(config, ensure_ascii=False)


def parse_check_config(raw: str | None) -> dict:
    """解析 check_config JSON，返回完整配置（缺失 key 用默认值补全）"""
    config = json.loads(raw) if raw else {}
    result = json.loads(json.dumps(DEFAULT_CHECK_CONFIG))
    _deep_merge(result, config)
    return result


def _deep_merge(base: dict, override: dict) -> None:
    """递归合并字典"""
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v
