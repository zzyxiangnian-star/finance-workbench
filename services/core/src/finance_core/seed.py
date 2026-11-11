"""默认科目表（《小企业会计准则》常用一级科目 + 少量二级示例）和演示数据。"""

from datetime import date

from .ledger import Ledger, LineInput, VoucherInput

# (code, name, category, direction, parent)
DEFAULT_ACCOUNTS = [
    ("1001", "库存现金", "asset", "debit", None),
    ("1002", "银行存款", "asset", "debit", None),
    ("100201", "银行存款-基本户", "asset", "debit", "1002"),
    ("1012", "其他货币资金", "asset", "debit", None),
    ("1121", "应收票据", "asset", "debit", None),
    ("1122", "应收账款", "asset", "debit", None),
    ("1123", "预付账款", "asset", "debit", None),
    ("1221", "其他应收款", "asset", "debit", None),
    ("1403", "原材料", "asset", "debit", None),
    ("1405", "库存商品", "asset", "debit", None),
    ("1601", "固定资产", "asset", "debit", None),
    ("1602", "累计折旧", "asset", "credit", None),
    ("1701", "无形资产", "asset", "debit", None),
    ("2001", "短期借款", "liability", "credit", None),
    ("2202", "应付账款", "liability", "credit", None),
    ("2203", "预收账款", "liability", "credit", None),
    ("2211", "应付职工薪酬", "liability", "credit", None),
    ("2221", "应交税费", "liability", "credit", None),
    ("222101", "应交税费-应交增值税(进项税额)", "liability", "credit", "2221"),
    ("222102", "应交税费-应交增值税(销项税额)", "liability", "credit", "2221"),
    ("222103", "应交税费-未交增值税", "liability", "credit", "2221"),
    ("222104", "应交税费-应交企业所得税", "liability", "credit", "2221"),
    ("2241", "其他应付款", "liability", "credit", None),
    ("3001", "实收资本", "equity", "credit", None),
    ("3101", "盈余公积", "equity", "credit", None),
    ("3103", "本年利润", "equity", "credit", None),
    ("3104", "利润分配", "equity", "credit", None),
    ("4001", "生产成本", "cost", "debit", None),
    ("5001", "主营业务收入", "pl", "credit", None),
    ("5051", "其他业务收入", "pl", "credit", None),
    ("5301", "营业外收入", "pl", "credit", None),
    ("5401", "主营业务成本", "pl", "debit", None),
    ("5403", "税金及附加", "pl", "debit", None),
    ("5601", "销售费用", "pl", "debit", None),
    ("5602", "管理费用", "pl", "debit", None),
    ("560201", "管理费用-办公费", "pl", "debit", "5602"),
    ("560202", "管理费用-差旅费", "pl", "debit", "5602"),
    ("560203", "管理费用-业务招待费", "pl", "debit", "5602"),
    ("560204", "管理费用-职工薪酬", "pl", "debit", "5602"),
    ("5603", "财务费用", "pl", "debit", None),
    ("5711", "营业外支出", "pl", "debit", None),
    ("5801", "所得税费用", "pl", "debit", None),
]


def seed_accounts(ledger: Ledger):
    if ledger.conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]:
        return
    for row in DEFAULT_ACCOUNTS:
        ledger.add_account(*row)
    today = date.today()
    ledger.write_start_period(f"{today.year:04d}-{today.month:02d}")


def seed_demo(ledger: Ledger):
    """演示数据：给技术验证和界面开发用。"""
    seed_accounts(ledger)
    if ledger.conn.execute("SELECT COUNT(*) FROM vouchers").fetchone()[0]:
        return
    ledger.write_start_period("2026-11")
    ledger.set_opening_balance("100201", "2026-11", "500000.00", "系统")
    ledger.set_opening_balance("3001", "2026-11", "500000.00", "系统")
    demo = [
        ("2026-11-03", [("购买办公用品", "560201", "1280.00", "0"), ("购买办公用品", "100201", "0", "1280.00")]),
        ("2026-11-05", [("销售产品", "1122", "113000.00", "0"),
                        ("销售产品", "5001", "0", "100000.00"),
                        ("销售产品 销项税", "222102", "0", "13000.00")]),
        ("2026-11-08", [("张三出差北京报销", "560202", "3560.00", "0"), ("张三出差北京报销", "1001", "0", "3560.00")]),
        ("2026-11-10", [("收到货款", "100201", "113000.00", "0"), ("收到货款", "1122", "0", "113000.00")]),
        ("2026-11-12", [("招待客户餐费", "560203", "860.00", "0"), ("招待客户餐费", "100201", "0", "860.00")]),
    ]
    for i, (d, lines) in enumerate(demo):
        v = ledger.create_voucher(
            VoucherInput(date=d, lines=[LineInput(s, a, dr, cr) for s, a, dr, cr in lines]), actor="李会计"
        )
        if i < 3:
            ledger.review(v["id"], actor="王主管")
            ledger.post(v["id"], actor="王主管")
