"""
Excel 导出工具（使用 openpyxl）
提供更美观的样式和更好的格式控制
"""
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment, Protection
from openpyxl.utils import get_column_letter
from typing import Any, Dict, List, Optional


# ─── 样式定义 ───
HEADER_FONT = Font(name="微软雅黑", size=11, bold=True, color="FFFFFF")
HEADER_FILL = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
CELL_FONT = Font(name="微软雅黑", size=10)
CELL_ALIGNMENT = Alignment(horizontal="left", vertical="top", wrap_text=True)
BORDER_THIN = Border(
    left=Side(style="thin", color="D0D0D0"),
    right=Side(style="thin", color="D0D0D0"),
    top=Side(style="thin", color="D0D0D0"),
    bottom=Side(style="thin", color="D0D0D0"),
)
ALTERNATE_FILL = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")


def auto_width(ws, max_width=50):
    """自动调整列宽"""
    for col in ws.columns:
        max_length = 0
        column = col[0].column_letter  # 获取列字母
        for cell in col:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        adjusted_width = min(max_length + 2, max_width)
        ws.column_dimensions[column].width = adjusted_width


def set_row_height(ws, header_height=25, data_height=40):
    """设置行高"""
    ws.row_dimensions[1].height = header_height
    for row in range(2, ws.max_row + 1):
        ws.row_dimensions[row].height = data_height


def apply_styles(ws, has_alternate_rows=True):
    """应用样式到整个工作表"""
    # 表头样式
    for cell in ws[1]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER_THIN

    # 数据行样式
    for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        is_alternate = has_alternate_rows and (row_idx % 2 == 0)
        for cell in row:
            cell.font = CELL_FONT
            cell.alignment = CELL_ALIGNMENT
            cell.border = BORDER_THIN
            if is_alternate:
                cell.fill = ALTERNATE_FILL

    auto_width(ws, max_width=50)
    set_row_height(ws)


def add_summary_sheet(wb: Workbook, summary: Dict[str, Any]):
    """添加汇总表"""
    ws = wb.create_sheet("汇总")

    # 准备数据
    data = [
        ["项目", "数值"],
        ["检查总行数", summary.get("total_rows", 0)],
        ["通过行数", summary.get("ok_rows", 0)],
        ["错误行数", summary.get("error_rows", 0)],
        ["通过率", f"{summary.get('pass_rate', 0)}%"],
        ["格式错误", summary.get("format_errors", 0)],
        ["村组不存在", summary.get("village_errors", 0)],
        ["重复身份证", summary.get("duplicate_errors", 0)],
        ["性别不符", summary.get("gender_mismatch", 0)],
        ["错误库命中", summary.get("error_library_hits", 0)],
        ["面积异常", summary.get("area_anomalies", 0)],
        ["面积缺失", summary.get("area_missing", 0)],
        ["年龄异常", summary.get("age_anomaly", 0)],
        ["死亡农户", summary.get("deceased_farmers", 0)],
        ["家庭重复", summary.get("household_duplicates", 0)],
        ["新增农户", summary.get("new_farmers", 0)],
        ["减少农户", summary.get("removed_farmers", 0)],
        ["字段变更", summary.get("changed_farmers", 0)],
    ]

    for row in data:
        ws.append(row)

    apply_styles(ws, has_alternate_rows=True)
    ws.column_dimensions["A"].width = 15
    ws.column_dimensions["B"].width = 15


def add_sheet_from_data(wb: Workbook, sheet_name: str, headers: List[str], rows: List[Dict[str, Any]]):
    """从数据添加工作表"""
    if not rows:
        return

    ws = wb.create_sheet(sheet_name[:31])

    # 添加表头
    ws.append(headers)

    # 添加数据行
    for row in rows:
        row_data = []
        for h in headers:
            val = row.get(h, "")
            if isinstance(val, (list, tuple)):
                val = "；".join(str(x) for x in val)
            row_data.append(val)
        ws.append(row_data)

    apply_styles(ws, has_alternate_rows=True)


