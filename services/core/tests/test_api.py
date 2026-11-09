from urllib.parse import quote

from fastapi.testclient import TestClient

from finance_core.api import create_app
from finance_core.config import Settings


def client(tmp_path):
    s = Settings(data_dir=tmp_path, db_path=tmp_path / "t.db", host="127.0.0.1", port=0, token="tok")
    return TestClient(create_app(s, demo=True))


def H(user="李会计"):
    return {"Authorization": "Bearer tok", "X-FW-User": quote(user)}


def test_auth_and_flow(tmp_path):
    with client(tmp_path) as c:
        assert c.get("/api/health").json()["ok"]
        assert c.get("/api/vouchers").status_code == 401
        assert c.get("/api/vouchers", headers=H()).json()["total"] == 5
        body = {"date": "2026-11-20", "lines": [
            {"summary": "付房租", "account_code": "560201", "debit": "5000"},
            {"summary": "付房租", "account_code": "100201", "credit": "5000"}]}
        v = c.post("/api/vouchers", json=body, headers=H()).json()
        assert v["display_no"] == "记-0006"
        r = c.post(f"/api/vouchers/{v['id']}/review", headers=H())
        assert r.status_code == 422 and r.json()["error"]["code"] == "self_review"
        assert c.post(f"/api/vouchers/{v['id']}/review", headers=H("王主管")).json()["status"] == "reviewed"
        assert c.post("/api/vouchers", json=body, headers=H("ai:hermes")).status_code == 403
        tb = c.get("/api/reports/trial-balance?period=2026-11", headers=H()).json()
        assert tb["balanced"]


def test_entry_helpers(tmp_path):
    with client(tmp_path) as c:
        accs = c.get("/api/accounts", headers=H()).json()
        by = {a["code"]: a for a in accs}
        assert by["560201"]["py"] == "glfy-bgf"
        assert by["1002"]["py"].startswith("yh")
        assert "jx" in by["222101"]["py"]
        assert "clf" in by["560202"]["py"]

        assert c.get("/api/vouchers/next-number", params={"period": "2026-11", "word": "记"}, headers=H()).json() == {
            "display_no": "记-0006"
        }
        assert c.get("/api/vouchers/next-number", params={"period": "2020-01"}, headers=H()).json()["display_no"] == "记-0001"
        bad = c.get("/api/vouchers/next-number", params={"period": "202611"}, headers=H())
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "bad_period"

        sums = c.get("/api/summaries", headers=H()).json()
        assert sums[0] == "招待客户餐费"
        assert "张三出差北京报销" in sums
        assert c.get("/api/summaries", params={"q": "出差"}, headers=H()).json() == ["张三出差北京报销"]
        assert c.get("/api/summaries", params={"q": "没有这种摘要"}, headers=H()).json() == []

        body = {"date": "2026-11-20", "lines": [
            {"summary": "差旅费报销", "account_code": "560202", "debit": "10.00"},
            {"summary": "差旅费报销", "account_code": "100201", "credit": "10.00"}]}
        made = c.post("/api/vouchers", json=body, headers=H()).json()
        assert c.get("/api/summaries", params={"q": "差旅"}, headers=H()).json()[0] == "差旅费报销"
        # 编辑不能换月：后端 period_change
        moved = dict(body, date="2026-12-01")
        r = c.put(f"/api/vouchers/{made['id']}", json=moved, headers=H())
        assert r.status_code == 422 and r.json()["error"]["code"] == "period_change"

        bal = c.get("/api/accounts/100201/balance", params={"period": "2026-11", "include_unposted": "true"}, headers=H()).json()
        assert bal["account_code"] == "100201"
        assert bal["opening"] == "500000.00"
        assert bal["include_unposted"] is True
        missing = c.get("/api/accounts/9999/balance", params={"period": "2026-11"}, headers=H())
        assert missing.status_code == 422 and missing.json()["error"]["code"] == "account_not_found"


def test_chat_without_hermes(tmp_path, monkeypatch):
    monkeypatch.delenv("HERMES_API_KEY", raising=False)
    with client(tmp_path) as c:
        r = c.post("/api/chat", json={"message": "你好"}, headers=H())
        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "hermes_not_configured"
        status = c.get("/api/hermes/status", headers=H()).json()
        assert status == {"configured": False, "reachable": False, "model": None}


