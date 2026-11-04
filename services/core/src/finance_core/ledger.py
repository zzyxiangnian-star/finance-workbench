"""记账核心：科目、凭证、审核、记账、结账、余额。

硬规则写在这里而不是界面里，任何入口（界面、AI 工具、导入）都绕不过：
- 凭证借贷必须平衡，至少两行，每行只能借或贷一方有金额，科目必须是启用的末级科目。
- 只有草稿可以修改、删除。
- 审核人不能是制单人；AI（actor 以 "ai:" 开头）不能审核、记账、结账。
- 只有已审核的凭证可以记账；已记账的凭证不能反审核（第一期不做反记账，改错走红字/补充凭证）。
- 结账要求本期没有未记账凭证；已结账期间不能新增、修改凭证。
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import date as Date, datetime, timezone

from .money import to_cents, to_yuan


class LedgerError(Exception):
    """业务规则错误。code 给界面和 AI 判断用，message 给人看。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


AI_PREFIX = "ai:"


def is_ai(actor: str) -> bool:
    return actor.startswith(AI_PREFIX)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class LineInput:
    summary: str
    account_code: str
    debit: str = "0"
    credit: str = "0"


@dataclass
class VoucherInput:
    date: str  # YYYY-MM-DD
    lines: list[LineInput]
    word: str = "记"
    attachments: int = 0
    note: str = ""
    source: str = "manual"
    period: str | None = None  # 不传则取 date 所在月


