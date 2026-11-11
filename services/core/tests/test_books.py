"""账簿、期初余额和记账前的期初平衡。"""

from finance_core.books import book_periods, ledger_book, opening_view, save_opening
from finance_core.db import connect
from finance_core.ledger import Ledger, LedgerError, LineInput, VoucherInput
from finance_core.mcp_server import build_server
from finance_core.seed import seed_accounts, seed_demo


def fresh():
    ledger = Ledger(connect(":memory:"))
    seed_accounts(ledger)
    return ledger


def err(fn, code):
    try:
        fn()
    except LedgerError as e:
        assert e.code == code
        return
    raise AssertionError(f"应该报 {code}")


def leaf(code, amount="0", ytd_debit="0", ytd_credit="0"):
    return {"account_code": code, "amount": amount, "ytd_debit": ytd_debit, "ytd_credit": ytd_credit}


def post_pair(ledger, date, lines):
    v = ledger.create_voucher(
        VoucherInput(date=date, lines=[LineInput(*x) for x in lines]), "李会计",
    )
    ledger.review(v["id"], "王主管")
    return ledger.post(v["id"], "王主管")


def test_opening_roll_and_trial():
    ledger = fresh()
    view = save_opening(ledger, "李会计", None, [
        leaf("1001", "10000.00"),
        leaf("100201", "200000.00"),
        leaf("3001", "210000.00"),
    ])
    assert view["totals"]["balanced"] is True
    assert view["totals"]["dr"] == "210000.00"
    bank = next(i for i in view["items"] if i["account_code"] == "1002")
    assert bank["is_leaf"] is False and bank["amount"] == "200000.00"
    view = save_opening(ledger, "李会计", None, [leaf("3001", "200000.00")])
    assert view["totals"]["balanced"] is False
    assert view["totals"]["diff"] == "10000.00"


def test_opening_locks_and_rules():
    ledger = fresh()
    err(lambda: save_opening(ledger, "李会计", None, [leaf("1002", "1.00")]), "not_leaf")
    err(lambda: save_opening(ledger, "李会计", None, [leaf("5001", "1.00")]), "pl_opening")
    err(lambda: save_opening(ledger, "ai:hermes", None, [leaf("1001", "1.00")]), "ai_forbidden")
    save_opening(ledger, "李会计", None, [leaf("1001", "100.00"), leaf("3001", "50.00")])
    v = ledger.create_voucher(
        VoucherInput(date="2026-11-03", lines=[
            LineInput("办公", "560201", "10.00", "0"), LineInput("办公", "1001", "0", "10.00"),
        ]), "李会计",
    )
    ledger.review(v["id"], "王主管")
    err(lambda: ledger.post(v["id"], "王主管"), "opening_unbalanced")
    save_opening(ledger, "李会计", None, [leaf("1001", "100.00"), leaf("3001", "100.00")])
    ledger.post(v["id"], "王主管")
    err(lambda: save_opening(ledger, "李会计", None, [leaf("1001", "1.00")]), "opening_locked")
    assert opening_view(ledger)["locked"] is True


def test_start_period_and_before_start():
    ledger = fresh()
    draft = ledger.create_voucher(
        VoucherInput(date="2026-11-03", lines=[
            LineInput("办公", "560201", "10.00", "0"), LineInput("办公", "1001", "0", "10.00"),
        ]), "李会计",
    )
    err(lambda: save_opening(ledger, "李会计", "2026-07", []), "start_period_locked")
    ledger.delete_voucher(draft["id"], "李会计")
    view = save_opening(ledger, "李会计", "2026-07", [
        leaf("5001", "0", "0", "300000.00"),
    ])
    assert view["start_period"] == "2026-07" and view["mid_year"] is True
    income = next(i for i in view["items"] if i["account_code"] == "5001")
    assert income["amount"] == "0.00"
    assert income["year_opening"] == "-300000.00"
    err(lambda: ledger.create_voucher(
        VoucherInput(date="2026-06-30", lines=[
            LineInput("办公", "560201", "10.00", "0"), LineInput("办公", "1001", "0", "10.00"),
        ]), "李会计",
    ), "before_start")