def export_precheck_report(result: Dict[str, Any]) -> BytesIO:
    """
    导出预检报告
    返回 BytesIO 对象，可以直接通过 FastAPI 返回
    """
    wb = Workbook()
    # 删除默认的工作表
    wb.remove(wb.active)

    # 1. 汇总表
    summary = result.get("summary", {})
    add_summary_sheet(wb, summary)

    # 2. 错误库命中
    headers = ["行号", "姓名", "身份证号", "所在村", "所在组", "错误类型", "错误原因", "来源"]
    data = [
        {"行号": r.get("row"), "姓名": r.get("name"), "身份证号": r.get("id_card"),
         "所在村": r.get("village"), "所在组": r.get("group"),
         "错误类型": r.get("error_type"), "错误原因": r.get("error_reason"), "来源": r.get("source")}
        for r in result.get("error_library_hits", [])
    ]
    add_sheet_from_data(wb, "错误库命中", headers, data)

    # 3. 格式错误
    headers = ["行号", "姓名", "身份证号", "所在村", "所在组", "错误内容"]
    data = [
        {"行号": r.get("row"), "姓名": r.get("name"), "身份证号": r.get("id_card"),
         "所在村": r.get("village"), "所在组": r.get("group"),
         "错误内容": "；".join(r["errors"]) if isinstance(r.get("errors"), list) else r.get("errors", "")}
        for r in result.get("format_errors", [])
    ]
    add_sheet_from_data(wb, "格式错误", headers, data)

    # 4. 村组不存在
    headers = ["行号", "姓名", "身份证号", "所在村", "所在组", "错误信息"]
    data = [
        {"行号": r.get("row"), "姓名": r.get("name"), "身份证号": r.get("id_card"),
         "所在村": r.get("village"), "所在组": r.get("group"), "错误信息": r.get("error")}
        for r in result.get("village_errors", [])
    ]
    add_sheet_from_data(wb, "村组不存在", headers, data)

    # 5. 重复身份证
    headers = ["行号", "姓名", "身份证号", "错误信息"]
    data = [
        {"行号": r.get("row"), "姓名": r.get("name"), "身份证号": r.get("id_card"), "错误信息": r.get("error")}
        for r in result.get("duplicate_errors", [])
    ]
    add_sheet_from_data(wb, "重复身份证", headers, data)

    # 6. 性别不符
    headers = ["行号", "姓名", "身份证号", "Excel性别", "身份证性别"]
    data = [
        {"行号": r.get("row"), "姓名": r.get("name"), "身份证号": r.get("id_card"),
         "Excel性别": r.get("excel_gender"), "身份证性别": r.get("id_card_gender")}
        for r in result.get("gender_mismatch", [])
    ]
    add_sheet_from_data(wb, "性别不符", headers, data)

    # 7. 面积异常
    headers = [
        "行号", "姓名", "身份证号", "所在村", "所在组",
        "异常类型", "异常详情",
        "Excel承包地面积", "数据库承包面积", "流转出面积", "代耕代种进",
        "不补贴面积", "实际补贴面积", "自有承包地占用", "户级当季已有申请",
        "户级合计", "超出面积"
    ]
    data = []
    for r in result.get("area_anomalies", []):
        data.append({
            "行号": r.get("row"),
            "姓名": r.get("name"),
            "身份证号": r.get("id_card"),
            "所在村": r.get("village"),
            "所在组": r.get("group"),
            "异常类型": r.get("anomaly_type"),
            "异常详情": r.get("anomaly_details"),
            "Excel承包地面积": r.get("contract_area"),
            "数据库承包面积": r.get("db_contract_area"),
            "流转出面积": r.get("trust_out_area"),
            "代耕代种进": r.get("trust_in_area"),
            "不补贴面积": r.get("no_subsidy_area"),
            "实际补贴面积": r.get("actual_subsidy_area"),
            "自有承包地占用": r.get("self_occupy"),
            "户级当季已有申请": r.get("hh_used"),
            "户级合计": r.get("hh_total"),
            "超出面积": r.get("exceed_amount"),
        })
    add_sheet_from_data(wb, "面积异常", headers, data)

    # 8. 新增农户
    headers = ["行号", "姓名", "身份证号", "所在村", "所在组", "说明"]
    data = []
    for r in result.get("new_farmers", []):
        data.append({
            "行号": r.get("row"),
            "姓名": r.get("name"),
            "身份证号": r.get("id_card"),
            "所在村": r.get("village"),
            "所在组": r.get("group"),
            "说明": "数据库中不存在，将新增",
        })
    add_sheet_from_data(wb, "新增农户", headers, data)

    # 9. 减少农户
    headers = ["姓名", "身份证号", "所在村", "所在组", "说明"]
    data = [
        {"姓名": r.get("name"), "身份证号": r.get("id_card"),
         "所在村": r.get("village"), "所在组": r.get("group"),
         "说明": "有补贴记录但未在本次导入中"}
        for r in result.get("removed_farmers", [])
    ]
    add_sheet_from_data(wb, "减少农户", headers, data)

    # 10. 字段变更
    headers = ["行号", "姓名", "身份证号", "变更内容"]
    data = [
        {"行号": r.get("row"), "姓名": r.get("name"), "身份证号": r.get("id_card"),
         "变更内容": "；".join(r["changes"]) if isinstance(r.get("changes"), list) else r.get("changes", "")}
        for r in result.get("changed_farmers", [])
    ]
    add_sheet_from_data(wb, "字段变更", headers, data)

    # 保存到内存
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output