@dataclass
class Ledger:
    conn: sqlite3.Connection

    # ---------- 基础 ----------
    def _tx(self):
        conn = self.conn

        class _T:
            def __enter__(s):
                conn.execute("BEGIN IMMEDIATE")

            def __exit__(s, exc_type, exc, tb):
                conn.execute("ROLLBACK" if exc_type else "COMMIT")
                return False

        return _T()

    def _log(self, actor: str, action: str, target: str, detail: dict | str = ""):
        if isinstance(detail, dict):
            detail = json.dumps(detail, ensure_ascii=False)
        self.conn.execute(
            "INSERT INTO audit_log(at, actor, action, target, detail) VALUES (?,?,?,?,?)",
            (_now(), actor, action, target, detail),
        )

    # ---------- 科目 ----------
    def add_account(self, code, name, category, direction, parent_code=None):
        self.conn.execute(
            "INSERT INTO accounts(code, name, category, direction, parent_code) VALUES (?,?,?,?,?)",
            (code, name, category, direction, parent_code),
        )

    def list_accounts(self, include_disabled=False) -> list[dict]:
        sql = """SELECT a.*, NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_code = a.code) AS is_leaf
                 FROM accounts a"""
        if not include_disabled:
            sql += " WHERE a.enabled = 1"
        rows = self.conn.execute(sql + " ORDER BY a.code").fetchall()
        return [dict(r) | {"is_leaf": bool(r["is_leaf"]), "enabled": bool(r["enabled"])} for r in rows]

    def _check_account(self, code: str) -> sqlite3.Row:
        row = self.conn.execute(
            """SELECT a.*, EXISTS (SELECT 1 FROM accounts c WHERE c.parent_code = a.code) AS has_child
               FROM accounts a WHERE code = ?""",
            (code,),
        ).fetchone()
        if row is None:
            raise LedgerError("account_not_found", f"科目 {code} 不存在")
        if not row["enabled"]:
            raise LedgerError("account_disabled", f"科目 {code} {row['name']} 已停用")
        if row["has_child"]:
            raise LedgerError("account_not_leaf", f"科目 {code} {row['name']} 有下级科目，请用末级科目")
        return row

    # ---------- 期间 ----------
    def ensure_period(self, period: str):
        self.conn.execute("INSERT OR IGNORE INTO periods(period) VALUES (?)", (period,))

    def _check_period_open(self, period: str):
        row = self.conn.execute("SELECT status FROM periods WHERE period = ?", (period,)).fetchone()
        if row and row["status"] == "closed":
            raise LedgerError("period_closed", f"{period} 已结账，不能再改动凭证")

    def list_periods(self) -> list[dict]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM periods ORDER BY period")]

    def close_period(self, period: str, actor: str):
        if is_ai(actor):
            raise LedgerError("ai_forbidden", "结账必须由人操作")
        with self._tx():
            self._check_period_open(period)
            pending = self.conn.execute(
                "SELECT COUNT(*) FROM vouchers WHERE period = ? AND status != 'posted'", (period,)
            ).fetchone()[0]
            if pending:
                raise LedgerError("period_has_unposted", f"{period} 还有 {pending} 张凭证未记账，不能结账")
            self.ensure_period(period)
            self.conn.execute(
                "UPDATE periods SET status='closed', closed_by=?, closed_at=? WHERE period=?",
                (actor, _now(), period),
            )
            self._log(actor, "close_period", period)

    # ---------- 凭证 ----------
    def _validate(self, v: VoucherInput) -> tuple[str, list[tuple]]:
        try:
            d = Date.fromisoformat(v.date)
        except ValueError:
            raise LedgerError("bad_date", f"日期格式不对：{v.date}，应为 YYYY-MM-DD")
        period = v.period or f"{d.year:04d}-{d.month:02d}"
        if not v.date.startswith(period):
            raise LedgerError("date_outside_period", f"日期 {v.date} 不在期间 {period} 内")
        if v.source not in ("manual", "ai", "import"):
            raise LedgerError("bad_source", f"来源不对：{v.source}")
        if len(v.lines) < 2:
            raise LedgerError("too_few_lines", "凭证至少要两行分录")
        rows, dr, cr = [], 0, 0
        for i, ln in enumerate(v.lines, 1):
            if not ln.summary.strip():
                raise LedgerError("empty_summary", f"第 {i} 行缺少摘要")
            self._check_account(ln.account_code)
            d_c, c_c = to_cents(ln.debit), to_cents(ln.credit)
            if d_c < 0 or c_c < 0:
                raise LedgerError("negative_amount", f"第 {i} 行金额为负；红字冲销第一期请用反方向分录")
            if (d_c > 0) == (c_c > 0):
                raise LedgerError("line_one_side", f"第 {i} 行必须且只能在借方或贷方填金额")
            dr, cr = dr + d_c, cr + c_c
            rows.append((i, ln.summary.strip(), ln.account_code, d_c, c_c))
        if dr != cr:
            raise LedgerError(
                "unbalanced", f"借贷不平衡：借方合计 {to_yuan(dr)}，贷方合计 {to_yuan(cr)}，差额 {to_yuan(dr - cr)}"
            )
        return period, rows

    def create_voucher(self, v: VoucherInput, actor: str) -> dict:
        if is_ai(actor) and v.source != "ai":
            v.source = "ai"
        period, rows = self._validate(v)
        with self._tx():
            self._check_period_open(period)
            self.ensure_period(period)
            number = self.conn.execute(
                "SELECT COALESCE(MAX(number), 0) + 1 FROM vouchers WHERE period = ? AND word = ?",
                (period, v.word),
            ).fetchone()[0]
            now = _now()
            cur = self.conn.execute(
                """INSERT INTO vouchers(period, word, number, date, attachments, source, maker, note, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (period, v.word, number, v.date, v.attachments, v.source, actor, v.note, now, now),
            )
            vid = cur.lastrowid
            self.conn.executemany(
                "INSERT INTO voucher_lines(voucher_id, line_no, summary, account_code, debit_cents, credit_cents) VALUES (?,?,?,?,?,?)",
                [(vid, *r) for r in rows],
            )
            self._log(actor, "create_voucher", f"voucher:{vid}", {"source": v.source})
        return self.get_voucher(vid)

    def update_voucher(self, vid: int, v: VoucherInput, actor: str) -> dict:
        cur = self._get_row(vid)
        if cur["status"] != "draft":
            raise LedgerError("not_draft", "只有草稿凭证可以修改，请先反审核")
        period, rows = self._validate(v)
        if period != cur["period"]:
            raise LedgerError("period_change", "不能把凭证改到其他期间，请删除后重建")
        with self._tx():
            self._check_period_open(period)
            self.conn.execute(
                "UPDATE vouchers SET date=?, attachments=?, note=?, updated_at=? WHERE id=?",
                (v.date, v.attachments, v.note, _now(), vid),
            )
            self.conn.execute("DELETE FROM voucher_lines WHERE voucher_id = ?", (vid,))
            self.conn.executemany(
                "INSERT INTO voucher_lines(voucher_id, line_no, summary, account_code, debit_cents, credit_cents) VALUES (?,?,?,?,?,?)",
                [(vid, *r) for r in rows],
            )
            self._log(actor, "update_voucher", f"voucher:{vid}")
        return self.get_voucher(vid)

    def delete_voucher(self, vid: int, actor: str):
        cur = self._get_row(vid)
        if cur["status"] != "draft":
            raise LedgerError("not_draft", "只有草稿凭证可以删除")
        with self._tx():
            self._check_period_open(cur["period"])
            self.conn.execute("DELETE FROM vouchers WHERE id = ?", (vid,))
            self._log(actor, "delete_voucher", f"voucher:{vid}", {"number": f"{cur['word']}-{cur['number']}"})

    def review(self, vid: int, actor: str) -> dict:
        if is_ai(actor):
            raise LedgerError("ai_forbidden", "审核必须由人操作")
        cur = self._get_row(vid)
        if cur["status"] != "draft":
            raise LedgerError("bad_status", "只有草稿凭证可以审核")
        if cur["maker"] == actor:
            raise LedgerError("self_review", "审核人不能是制单人")
        with self._tx():
            self._check_period_open(cur["period"])
            self.conn.execute(
                "UPDATE vouchers SET status='reviewed', reviewer=?, updated_at=? WHERE id=? AND status='draft'",
                (actor, _now(), vid),
            )
            self._log(actor, "review", f"voucher:{vid}")
        return self.get_voucher(vid)

    def unreview(self, vid: int, actor: str) -> dict:
        if is_ai(actor):
            raise LedgerError("ai_forbidden", "反审核必须由人操作")
        cur = self._get_row(vid)
        if cur["status"] != "reviewed":
            raise LedgerError("bad_status", "只有已审核、未记账的凭证可以反审核")
        if cur["reviewer"] != actor:
            raise LedgerError("not_reviewer", "只有原审核人可以反审核")
        with self._tx():
            self._check_period_open(cur["period"])
            self.conn.execute(
                "UPDATE vouchers SET status='draft', reviewer=NULL, updated_at=? WHERE id=?", (_now(), vid)
            )
            self._log(actor, "unreview", f"voucher:{vid}")
        return self.get_voucher(vid)

    def post(self, vid: int, actor: str) -> dict:
        if is_ai(actor):
            raise LedgerError("ai_forbidden", "记账必须由人操作")
        cur = self._get_row(vid)
        if cur["status"] != "reviewed":
            raise LedgerError("bad_status", "只有已审核的凭证可以记账")
        with self._tx():
            self._check_period_open(cur["period"])
            self.conn.execute(
                "UPDATE vouchers SET status='posted', poster=?, updated_at=? WHERE id=?", (actor, _now(), vid)
            )
            self._log(actor, "post", f"voucher:{vid}")
        return self.get_voucher(vid)

    def _get_row(self, vid: int) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM vouchers WHERE id = ?", (vid,)).fetchone()
        if row is None:
            raise LedgerError("voucher_not_found", f"凭证 {vid} 不存在")
        return row

    def get_voucher(self, vid: int) -> dict:
        row = self._get_row(vid)
        lines = self.conn.execute(
            """SELECT l.*, a.name AS account_name FROM voucher_lines l
               JOIN accounts a ON a.code = l.account_code
               WHERE voucher_id = ? ORDER BY line_no""",
            (vid,),
        ).fetchall()
        total = sum(l["debit_cents"] for l in lines)
        return {
            **{k: row[k] for k in row.keys()},
            "display_no": f"{row['word']}-{row['number']:04d}",
            "total": to_yuan(total),
            "lines": [
                {
                    "line_no": l["line_no"],
                    "summary": l["summary"],
                    "account_code": l["account_code"],
                    "account_name": l["account_name"],
                    "debit": to_yuan(l["debit_cents"]),
                    "credit": to_yuan(l["credit_cents"]),
                }
                for l in lines
            ],
        }

    def search_vouchers(
        self,
        period: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        status: str | None = None,
        keyword: str | None = None,
        account_code: str | None = None,
        min_amount: str | None = None,
        max_amount: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        where, args = [], []
        if period:
            where.append("v.period = ?"); args.append(period)
        if date_from:
            where.append("v.date >= ?"); args.append(date_from)
        if date_to:
            where.append("v.date <= ?"); args.append(date_to)
        if status:
            where.append("v.status = ?"); args.append(status)
        if keyword:
            where.append("EXISTS (SELECT 1 FROM voucher_lines k JOIN accounts ka ON ka.code=k.account_code "
                         "WHERE k.voucher_id=v.id AND (k.summary LIKE ? OR ka.name LIKE ?))")
            args += [f"%{keyword}%", f"%{keyword}%"]
        if account_code:
            where.append("EXISTS (SELECT 1 FROM voucher_lines k WHERE k.voucher_id=v.id AND k.account_code LIKE ?)")
            args.append(f"{account_code}%")
        having = []
        if min_amount:
            having.append("total_cents >= ?"); args_h = [to_cents(min_amount)]
        else:
            args_h = []
        if max_amount:
            having.append("total_cents <= ?"); args_h.append(to_cents(max_amount))
        sql = f"""SELECT v.id, (SELECT COALESCE(SUM(debit_cents),0) FROM voucher_lines WHERE voucher_id=v.id) AS total_cents
                  FROM vouchers v {'WHERE ' + ' AND '.join(where) if where else ''}"""
        if having:
            sql = f"SELECT * FROM ({sql}) WHERE {' AND '.join(having)}"
        count = self.conn.execute(f"SELECT COUNT(*) FROM ({sql})", args + args_h).fetchone()[0]
        ids = [
            r["id"]
            for r in self.conn.execute(
                f"SELECT s.id FROM ({sql}) s JOIN vouchers v ON v.id = s.id ORDER BY v.date, v.word, v.number LIMIT ? OFFSET ?",
                args + args_h + [min(limit, 500), offset],
            )
        ]
        return {"total": count, "items": [self.get_voucher(i) for i in ids]}

    # ---------- 余额 ----------
    def set_opening_balance(self, account_code: str, period: str, amount: str, actor: str):
        self._check_account(account_code)
        self.conn.execute(
            "INSERT INTO opening_balances(account_code, period, cents) VALUES (?,?,?) "
            "ON CONFLICT(account_code, period) DO UPDATE SET cents = excluded.cents",
            (account_code, period, to_cents(amount)),
        )
        self._log(actor, "set_opening", f"account:{account_code}", {"period": period, "amount": amount})

    def trial_balance(self, period: str, include_unposted: bool = False) -> dict:
        """科目余额表：期初、本期借方、本期贷方、期末（按科目余额方向，末级科目）。
        第一期：期初 = 最早期初余额 + 本期之前的发生额。"""
        statuses = ("posted", "reviewed", "draft") if include_unposted else ("posted",)
        ph = ",".join("?" * len(statuses))
        rows = self.conn.execute(
            f"""
            SELECT a.code, a.name, a.direction,
              COALESCE((SELECT SUM(cents) FROM opening_balances o WHERE o.account_code=a.code AND o.period<=?),0) AS ob,
              COALESCE(SUM(CASE WHEN v.period < ? THEN l.debit_cents END),0)  AS pre_dr,
              COALESCE(SUM(CASE WHEN v.period < ? THEN l.credit_cents END),0) AS pre_cr,
              COALESCE(SUM(CASE WHEN v.period = ? THEN l.debit_cents END),0)  AS dr,
              COALESCE(SUM(CASE WHEN v.period = ? THEN l.credit_cents END),0) AS cr
            FROM accounts a
            LEFT JOIN voucher_lines l ON l.account_code = a.code
            LEFT JOIN vouchers v ON v.id = l.voucher_id AND v.status IN ({ph})
            WHERE NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_code = a.code)
            GROUP BY a.code ORDER BY a.code""",
            (period, period, period, period, period, *statuses),
        ).fetchall()
        items, sums = [], {"dr": 0, "cr": 0, "ob_dr": 0, "ob_cr": 0, "cb_dr": 0, "cb_cr": 0}
        for r in rows:
            sign = 1 if r["direction"] == "debit" else -1
            opening = r["ob"] + sign * (r["pre_dr"] - r["pre_cr"])
            closing = opening + sign * (r["dr"] - r["cr"])
            if not (opening or r["dr"] or r["cr"] or closing):
                continue
            side = "ob_dr" if (opening * sign) >= 0 else "ob_cr"
            sums[side] += abs(opening)
            side = "cb_dr" if (closing * sign) >= 0 else "cb_cr"
            sums[side] += abs(closing)
            sums["dr"] += r["dr"]; sums["cr"] += r["cr"]
            items.append({
                "account_code": r["code"], "account_name": r["name"], "direction": r["direction"],
                "opening": to_yuan(opening), "debit": to_yuan(r["dr"]),
                "credit": to_yuan(r["cr"]), "closing": to_yuan(closing),
            })
        return {
            "period": period,
            "include_unposted": include_unposted,
            "items": items,
            "totals": {k: to_yuan(v) for k, v in sums.items()},
            "balanced": sums["dr"] == sums["cr"] and sums["cb_dr"] == sums["cb_cr"],
        }

    def account_balance(self, account_code: str, period: str, include_unposted: bool = False) -> dict:
        """单个科目（可为上级科目，汇总下级）的余额。"""
        acc = self.conn.execute("SELECT * FROM accounts WHERE code = ?", (account_code,)).fetchone()
        if acc is None:
            raise LedgerError("account_not_found", f"科目 {account_code} 不存在")
        tb = self.trial_balance(period, include_unposted)
        sign_of = {"debit": 1, "credit": -1}
        # 把下级科目按本科目方向折算后汇总
        sub = [i for i in tb["items"] if i["account_code"].startswith(account_code)]
        sa = sign_of[acc["direction"]]
        def sumf(field):
            return sum(to_cents(i[field]) * sign_of[i["direction"]] * sa for i in sub)
        return {
            "account_code": account_code, "account_name": acc["name"], "direction": acc["direction"],
            "period": period, "include_unposted": include_unposted,
            "opening": to_yuan(sumf("opening")),
            "debit": to_yuan(sum(to_cents(i["debit"]) for i in sub)),
            "credit": to_yuan(sum(to_cents(i["credit"]) for i in sub)),
            "closing": to_yuan(sumf("closing")),
        }

    def audit_log(self, target: str | None = None, limit: int = 100) -> list[dict]:
        if target:
            q = self.conn.execute("SELECT * FROM audit_log WHERE target=? ORDER BY id DESC LIMIT ?", (target, limit))
        else:
            q = self.conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in q]
