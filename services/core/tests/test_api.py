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
        r = c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=H())
        assert r.status_code == 503
