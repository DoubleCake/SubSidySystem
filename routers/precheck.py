"""
数据预检查路由
功能：
  1. 接收前端上传的 Excel 数据（已由前端 xlsx 解析为 JSON）
  2. 逐行进行格式校验（姓名、身份证、村、组）
  3. 与数据库现有数据比对，找出：新增农户、减少农户、字段变更、村组不存在等问题
  4. 将检查结果按问题类型分类返回，前端可导出 Excel 报告
"""

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Any, Dict, List
from urllib.parse import quote
from datetime import datetime

from database import get_db
from export_utils import export_precheck_report, export_precheck_report_with_options
from services.precheck_service import PreCheckRunner

router = APIRouter(prefix="/api/precheck", tags=["数据预检查"])


# ─────────────────────────────────────
#  请求 / 响应数据结构
# ─────────────────────────────────────

class PreCheckRow(BaseModel):
    
    """Excel 中的单行数据（前端解析后传入）"""
    row_index: int                          # Excel 行号（从2开始，含表头）
    real_name: Optional[str] = None         # 姓名
    id_card: Optional[str] = None           # 身份证号
    village_name: Optional[str] = None      # 村名
    group_no: Optional[str] = None          # 组号
    phone: Optional[str] = None             # 手机号（可选）
    bank_card: Optional[str] = None         # 银行卡（可选）
    bank_name: Optional[str] = None         # 开户行（可选）
    actual_subsidy_area: Optional[float] = None # 实际补贴面积（亩，由申报方直接填写）
    contract_area: Optional[float] = None      # 承包地总面积（亩）---主要是一个记录 不一定准确
    trust_area: Optional[float] = None         # 流转出面积（亩，给出去的）
    trust_in_area: Optional[float] = None      # 代耕代种进面积（亩，接收进来的）
    no_subsidy_area: Optional[float] = None    # 不补贴面积（亩）
    gender: Optional[str] = None               # 性别（可选，中文）
    address: Optional[str] = None              # 家庭地址（可选）
    remark: Optional[str] = None               # 备注（可选）
    extra: Optional[dict] = None               #

VALID_SEASONS = {"大春", "小春", "全年单补", "临时"}

class PreCheckRequest(BaseModel):
    """预检查请求"""
    rows: list[PreCheckRow]
    season: Optional[str] = None         # 本次导入的补贴分类：大春|小春|全年单补|临时
    compare_year: Optional[int] = None   # 要与哪一年的补贴数据对比（可不传）
    check_options: Optional[dict] = None # 保留字段，控制哪些项目需要检查




# ─────────────────────────────────────
#  主接口：执行预检查
# ─────────────────────────────────────

@router.post("/run")
def run_precheck(req: PreCheckRequest, db: Session = Depends(get_db)):
    """执行完整预检查（业务逻辑由 PreCheckRunner 完成）"""
    runner = PreCheckRunner(db, season=req.season, compare_year=req.compare_year)
    return runner.run([r.model_dump() for r in req.rows])


# ─────────────────────────────────────
#  下载预检查报告模板
# ─────────────────────────────────────

@router.get("/template-headers")
def get_template_headers():
    """
    返回预检查 Excel 模板的列定义，供前端生成下载模板
    带 * 表示必填
    """
    return {
        "headers": [
            "姓名*", "身份证号*", "所在村*", "所在组*",
            "性别", "手机号", "银行卡号", "开户行",
            "承包地面积(亩)", "流转出面积(亩)", "不补贴面积(亩)",
            "家庭地址", "备注"
        ],
        "example": [
            {
                "姓名*": "张国强", "身份证号*": "510123196503154231",
                "所在村*": "红星村", "所在组*": "一组",
                "性别": "男", "手机号": "13812340001",
                "银行卡号": "6222021234560001", "开户行": "农业银行",
                "承包地面积(亩)": 3.5, "流转出面积(亩)": 0.5, "不补贴面积(亩)": 0,
                "家庭地址": "红星村一组12号", "备注": ""
            }
        ]
    }


# ─────────────────────────────────────
#  导出预检查报告（后端生成，样式更美观）
# ─────────────────────────────────────

class ExportPrecheckRequest(BaseModel):
    """导出预检查报告请求"""
    result: Dict[str, Any]
    file_name: Optional[str] = "预检查报告"


class ExportPrecheckWithOptionsRequest(BaseModel):
    """带选项的导出预检查报告请求"""
    result: Dict[str, Any]
    file_name: Optional[str] = "预检查报告"
    split_by_village: Optional[bool] = False
    selected_sheets: Optional[List[str]] = None


@router.post("/export")
def export_precheck(req: ExportPrecheckRequest):
    """
    导出预检查报告（使用 openpyxl 生成，样式更美观）
    接收预检结果，返回 Excel 文件
    """
    output = export_precheck_report(req.result)

    # 生成文件名
    date_str = datetime.now().strftime("%Y-%m-%d")
    file_name = f"{req.file_name}_{date_str}.xlsx"
    encoded_filename = quote(file_name, safe='')

    headers = {
        "Content-Disposition": f"attachment; filename={encoded_filename}; filename*=UTF-8''{encoded_filename}"
    }

    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers
    )


@router.post("/export-with-options")
def export_precheck_with_options(req: ExportPrecheckWithOptionsRequest):
    """
    带选项导出预检查报告
    支持分村导出、选择sheet
    """
    buffer, filename, media_type = export_precheck_report_with_options(
        req.result,
        split_by_village=req.split_by_village or False,
        selected_sheets=req.selected_sheets,
        file_name=req.file_name
    )

    encoded_filename = quote(filename, safe='')
    headers = {
        "Content-Disposition": f"attachment; filename={encoded_filename}; filename*=UTF-8''{encoded_filename}"
    }

    return Response(
        content=buffer.getvalue(),
        media_type=media_type,
        headers=headers
    )


