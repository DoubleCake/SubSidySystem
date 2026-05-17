"""
数据预检查-业务逻辑层

职责：
  - 数据库基础数据加载（村/农户/错误库/面积）
  - 逐行校验逻辑（身份证、姓名、性别、面积、重复等）
  - 与数据库比对（新增/变更/减少农户）
  - 年度补贴对比
  - 家庭户多人申请检测
"""

from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import (
    FarmerProfile, Village, FamilyHousehold,
    SubsidyApplication, SubsidyType, ErrorLibrary,
)
from utils import (
    format_group_no, validate_id_card, parse_gender_from_id,
    check_name, check_phone, check_area_anomaly,
)

VALID_SEASONS = {"大春", "小春", "全年单补", "临时"}


class PreCheckRow:
    """预检单行数据（同前端 PreCheckRow schema）"""

    def __init__(self, row_index: int, real_name: str = None, id_card: str = None,
                 village_name: str = None, group_no: str = None, phone: str = None,
                 bank_card: str = None, bank_name: str = None,
                 actual_subsidy_area: float = None, contract_area: float = None,
                 trust_area: float = None, trust_in_area: float = None,
                 no_subsidy_area: float = None, gender: str = None,
                 address: str = None, remark: str = None, extra: dict = None):
        self.row_index = row_index
        self.real_name = real_name
        self.id_card = id_card
        self.village_name = village_name
        self.group_no = group_no
        self.phone = phone
        self.bank_card = bank_card
        self.bank_name = bank_name
        self.actual_subsidy_area = actual_subsidy_area
        self.contract_area = contract_area
        self.trust_area = trust_area
        self.trust_in_area = trust_in_area
        self.no_subsidy_area = no_subsidy_area
        self.gender = gender
        self.address = address
        self.remark = remark
        self.extra = extra or {}


