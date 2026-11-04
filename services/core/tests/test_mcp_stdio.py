"""端到端：像 Hermes 一样用 stdio 拉起 MCP 进程并调用工具。"""
import json
import os
import sys

import anyio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SRC = os.path.join(os.path.dirname(__file__), "..", "src")


def test_stdio_roundtrip(tmp_path):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "finance_core.mcp_server"],
        env={**os.environ, "PYTHONPATH": SRC, "FW_DATA_DIR": str(tmp_path), "FW_DEMO": "1"},
    )

    async def go():
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                names = {t.name for t in (await s.list_tools()).tools}
                assert "create_draft_voucher" in names
                res = await s.call_tool("search_vouchers", {"keyword": "差旅"})
                data = json.loads(res.content[0].text)
                assert data["items"][0]["lines"][0]["account_name"] == "管理费用-差旅费"
                res = await s.call_tool("create_draft_voucher", {"date": "2026-11-15", "lines": [
                    {"summary": "AI 草稿", "account_code": "560201", "debit": "10"},
                    {"summary": "AI 草稿", "account_code": "1001", "credit": "10"}]})
                d = json.loads(res.content[0].text)
                assert d["status"] == "draft" and d["maker"] == "ai:hermes"
                res = await s.call_tool("create_draft_voucher", {"date": "2026-11-15", "lines": [
                    {"summary": "x", "account_code": "560201", "debit": "10"},
                    {"summary": "x", "account_code": "1001", "credit": "9"}]})
                assert json.loads(res.content[0].text)["error"]["code"] == "unbalanced"

    anyio.run(go)