def _free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_fake(port: int):
    import threading
    import uvicorn
    from finance_core.dev.fake_hermes import app as fake_app

    config = uvicorn.Config(fake_app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    import time
    import httpx
    for _ in range(50):
        try:
            httpx.get(f"http://127.0.0.1:{port}/v1/models", timeout=0.2, trust_env=False)
            break
        except httpx.HTTPError:
            time.sleep(0.05)
    return server


def test_chat_sessions_and_fake_hermes(tmp_path, monkeypatch):
    port = _free_port()
    monkeypatch.setenv("HERMES_API_KEY", "test-key")
    monkeypatch.setenv("HERMES_API_URL", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("FAKE_HERMES_DELAY", "0")
    server = _start_fake(port)
    try:
        with client(tmp_path) as c:
            status = c.get("/api/hermes/status", headers=H()).json()
            assert status["configured"] is True
            assert status["reachable"] is True
            assert status["model"] == "hermes-agent"

            with c.stream("POST", "/api/chat", json={"message": "查一下本月差旅费"}, headers=H()) as r:
                body = "".join(r.iter_text())
            assert body.startswith("event: session")
            assert "记-0003" in body
            sid = c.get("/api/chats", headers=H()).json()[0]["id"]
            detail = c.get(f"/api/chats/{sid}", headers=H()).json()
            assert detail["title"] == "查一下本月差旅费"
            assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
            assert "记-0003" in detail["messages"][1]["content"]
            assert detail["messages"][1]["tools"][-1]["status"] == "completed"
            assert detail["messages"][1]["tools"][-1]["name"].endswith("search_vouchers")

            renamed = c.patch(f"/api/chats/{sid}", json={"title": "差旅费"}, headers=H())
            assert renamed.status_code == 200, renamed.text
            assert renamed.json()["title"] == "差旅费"
            again = c.post("/api/chat", json={"session_id": sid, "regenerate": True}, headers=H())
            assert again.status_code == 200
            detail = c.get(f"/api/chats/{sid}", headers=H()).json()
            assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]

            assert c.delete(f"/api/chats/{sid}", headers=H()).json() == {"ok": True}
            assert c.get("/api/chats", headers=H()).json() == []
            assert c.get(f"/api/chats/{sid}", headers=H()).status_code == 404

            found = c.get("/api/vouchers/lookup", params={"no": "记-0003"}, headers=H()).json()
            assert len(found) == 1 and found[0]["display_no"] == "记-0003"
            assert c.get("/api/vouchers/lookup", params={"no": "记-0003", "period": "2026-11"}, headers=H()).json()[0]["id"] == found[0]["id"]
            bad = c.get("/api/vouchers/lookup", params={"no": "记0003"}, headers=H())
            assert bad.status_code == 422 and bad.json()["error"]["code"] == "bad_voucher_no"
    finally:
        server.should_exit = True


def test_chat_stop_and_unreachable(tmp_path, monkeypatch):
    import asyncio
    from finance_core.api import apply_sse_block, finalize_content, iter_upstream

    class Req:
        def __init__(self):
            self.n = 0

        async def is_disconnected(self):
            self.n += 1
            return self.n > 1

    async def source():
        yield 'data: {"choices":[{"delta":{"content":"已收到"}}]}\n\n'
        yield 'data: {"choices":[{"delta":{"content":"后半段"}}]}\n\n'

    async def run():
        acc: list[str] = []
        tools: dict = {}
        stopped = {"v": False}
        async for _ in iter_upstream(Req(), source(), lambda b: apply_sse_block(b, acc, tools), stopped):
            pass
        assert stopped["v"] is True
        assert finalize_content("".join(acc), True) == "已收到（已停止）"

    asyncio.run(run())

    dead = _free_port()
    monkeypatch.setenv("HERMES_API_KEY", "test-key")
    monkeypatch.setenv("HERMES_API_URL", f"http://127.0.0.1:{dead}")
    with client(tmp_path) as c:
        with c.stream("POST", "/api/chat", json={"message": "还有人吗"}, headers=H()) as r:
            body = "".join(r.iter_text())
        assert "hermes_unreachable" in body
        assert "连不上 Hermes，请确认它已启动" in body
        status = c.get("/api/hermes/status", headers=H()).json()
        assert status["configured"] is True and status["reachable"] is False

