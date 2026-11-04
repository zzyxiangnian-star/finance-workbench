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


def test_chat_without_hermes(tmp_path, monkeypatch):
    monkeypatch.delenv("HERMES_API_KEY", raising=False)
    with client(tmp_path) as c:
        r = c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=H())
        assert r.status_code == 503
