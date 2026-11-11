"""明细账、总账和期初余额。规则在这里算，账本连接用 Ledger.conn。"""

from __future__ import annotations

import re

from .ledger import Ledger, LedgerError, is_ai
from .money import MoneyError, to_cents, to_yuan

PERIOD_RE = re.compile(r"^\d{4}-\d{2}$")


def _parse_period(period: str) -> tuple[int, int]:
    if not PERIOD_RE.match(period or ""):
        raise LedgerError("bad_period", f"期间格式应为 YYYY-MM：{period}")
    year, month = int(period[:4]), int(period[5:])
    if month < 1 or month > 12:
        raise LedgerError("bad_period", f"期间格式应为 YYYY-MM：{period}")
    return year, month


def _shift(period: str, months: int) -> str:
    year, month = _parse_period(period)
    index = year * 12 + (month - 1) + months
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _span(start: str, end: str) -> int:
    y1, m1 = _parse_period(start)
    y2, m2 = _parse_period(end)
    return (y2 - y1) * 12 + (m2 - m1) + 1


def _iter_periods(start: str, end: str) -> list[str]:
    if start > end:
        return []
    out = [start]
    cur = start
    while cur < end:
        cur = _shift(cur, 1)
        out.append(cur)
    return out


def _sign(direction: str) -> int:
    return 1 if direction == "debit" else -1


def _side(signed: int) -> str:
    if signed == 0:
        return "flat"
    return "debit" if signed > 0 else "credit"


def _money_pair(signed: int) -> dict:
    return {"side": _side(signed), "amount": to_yuan(abs(signed))}


def _accounts(ledger: Ledger) -> list[dict]:
    return ledger.list_accounts()


def _index(accounts: list[dict]) -> tuple[dict, dict]:
    by = {a["code"]: a for a in accounts}
    children: dict[str | None, list[str]] = {}
    for a in accounts:
        children.setdefault(a["parent_code"], []).append(a["code"])
    return by, children


def _leaves_under(code: str, by: dict, children: dict) -> list[str]:
    if code not in by:
        raise LedgerError("account_not_found", f"科目 {code} 不存在")
    out: list[str] = []

    def walk(c: str) -> None:
        kids = children.get(c, [])
        if not kids:
            out.append(c)
            return
        for k in kids:
            walk(k)

    walk(code)
    return out


def _level(code: str, by: dict) -> int:
    n = 1
    parent = by[code]["parent_code"]
    while parent:
        n += 1
        parent = by[parent]["parent_code"]
    return n


def _stored(ledger: Ledger, start: str) -> tuple[dict[str, int], dict[str, tuple[int, int]]]:
    amounts = {
        r["account_code"]: r["cents"]
        for r in ledger.conn.execute(
            "SELECT account_code, cents FROM opening_balances WHERE period = ?", (start,)
        )
    }
    ytd = {
        r["account_code"]: (r["debit_cents"], r["credit_cents"])
        for r in ledger.conn.execute(
            "SELECT account_code, debit_cents, credit_cents FROM opening_ytd WHERE period = ?", (start,)
        )
    }
    return amounts, ytd


def _roll(codes: list[str], by: dict, children: dict, leaf_value) -> dict[str, int]:
    """leaf_value(code) -> 按该科目方向记的分。上级按方向折算后汇总。"""
    memo: dict[str, int] = {}

    def one(code: str) -> int:
        if code in memo:
            return memo[code]
        kids = children.get(code, [])
        if not kids:
            memo[code] = leaf_value(code)
            return memo[code]
        debit_positive = sum(one(k) * _sign(by[k]["direction"]) for k in kids)
        memo[code] = debit_positive * _sign(by[code]["direction"])
        return memo[code]

    for code in codes:
        one(code)
    return memo


def opening_totals(ledger: Ledger) -> dict:
    """末级科目期初，按方向折成借方合计、贷方合计。算法同 trial_balance 的 ob_dr / ob_cr。"""
    start = ledger.get_start_period()
    accounts = _accounts(ledger)
    by, children = _index(accounts)
    amounts, _ytd = _stored(ledger, start)
    dr = cr = 0
    for a in accounts:
        if children.get(a["code"]):
            continue
        cents = amounts.get(a["code"], 0)
        natural = cents * _sign(a["direction"])
        if natural >= 0:
            dr += abs(cents)
        else:
            cr += abs(cents)
    return {
        "dr": to_yuan(dr),
        "cr": to_yuan(cr),
        "diff": to_yuan(dr - cr),
        "balanced": dr == cr,
    }