class PreCheckRunner:
    """
    预检查执行器。
    使用方式：
        runner = PreCheckRunner(db, season="大春", compare_year=2025)
        result = runner.run(rows)
    """

    def __init__(self, db: Session, season: str = None, compare_year: int = None, check_options: dict = None):
        self.db = db
        self.season = (season or "").strip()
        self.compare_year = compare_year
        self.check_options = check_options or {}

        # 以下在 _load_reference_data 中初始化
        self.all_village_names: set[str] = set()
        self.village_name_to_id: dict[str, int] = {}
        self.db_farmers: dict[str, dict] = {}
        self.error_lib: dict[tuple[str, str], ErrorLibrary] = {}
        self.db_land_areas: dict[str, float] = {}
        self.db_household_ids: dict[str, int] = {}
        self.db_hh_season_used: dict[int, float] = {}
        self.db_hh_existing_apps: dict[int, list[dict]] = {}
        self.db_existing_app_id_cards: dict[str, list[dict]] = {}

    def _should(self, check_name: str) -> bool:
        """检查某个检查项是否启用"""
        checks = self.check_options.get("checks", {})
        return checks.get(check_name, True)

    def _load_villages(self):
        """加载村基础数据"""
        villages = self.db.query(Village).all()
        self.all_village_names = {v.village_name for v in villages}
        self.village_name_to_id = {v.village_name: v.id for v in villages}

    def _load_farmers(self):
        """加载数据库中所有在册农户"""
        _own_vid_to_name: dict[int, str] = {
            v.id: v.village_name for v in self.db.query(Village).all()
        }

        def _build_entry(f: FarmerProfile) -> dict:
            hh_village = f.household.village.village_name if f.household and f.household.village else ""
            hh_group = f.household.group_no if f.household else 1
            own_village = _own_vid_to_name.get(f.own_village_id) if f.own_village_id else None
            own_group = f.own_group_no
            eff_village = own_village if own_village else hh_village
            eff_group = own_group if own_group else hh_group
            return {
                "id": f.id,
                "real_name": f.real_name,
                "village_full_name": f"{eff_village}{format_group_no(eff_group)}" if eff_village else "",
                "village_name": eff_village,
                "group_no": eff_group,
                "hh_village_name": hh_village,
                "hh_group_no": hh_group,
                "own_village_name": own_village,
                "own_group_no": own_group,
                "farmer_status": f.farmer_status,
            }

        q = self.db.query(FarmerProfile).outerjoin(
            FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
        ).outerjoin(
            Village, Village.id == FamilyHousehold.village_id
        )
        self.db_farmers = {f.id_card: _build_entry(f) for f in q.all() if f.id_card}

    def _load_error_library(self):
        """加载错误库"""
        self.error_lib = {
            (e.id_card.strip(), e.real_name.strip()): e
            for e in self.db.query(ErrorLibrary).all()
        }

    def _load_land_areas(self):
        """加载农户承包面积和 household_id 映射"""
        for f in self.db.query(FarmerProfile).join(
            FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
        ).all():
            if f.id_card and f.household:
                self.db_household_ids[f.id_card] = f.household_id
                if f.household.contract_area:
                    self.db_land_areas[f.id_card] = float(f.household.contract_area)

    def _load_season_data(self):
        """加载当季已有申请数据"""
        if self.season not in VALID_SEASONS or not self.compare_year:
            return

        # 当季已用面积
        rows_used = self.db.query(
            FarmerProfile.household_id,
            func.sum(SubsidyApplication.apply_area).label("total_area")
        ).join(
            FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id
        ).join(
            SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id
        ).filter(
            SubsidyApplication.apply_year == self.compare_year,
            SubsidyType.season == self.season,
        ).group_by(FarmerProfile.household_id).all()
        self.db_hh_season_used = {r.household_id: float(r.total_area or 0) for r in rows_used}

        # 已有申请记录（按身份证）
        existing_apps = self.db.query(
            FarmerProfile.id_card, FarmerProfile.real_name,
            SubsidyApplication.remark, SubsidyType.subsidy_name,
            SubsidyApplication.pay_status,
        ).join(
            FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id
        ).join(
            SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id
        ).filter(
            SubsidyApplication.apply_year == self.compare_year,
            SubsidyType.season == self.season,
        ).all()

        for app in existing_apps:
            if app.id_card:
                self.db_existing_app_id_cards.setdefault(app.id_card, []).append({
                    "real_name": app.real_name,
                    "subsidy_name": app.subsidy_name,
                    "remark": app.remark,
                    "status": "预申请" if app.pay_status == 0 else "已发放",
                })

        # 已有申请记录（按家庭户）
        existing_apps2 = self.db.query(
            FarmerProfile.household_id, FarmerProfile.real_name,
            FarmerProfile.id_card, SubsidyApplication.remark,
            SubsidyType.subsidy_name, SubsidyType.season,
        ).join(
            FarmerProfile, FarmerProfile.id == SubsidyApplication.farmer_id
        ).join(
            SubsidyType, SubsidyType.id == SubsidyApplication.subsidy_type_id
        ).filter(
            SubsidyApplication.apply_year == self.compare_year,
            SubsidyType.season == self.season,
        ).all()

        for app in existing_apps2:
            if app.household_id:
                self.db_hh_existing_apps.setdefault(app.household_id, []).append({
                    "real_name": app.real_name,
                    "id_card": app.id_card,
                    "remark": app.remark,
                    "subsidy_name": app.subsidy_name,
                    "season": app.season,
                })

    def load_all(self):
        """加载所有参考数据（根据 check_options 按需加载）"""
        if self._should("village"):
            self._load_villages()
        if self._should("db_compare"):
            self._load_farmers()
        if self._should("error_library"):
            self._load_error_library()
        if self._should("area_anomaly") or self._should("duplicate"):
            self._load_land_areas()
        if self._should("area_anomaly") and self.season in VALID_SEASONS:
            self._load_season_data()

    # ── 单行校验 ──

    def _check_village(self, village: str, name: str, id_card: str,
                       group: str, row_no: int, village_errors: list):
        """检查村组是否存在，返回 village_id"""
        if not village:
            return None
        vid = self.village_name_to_id.get(village)
        if not vid:
            similar = [v for v in self.all_village_names if village in v or v in village]
            hint = f"（相近的村名：{'、'.join(similar[:3])}）" if similar else "（数据库中无此村）"
            village_errors.append({
                "row": row_no, "name": name, "id_card": id_card,
                "village": village, "group": group,
                "error": f"村「{village}」在数据库中不存在 {hint}",
            })
        return vid

    def _check_area(self, val, label) -> tuple[float | None, str | None]:
        """解析面积值，返回 (value, error)"""
        if val is None:
            return None, None
        try:
            f = float(val)
            if f < 0:
                return f, f"{label}不能为负数（{f}）"
            return f, None
        except (ValueError, TypeError):
            return None, f"{label}格式错误（{val}）"

    def run(self, rows: list[PreCheckRow | dict]) -> dict:
        """执行完整预检查"""
        self.load_all()

        # 结果容器
        format_errors: list[dict] = []
        village_errors: list[dict] = []
        gender_mismatch: list[dict] = []
        duplicate_errors: list[dict] = []
        db_duplicate_apps: list[dict] = []
        changed_farmers: list[dict] = []
        new_farmers: list[dict] = []
        error_library_hits: list[dict] = []
        area_anomalies: list[dict] = []
        area_missing: list[dict] = []
        age_anomaly: list[dict] = []
        deceased_farmers: list[dict] = []
        household_duplicates: list[dict] = []
        ok_rows: list[dict] = []

        seen_id_cards: dict[str, int] = {}
        seen_household_members: dict[int, list[dict]] = {}

        for row in rows:
            # 兼容 dict 和 PreCheckRow 对象
            if isinstance(row, dict):
                row = PreCheckRow(**{k: v for k, v in row.items() if v is not None or k in ("row_index",)})
            row_errors: list[str] = []
            row_no = row.row_index
            name = (row.real_name or "").strip()
            id_card = (row.id_card or "").strip().upper()
            village = (row.village_name or "").strip()
            group = (row.group_no or "").strip()

            # 姓名检查
            name_ok, name_err = check_name(name)
            if not name_ok:
                row_errors.append(f"姓名错误：{name_err}")

            # 身份证检查
            id_ok, id_err = validate_id_card(id_card)
            if not id_ok:
                row_errors.append(f"身份证错误：{id_err}")

            # 村组检查（可配置跳过）
            village_id = None
            if self._should("village"):
                village_id = self._check_village(village, name, id_card, group, row_no, village_errors)

            # 手机号检查
            if row.phone:
                phone_ok, phone_err = check_phone(str(row.phone))
                if not phone_ok:
                    row_errors.append(phone_err)

            # 面积解析
            contract_area_val, err = self._check_area(row.contract_area, "承包地面积")
            if err:
                row_errors.append(err)
            if contract_area_val is not None and contract_area_val > 9999:
                row_errors.append(f"承包地面积异常偏大（{contract_area_val}亩）")

            trust_area_val, err = self._check_area(row.trust_area, "流转出面积")
            if err:
                row_errors.append(err)
            trust_in_area_val, err = self._check_area(row.trust_in_area, "代耕代种进面积")
            if err:
                row_errors.append(err)
            no_subsidy_area_val, err = self._check_area(row.no_subsidy_area, "不补贴面积")
            if err:
                row_errors.append(err)
            actual_subsidy_area_val, err = self._check_area(row.actual_subsidy_area, "实际补贴面积")
            if err:
                row_errors.append(err)

            # 面积逻辑校验（流转出扣减，可配置跳过）
            if contract_area_val is not None and self.check_options.get("check_trust_deduction", True):
                deduct = (trust_area_val or 0) + (no_subsidy_area_val or 0)
                if deduct > contract_area_val:
                    row_errors.append(
                        f"流转出面积({trust_area_val or 0}亩)+不补贴面积({no_subsidy_area_val or 0}亩)"
                        f"={deduct}亩 超过承包地面积({contract_area_val}亩)"
                    )

            # 格式错误汇总
            if row_errors:
                format_errors.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "errors": row_errors, "error_count": len(row_errors),
                })
                continue

            # Excel 内部重复（可配置跳过）
            if self._should("duplicate"):
                if id_card in seen_id_cards:
                    duplicate_errors.append({
                        "row": row_no, "name": name, "id_card": id_card,
                        "village": village, "group": group,
                        "error": f"身份证号与第{seen_id_cards[id_card]}行重复",
                    })
                    continue
                seen_id_cards[id_card] = row_no

            # 数据库已有申请重复
            if self._should("duplicate") and id_card in self.db_existing_app_id_cards:
                apps_summary = "；".join([
                    f"{a['real_name']}({a['subsidy_name']}-{a['status']})" +
                    (f":{a['remark']}" if a['remark'] else "")
                    for a in self.db_existing_app_id_cards[id_card]
                ])
                db_duplicate_apps.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "existing_apps": apps_summary,
                    "error": f"该人员本年度本季已有申请记录：{apps_summary}",
                })

            # 错误库命中（可配置跳过）
            if self._should("error_library") and (id_card, name) in self.error_lib:
                lib_rec = self.error_lib[(id_card, name)]
                error_library_hits.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "error_type": lib_rec.error_type,
                    "error_reason": lib_rec.error_reason,
                    "source": lib_rec.source,
                })

            # 性别检查（可配置跳过）
            if self._should("gender") and row.gender:
                gid = parse_gender_from_id(id_card)
                gex = 1 if row.gender in ("男", "1", "male") else (2 if row.gender in ("女", "2", "female") else 0)
                if gex != 0 and gid != 0 and gex != gid:
                    gender_mismatch.append({
                        "row": row_no, "name": name, "id_card": id_card,
                        "village": village, "group": group,
                        "excel_gender": row.gender,
                        "id_card_gender": "男" if gid == 1 else "女",
                        "error": f"Excel中性别为「{row.gender}」，但身份证显示为「{'男' if gid == 1 else '女'}」",
                    })

            # 面积异常（可配置跳过，area_mode=disabled 时也不检查）
            if self._should("area_anomaly") and self.check_options.get("area_mode") != "disabled" and contract_area_val is not None and id_card in self.db_land_areas:
                db_contracted = self.db_land_areas[id_card]
                t_out = trust_area_val or 0
                t_in = trust_in_area_val or 0
                ns_area = no_subsidy_area_val or 0
                hh_id = self.db_household_ids.get(id_card)
                hh_used = self.db_hh_season_used.get(hh_id, 0) if hh_id else 0

                anomaly = check_area_anomaly(
                    excel_contract_area=contract_area_val,
                    db_contract_area=db_contracted,
                    apply_area=contract_area_val,
                    excel_trust_out=t_out,
                    excel_trust_in=t_in,
                    excel_no_subsidy=ns_area,
                    actual_subsidy_area=actual_subsidy_area_val,
                    season=self.season if self.season in VALID_SEASONS else None,
                    hh_used=hh_used,
                    ignore_trust_in=True,
                )
                if anomaly["anomaly_type"]:
                    area_anomalies.append({
                        "row": row_no, "name": name, "id_card": id_card,
                        "village": village, "group": group,
                        "anomaly_type": anomaly["anomaly_type"],
                        "anomaly_details": "；".join(anomaly["anomaly_details"]),
                        "contract_area": contract_area_val,
                        "trust_out_area": t_out,
                        "trust_in_area": t_in,
                        "no_subsidy_area": ns_area,
                        "actual_subsidy_area": anomaly.get("final_subsidy", actual_subsidy_area_val),
                        "self_occupy": anomaly["self_occupy"],
                        "hh_used": anomaly["hh_used"],
                        "hh_total": anomaly["hh_total"],
                        "db_contract_area": db_contracted,
                        "exceed_amount": anomaly["exceed_amount"],
                    })

            # 数据库比对（可配置跳过）
            farmer = self.db_farmers.get(id_card) if self._should("db_compare") else None
            if farmer:
                changes = []
                if name != farmer["real_name"]:
                    changes.append(f"姓名：数据库「{farmer['real_name']}」→ Excel「{name}」")
                if changes:
                    changed_farmers.append({
                        "row": row_no, "name": name, "id_card": id_card,
                        "village": village, "group": group,
                        "db_name": farmer["real_name"],
                        "db_village": farmer["village_name"],
                        "db_group": farmer["group_no"],
                        "changes": changes,
                        "farmer_id": farmer["id"],
                    })
                else:
                    ok_rows.append({"row": row_no, "name": name, "id_card": id_card})
            else:
                new_farmers.append({
                    "row": row_no, "name": name, "id_card": id_card,
                    "village": village, "group": group,
                    "village_id": village_id,
                })

            # 家庭户成员跟踪
            household_id = self.db_household_ids.get(id_card)
            if household_id:
                seen_household_members.setdefault(household_id, []).append({
                    "id_card": id_card, "name": name, "row": row_no,
                    "village": village, "group": group, "remark": row.remark,
                })

        # 家庭户多人申请检测
        for household_id, members in seen_household_members.items():
            if len(members) > 1:
                db_existing = self.db_hh_existing_apps.get(household_id, [])
                for m in members:
                    household_duplicates.append({
                        "row": m["row"], "name": m["name"], "id_card": m["id_card"],
                        "village": m["village"], "group": m["group"],
                        "household_id": household_id, "total_count": len(members),
                        "other_members": [mem["name"] for mem in members if mem["id_card"] != m["id_card"]],
                        "excel_remark": m["remark"],
                        "db_existing_apps": db_existing,
                        "error": f"同一家庭户有{len(members)}人同时申请",
                    })

        # 减少的农户
        excel_id_cards = set(seen_id_cards.keys())
        removed_farmers = [
            {
                "id_card": ic, "name": f["real_name"],
                "village": f["village_name"], "group": f["group_no"],
                "farmer_id": f["id"],
                "note": "在数据库中在册，但本次 Excel 中未出现",
            }
            for ic, f in self.db_farmers.items()
            if ic not in excel_id_cards and f["farmer_status"] == 1
        ]

        # 年度对比
        year_compare = self._build_year_compare(excel_id_cards, seen_id_cards)

        # 汇总
        error_rows = (
            len(format_errors) + len(village_errors) + len(duplicate_errors)
            + len(gender_mismatch) + len(error_library_hits) + len(area_anomalies)
            + len(area_missing) + len(age_anomaly) + len(deceased_farmers)
            + len(household_duplicates) + len(db_duplicate_apps)
        )
        total_rows = len(rows)
        summary = {
            "total_rows": total_rows,
            "ok_rows": len(ok_rows),
            "error_rows": error_rows,
            "format_errors": len(format_errors),
            "village_errors": len(village_errors),
            "duplicate_errors": len(duplicate_errors),
            "db_duplicate_apps": len(db_duplicate_apps),
            "gender_mismatch": len(gender_mismatch),
            "error_library_hits": len(error_library_hits),
            "area_anomalies": len(area_anomalies),
            "area_missing": len(area_missing),
            "age_anomaly": len(age_anomaly),
            "deceased_farmers": len(deceased_farmers),
            "household_duplicates": len(household_duplicates),
            "new_farmers": len(new_farmers),
            "removed_farmers": len(removed_farmers),
            "changed_farmers": len(changed_farmers),
            "pass_rate": round((total_rows - error_rows) / total_rows * 100, 1) if total_rows else 0,
        }

        return {
            "summary": summary,
            "format_errors": format_errors,
            "village_errors": village_errors,
            "duplicate_errors": duplicate_errors,
            "db_duplicate_apps": db_duplicate_apps,
            "gender_mismatch": gender_mismatch,
            "error_library_hits": error_library_hits,
            "area_anomalies": area_anomalies,
            "area_missing": area_missing,
            "age_anomaly": age_anomaly,
            "deceased_farmers": deceased_farmers,
            "household_duplicates": household_duplicates,
            "new_farmers": new_farmers,
            "removed_farmers": removed_farmers,
            "changed_farmers": changed_farmers,
            "year_compare": year_compare,
        }

    def _build_year_compare(
        self, excel_id_cards: set[str], seen_id_cards: dict[str, int]
    ) -> dict:
        """年度补贴对比"""
        if not self.compare_year:
            return {}

        apps_this_year = self.db.query(
            FarmerProfile.id_card, FarmerProfile.real_name,
            Village.village_name, FamilyHousehold.group_no
        ).join(
            SubsidyApplication, SubsidyApplication.farmer_id == FarmerProfile.id
        ).join(
            FamilyHousehold, FamilyHousehold.id == FarmerProfile.household_id
        ).join(
            Village, Village.id == FamilyHousehold.village_id
        ).filter(
            SubsidyApplication.apply_year == self.compare_year
        ).distinct().all()

        db_year_ids = {r.id_card for r in apps_this_year}
        db_year_map = {
            r.id_card: {
                "name": r.real_name,
                "village": r.village_name,
                "group": format_group_no(r.group_no) if r.group_no else "一组",
            }
            for r in apps_this_year
        }

        year_new = [
            {"id_card": ic, "name": seen_id_cards.get(ic, ic), "row": seen_id_cards.get(ic)}
            for ic in excel_id_cards if ic not in db_year_ids
        ]
        year_removed = [
            {"id_card": ic, **db_year_map[ic]}
            for ic in db_year_ids if ic not in excel_id_cards
        ]

        return {
            "year": self.compare_year,
            "db_count": len(db_year_ids),
            "excel_count": len(excel_id_cards),
            "new_count": len(year_new),
            "removed_count": len(year_removed),
            "new_farmers": year_new[:200],
            "removed_farmers": year_removed[:200],
        }