def test_detail_running_balance_and_parent():
    ledger = Ledger(connect(":memory:"))
    seed_demo(ledger)
    book = ledger_book(ledger, "100201", "2026-11", "2026-11", False, True)
    assert book["opening"] == {"period": "2026-11", "side": "debit", "amount": "500000.00"}
    line = book["periods"][0]["lines"][0]
    assert line["display_no"] == "记-0001" and line["credit"] == "1280.00"
    assert line["side"] == "debit" and line["balance"] == "498720.00"
    assert book["periods"][0]["month"]["credit"] == "1280.00"

    more = ledger_book(ledger, "100201", "2026-11", "2026-11", True, True)
    nos = [x["display_no"] for x in more["periods"][0]["lines"]]
    assert nos == ["记-0001", "记-0004", "记-0005"]
    assert more["periods"][0]["lines"][-1]["status"] != "posted"
    assert more["periods"][0]["month"]["side"] == "debit"
    assert more["periods"][0]["month"]["balance"] == "610860.00"

    parent = ledger_book(ledger, "5602", "2026-11", "2026-11", False, True)
    assert "account_code" in parent["periods"][0]["lines"][0]
    assert parent["periods"][0]["month"]["debit"] == "4840.00"
    loose = ledger_book(ledger, "5602", "2026-11", "2026-11", True, True)
    assert loose["periods"][0]["month"]["debit"] == "5700.00"

    ar = ledger_book(ledger, "1122", "2026-11", "2026-11", False, False)
    assert "lines" not in ar["periods"][0]
    assert ar["periods"][0]["month"]["debit"] == "113000.00"
    assert ar["periods"][0]["month"]["side"] == "debit"
    flat = ledger_book(ledger, "1122", "2026-11", "2026-11", True, False)
    assert flat["periods"][0]["month"]["side"] == "flat"


def test_balance_flips_and_cross_year():
    ledger = fresh()
    save_opening(ledger, "李会计", "2026-11", [leaf("1001", "100.00"), leaf("3001", "100.00")])
    post_pair(ledger, "2026-11-03", [("付现", "560201", "150.00", "0"), ("付现", "1001", "0", "150.00")])
    book = ledger_book(ledger, "1001", "2026-11", "2026-11", False, True)
    assert book["periods"][0]["lines"][0]["side"] == "credit"
    assert book["periods"][0]["lines"][0]["balance"] == "50.00"
    post_pair(ledger, "2026-11-04", [("收回", "1001", "50.00", "0"), ("收回", "560201", "0", "50.00")])
    book = ledger_book(ledger, "1001", "2026-11", "2026-11", False, True)
    assert book["periods"][0]["lines"][-1]["side"] == "flat"

    save_opening_ytd = ledger  # 已记账后不能再改期初；跨年用另一套账
    other = fresh()
    save_opening(other, "李会计", "2026-11", [
        leaf("1001", "80.00", "20.00", "0"), leaf("3001", "80.00"),
    ])
    post_pair(other, "2026-12-02", [("收现", "1001", "30.00", "0"), ("收现", "5001", "0", "30.00")])
    post_pair(other, "2027-01-05", [("收现", "1001", "10.00", "0"), ("收现", "5001", "0", "10.00")])
    book = ledger_book(other, "1001", "2026-11", "2027-01", False, False)
    nov, dec, jan = book["periods"]
    assert nov["lines"] == [] if False else nov["month"]["debit"] == "0.00"
    assert dec["year"]["debit"] == "50.00"  # 年初累计 20 + 12 月 30
    assert jan["year"]["debit"] == "10.00"  # 新的一年不带上一年的累计
    assert jan["month"]["balance"] == "120.00"
    assert len(book_periods(other)) >= 3
    _ = save_opening_ytd


def test_empty_month_and_bad_range():
    ledger = fresh()
    save_opening(ledger, "李会计", "2026-11", [leaf("1001", "10.00"), leaf("3001", "10.00")])
    post_pair(ledger, "2027-01-08", [("收现", "1001", "5.00", "0"), ("收现", "5001", "0", "5.00")])
    book = ledger_book(ledger, "1001", "2026-11", "2027-01", False, True)
    assert [p["period"] for p in book["periods"]] == ["2026-11", "2026-12", "2027-01"]
    assert book["periods"][1]["lines"] == []
    assert book["periods"][1]["month"]["balance"] == "10.00"
    err(lambda: ledger_book(ledger, "1001", "2027-02", "2026-11", False, True), "bad_range")
    err(lambda: ledger_book(ledger, "9999", "2026-11", "2026-11", False, True), "account_not_found")


def test_mcp_detail_tool():
    ledger = fresh()
    seed_demo(Ledger(ledger.conn)) if False else None
    demo = Ledger(connect(":memory:"))
    seed_demo(demo)
    server = build_server(demo)
    names = [t.name for t in server._tool_manager.list_tools()]
    assert "detail_ledger" in names