def opening_view(ledger: Ledger) -> dict:
    start = ledger.get_start_period()
    locked = ledger.opening_lock_reason()
    accounts = _accounts(ledger)
    by, children = _index(accounts)
    amounts, ytd = _stored(ledger, start)
    rolled_amount = _roll(list(by), by, children, lambda c: amounts.get(c, 0))
    sum_dr: dict[str, int] = {}
    sum_cr: dict[str, int] = {}

    def add_ytd(code: str) -> tuple[int, int]:
        if code in sum_dr:
            return sum_dr[code], sum_cr[code]
        kids = children.get(code, [])
        if not kids:
            d, c = ytd.get(code, (0, 0))
            sum_dr[code], sum_cr[code] = d, c
            return d, c
        d = c = 0
        for k in kids:
            kd, kc = add_ytd(k)
            d += kd
            c += kc
        sum_dr[code], sum_cr[code] = d, c
        return d, c

    for code in by:
        add_ytd(code)

    items = []
    for a in accounts:
        code = a["code"]
        amount = rolled_amount[code]
        d, c = sum_dr[code], sum_cr[code]
        year = amount - _sign(a["direction"]) * (d - c)
        items.append({
            "account_code": code,
            "account_name": a["name"],
            "category": a["category"],
            "direction": a["direction"],
            "parent_code": a["parent_code"],
            "level": _level(code, by),
            "is_leaf": not children.get(code),
            "amount": to_yuan(amount),
            "ytd_debit": to_yuan(d),
            "ytd_credit": to_yuan(c),
            "year_opening": to_yuan(year),
        })
    totals = opening_totals(ledger)
    return {
        "start_period": start,
        "mid_year": not start.endswith("-01"),
        "locked": locked is not None,
        "lock_reason": locked,
        "start_locked": ledger.conn.execute("SELECT 1 FROM vouchers LIMIT 1").fetchone() is not None,
        "items": items,
        "totals": totals,
    }


def _cents(value: str, label: str) -> int:
    try:
        return to_cents(value or "0")
    except MoneyError as e:
        raise LedgerError("bad_amount", f"{label}格式不对：{e}") from e


def save_opening(ledger: Ledger, actor: str, start_period: str | None, items: list[dict]) -> dict:
    if is_ai(actor):
        raise LedgerError("ai_forbidden", "期初余额必须由人录入")
    locked = ledger.opening_lock_reason()
    if locked:
        raise LedgerError("opening_locked", locked)
    current = ledger.get_start_period()
    new_start = start_period or current
    _parse_period(new_start)
    if new_start != current and ledger.conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]:
        raise LedgerError("start_period_locked", "已有凭证，不能改建账期间")

    accounts = _accounts(ledger)
    by, children = _index(accounts)
    mid = not new_start.endswith("-01")
    rows = []
    for raw in items:
        code = str(raw.get("account_code") or "")
        acc = by.get(code)
        if acc is None:
            raise LedgerError("account_not_found", f"科目 {code} 不存在")
        if children.get(code):
            raise LedgerError("not_leaf", f"科目 {code} {acc['name']} 不是末级科目，期初只记在末级")
        amount = _cents(str(raw.get("amount") or "0"), "期初余额")
        ytd_dr = _cents(str(raw.get("ytd_debit") or "0"), "本年累计借方")
        ytd_cr = _cents(str(raw.get("ytd_credit") or "0"), "本年累计贷方")
        if acc["category"] == "pl" and amount != 0:
            raise LedgerError("pl_opening", "损益类科目没有期初余额")
        if not mid:
            ytd_dr = ytd_cr = 0
        rows.append((code, amount, ytd_dr, ytd_cr))

    with ledger._tx():
        if new_start != current:
            ledger.conn.execute("UPDATE opening_balances SET period = ? WHERE period = ?", (new_start, current))
            ledger.conn.execute("UPDATE opening_ytd SET period = ? WHERE period = ?", (new_start, current))
            ledger.write_start_period(new_start)
        for code, amount, ytd_dr, ytd_cr in rows:
            ledger.conn.execute(
                "INSERT INTO opening_balances(account_code, period, cents) VALUES (?,?,?) "
                "ON CONFLICT(account_code, period) DO UPDATE SET cents = excluded.cents",
                (code, new_start, amount),
            )
            ledger.conn.execute(
                "INSERT INTO opening_ytd(account_code, period, debit_cents, credit_cents) VALUES (?,?,?,?) "
                "ON CONFLICT(account_code, period) DO UPDATE SET debit_cents = excluded.debit_cents, "
                "credit_cents = excluded.credit_cents",
                (code, new_start, ytd_dr, ytd_cr),
            )
            ledger._log(actor, "set_opening", f"account:{code}", {
                "period": new_start,
                "amount": to_yuan(amount),
                "ytd_debit": to_yuan(ytd_dr),
                "ytd_credit": to_yuan(ytd_cr),
            })
    return opening_view(ledger)


def book_periods(ledger: Ledger) -> list[str]:
    start = ledger.get_start_period()
    last = ledger.conn.execute("SELECT MAX(period) AS p FROM vouchers").fetchone()["p"]
    from datetime import date
    today = date.today().strftime("%Y-%m")
    end = max(x for x in (last, today, start) if x)
    return _iter_periods(start, end)


