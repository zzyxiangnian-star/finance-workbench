"""给 Hermes 用的财务 MCP 工具（stdio）。

Hermes 在 config.yaml 的 mcp_servers.finance 里用命令行拉起本进程。
AI 的身份固定为 "ai:hermes"：账本层会拒绝它审核、记账、结账，写入只能生成草稿凭证。
金额一律用字符串“元”，如 "1280.00"。
"""

from __future__ import annotations

import json
import os

from mcp.server.mcpserver import MCPServer

from .config import Settings
from .db import connect
from .ledger import Ledger, LedgerError, LineInput, VoucherInput
from .seed import seed_accounts, seed_demo

AI_ACTOR = "ai:hermes"

INSTRUCTIONS = """你是公司财务部的记账助手，使用这些工具查询账簿。
- 金额用字符串元，如 "1280.00"；期间格式 YYYY-MM。
- 只能新建草稿凭证（create_draft_voucher），审核、记账、结账必须由人在界面完成；不要声称已经记账。
- 引用凭证时写凭证号（如 记-0003）和 voucher_id，界面会把它变成可点击的标签。
- 回答余额问题时说明是否包含未记账凭证。"""


def build_server(ledger: Ledger) -> MCPServer:
    server = MCPServer("finance", instructions=INSTRUCTIONS)

    def run(fn, *a, **kw) -> str:
        try:
            return json.dumps(fn(*a, **kw), ensure_ascii=False)
        except LedgerError as e:
            return json.dumps({"error": {"code": e.code, "message": e.message}}, ensure_ascii=False)

    @server.tool()
    def search_vouchers(
        period: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        status: str | None = None,
        keyword: str | None = None,
        account_code: str | None = None,
        min_amount: str | None = None,
        max_amount: str | None = None,
        limit: int = 20,
    ) -> str:
        """查询凭证。status 可选 draft/reviewed/posted；keyword 匹配摘要或科目名；account_code 按前缀匹配（如 5602 含所有管理费用明细）。返回 total 和 items（每张凭证含分录）。"""
        return run(ledger.search_vouchers, period, date_from, date_to, status, keyword,
                   account_code, min_amount, max_amount, min(limit, 100))

    @server.tool()
    def get_voucher(voucher_id: int) -> str:
        """按 voucher_id 取一张凭证的完整内容。"""
        return run(ledger.get_voucher, voucher_id)

    @server.tool()
    def list_accounts() -> str:
        """列出启用的会计科目（code、name、类别、余额方向、是否末级）。做凭证只能用末级科目。"""
        return run(lambda: [
            {k: a[k] for k in ("code", "name", "category", "direction", "is_leaf")} for a in ledger.list_accounts()
        ])

    @server.tool()
    def account_balance(account_code: str, period: str, include_unposted: bool = False) -> str:
        """某科目在某期间的期初、本期借贷发生额和期末余额（上级科目汇总下级）。默认只算已记账凭证。"""
        return run(ledger.account_balance, account_code, period, include_unposted)

    @server.tool()
    def trial_balance(period: str, include_unposted: bool = False) -> str:
        """某期间的科目余额表（末级科目），并给出是否平衡。"""
        return run(ledger.trial_balance, period, include_unposted)

    @server.tool()
    def create_draft_voucher(date: str, lines: list[dict], note: str = "", attachments: int = 0) -> str:
        """新建一张草稿凭证，等待人工审核。lines 每项：{summary, account_code, debit, credit}，debit/credit 为字符串元，一行只填一方。借贷必须平衡。"""
        try:
            v = VoucherInput(
                date=date, note=note, attachments=attachments, source="ai",
                lines=[LineInput(str(l.get("summary", "")), str(l.get("account_code", "")),
                                 str(l.get("debit", "0")), str(l.get("credit", "0"))) for l in lines],
            )
        except (AttributeError, TypeError):
            return json.dumps({"error": {"code": "bad_lines", "message": "lines 必须是对象数组"}}, ensure_ascii=False)
        return run(ledger.create_voucher, v, AI_ACTOR)

    return server


def main():
    settings = Settings.from_env()
    ledger = Ledger(connect(settings.db_path))
    (seed_demo if os.environ.get("FW_DEMO") == "1" else seed_accounts)(ledger)
    build_server(ledger).run()  # 默认 stdio


if __name__ == "__main__":
    main()
