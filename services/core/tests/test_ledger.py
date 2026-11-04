import pytest

from finance_core.db import connect
from finance_core.ledger import Ledger, LedgerError, LineInput, VoucherInput
from finance_core.money import MoneyError, to_cents, to_yuan
from finance_core.seed import seed_accounts, seed_demo


@pytest.fixture
def L():
    l = Ledger(connect(":memory:"))
    seed_accounts(l)
    return l


def v(date="2026-11-03", lines=None, **kw):
    lines = lines or [("办公用品", "560201", "100.00", "0"), ("办公用品", "1001", "0", "100.00")]
    return VoucherInput(date=date, lines=[LineInput(*x) for x in lines], **kw)


def err(fn, code):
    with pytest.raises(LedgerError) as e:
        fn()
    assert e.value.code == code


def test_money():
    assert to_cents("1,234.5") == 123450
    assert to_yuan(-5) == "-0.05"
    with pytest.raises(MoneyError):
        to_cents(1.1)
    with pytest.raises(MoneyError):
        to_cents("1.234")


def test_create_and_numbering(L):
    a = L.create_voucher(v(), "李会计")
    b = L.create_voucher(v(), "李会计")
    assert (a["display_no"], b["display_no"]) == ("记-0001", "记-0002")
    assert a["status"] == "draft" and a["total"] == "100.00"
    assert a["lines"][0]["account_name"] == "管理费用-办公费"


@pytest.mark.parametrize("lines,code", [
    ([("a", "560201", "100", "0"), ("b", "1001", "0", "90")], "unbalanced"),
    ([("a", "560201", "100", "0")], "too_few_lines"),
    ([("a", "5602", "100", "0"), ("b", "1001", "0", "100")], "account_not_leaf"),
    ([("a", "9999", "100", "0"), ("b", "1001", "0", "100")], "account_not_found"),
    ([("a", "560201", "100", "100"), ("b", "1001", "0", "0")], "line_one_side"),
    ([("", "560201", "100", "0"), ("b", "1001", "0", "100")], "empty_summary"),
])
def test_validation(L, lines, code):
    err(lambda: L.create_voucher(v(lines=lines), "李会计"), code)


def test_bad_date(L):
    err(lambda: L.create_voucher(v(date="2026-13-01"), "x"), "bad_date")
    err(lambda: L.create_voucher(v(date="2026-11-03", period="2026-10"), "x"), "date_outside_period")


def test_workflow_and_segregation(L):
    vid = L.create_voucher(v(), "李会计")["id"]
    err(lambda: L.post(vid, "王主管"), "bad_status")
    err(lambda: L.review(vid, "李会计"), "self_review")
    L.review(vid, "王主管")
    err(lambda: L.update_voucher(vid, v(), "李会计"), "not_draft")
    err(lambda: L.unreview(vid, "赵出纳"), "not_reviewer")
    L.unreview(vid, "王主管")
    L.update_voucher(vid, v(lines=[("改", "560201", "200", "0"), ("改", "1001", "0", "200")]), "李会计")
    L.review(vid, "王主管")
    assert L.post(vid, "王主管")["status"] == "posted"
    err(lambda: L.unreview(vid, "王主管"), "bad_status")
    err(lambda: L.delete_voucher(vid, "李会计"), "not_draft")
    actions = [r["action"] for r in L.audit_log(f"voucher:{vid}")]
    assert actions[::-1] == ["create_voucher", "review", "unreview", "update_voucher", "review", "post"]


def test_ai_limits(L):
    d = L.create_voucher(v(), "ai:hermes")
    assert d["source"] == "ai" and d["status"] == "draft"
    for fn in (L.review, L.post, L.unreview):
        err(lambda fn=fn: fn(d["id"], "ai:hermes"), "ai_forbidden")
    err(lambda: L.close_period("2026-11", "ai:hermes"), "ai_forbidden")


def test_close_period(L):
    vid = L.create_voucher(v(), "李会计")["id"]
    err(lambda: L.close_period("2026-11", "王主管"), "period_has_unposted")
    L.review(vid, "王主管"); L.post(vid, "王主管")
    L.close_period("2026-11", "王主管")
    err(lambda: L.create_voucher(v(), "李会计"), "period_closed")
    L.create_voucher(v(date="2026-12-01"), "李会计")  # 下期可以


def test_balances_demo():
    L = Ledger(connect(":memory:"))
    seed_demo(L)
    tb = L.trial_balance("2026-11")
    assert tb["balanced"]
    bank = L.account_balance("1002", "2026-11")
    assert (bank["opening"], bank["credit"], bank["closing"]) == ("500000.00", "1280.00", "498720.00")
    assert L.account_balance("1002", "2026-11", include_unposted=True)["closing"] == "610860.00"
    assert L.account_balance("5602", "2026-11")["closing"] == "4840.00"
    # 下期期初承接本期期末
    assert L.account_balance("1002", "2026-12")["opening"] == "498720.00"
    assert L.trial_balance("2026-12")["balanced"]


def test_search():
    L = Ledger(connect(":memory:"))
    seed_demo(L)
    assert L.search_vouchers(keyword="差旅")["total"] == 1
    assert L.search_vouchers(account_code="5602")["total"] == 3
    assert L.search_vouchers(status="draft")["total"] == 2
    assert L.search_vouchers(min_amount="1000", max_amount="5000")["total"] == 2
    assert L.search_vouchers(limit=2)["total"] == 5