def _movement_rows(ledger: Ledger, codes: list[str], start: str, end: str, include_unposted: bool):
    statuses = ("posted", "reviewed", "draft") if include_unposted else ("posted",)
    ph = ",".join("?" * len(statuses))
    marks = ",".join("?" * len(codes))
    return ledger.conn.execute(
        f"""SELECT v.id AS voucher_id, v.word, v.number, v.status, v.date, v.period,
                   l.line_no, l.summary, l.account_code, a.name AS account_name,
                   l.debit_cents, l.credit_cents
            FROM voucher_lines l
            JOIN vouchers v ON v.id = l.voucher_id
            JOIN accounts a ON a.code = l.account_code
            WHERE l.account_code IN ({marks}) AND v.period >= ? AND v.period <= ?
              AND v.status IN ({ph})
            ORDER BY v.date, v.word, v.number, l.line_no""",
        (*codes, start, end, *statuses),
    ).fetchall()


def ledger_book(ledger: Ledger, account_code: str, period_from: str, period_to: str,
                include_unposted: bool, with_lines: bool) -> dict:
    _parse_period(period_from)
    _parse_period(period_to)
    if period_from > period_to or _span(period_from, period_to) > 24:
        raise LedgerError("bad_range", "期间范围不对，起止要按顺序，并且最多连续 24 个月")
    accounts = _accounts(ledger)
    by, children = _index(accounts)
    account = by.get(account_code)
    if account is None:
        raise LedgerError("account_not_found", f"科目 {account_code} 不存在")
    start = ledger.get_start_period()
    actual_from = start if period_from < start else period_from
    leaves = _leaves_under(account_code, by, children)
    opening_signed = _opening_before(ledger, account, leaves, by, actual_from, include_unposted)
    signed = opening_signed
    rows = _movement_rows(ledger, leaves, actual_from, period_to, include_unposted)
    by_period: dict[str, list] = {}
    for row in rows:
        by_period.setdefault(row["period"], []).append(row)

    amounts, ytd = _stored(ledger, start)
    ytd_dr = sum(ytd.get(c, (0, 0))[0] for c in leaves)
    ytd_cr = sum(ytd.get(c, (0, 0))[1] for c in leaves)
    parent_sign = _sign(account["direction"])
    periods = []
    year_dr = year_cr = 0
    year_key = ""
    for period in _iter_periods(actual_from, period_to):
        if period[:4] != year_key:
            year_key = period[:4]
            year_from = max(f"{year_key}-01", start)
            year_dr, year_cr = (ytd_dr, ytd_cr) if start.startswith(year_key) else (0, 0)
            if year_from < period:
                for prev in _movement_rows(ledger, leaves, year_from, _shift(period, -1), include_unposted):
                    year_dr += prev["debit_cents"]
                    year_cr += prev["credit_cents"]
        month_dr = month_cr = 0
        lines = []
        for row in by_period.get(period, []):
            month_dr += row["debit_cents"]
            month_cr += row["credit_cents"]
            signed += (row["debit_cents"] - row["credit_cents"]) * parent_sign
            if with_lines:
                lines.append({
                    "voucher_id": row["voucher_id"],
                    "display_no": f"{row['word']}-{row['number']:04d}",
                    "status": row["status"],
                    "date": row["date"],
                    "account_code": row["account_code"],
                    "account_name": row["account_name"],
                    "summary": row["summary"],
                    "debit": to_yuan(row["debit_cents"]),
                    "credit": to_yuan(row["credit_cents"]),
                    "side": _side(signed),
                    "balance": to_yuan(abs(signed)),
                })
        year_dr += month_dr
        year_cr += month_cr
        periods.append({
            "period": period,
            "lines": lines,
            "month": {
                "debit": to_yuan(month_dr), "credit": to_yuan(month_cr),
                "side": _side(signed), "balance": to_yuan(abs(signed)),
            },
            "year": {
                "debit": to_yuan(year_dr), "credit": to_yuan(year_cr),
                "side": _side(signed), "balance": to_yuan(abs(signed)),
            },
        })
    opening_pair = _money_pair(opening_signed)
    return {
        "account": {"code": account["code"], "name": account["name"], "direction": account["direction"]},
        "include_unposted": include_unposted,
        "opening": {"period": actual_from, **opening_pair},
        "periods": periods if with_lines else [{k: v for k, v in p.items() if k != "lines"} for p in periods],
    }


def _opening_before(ledger, account, leaves, by, before, include_unposted) -> int:
    start = ledger.get_start_period()
    amounts, _ytd = _stored(ledger, start)
    parent_sign = _sign(account["direction"])
    signed = 0
    for code in leaves:
        signed += amounts.get(code, 0) * _sign(by[code]["direction"]) * parent_sign
    if before > start:
        for row in _movement_rows(ledger, leaves, start, _shift(before, -1), include_unposted):
            signed += (row["debit_cents"] - row["credit_cents"]) * parent_sign
    return signed
