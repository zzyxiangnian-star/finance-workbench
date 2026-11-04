"""本机 HTTP 服务（FastAPI），给桌面界面用。接口约定见 docs/CONTRACT.md。

- 只监听 127.0.0.1；每个请求必须带 Authorization: Bearer <token>。
- 操作人放在 X-FW-User 头里（URL 编码的 UTF-8）。第一期没有登录，界面在设置里选当前用户。
- /api/chat 把对话转发给本机 Hermes API Server，Hermes 的密钥只留在服务端，不进 WebView。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from urllib.parse import unquote

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .config import Settings
from .db import connect
from .ledger import AI_PREFIX, Ledger, LedgerError, LineInput, VoucherInput
from .seed import seed_accounts, seed_demo


class LineIn(BaseModel):
    summary: str
    account_code: str
    debit: str = "0"
    credit: str = "0"


class VoucherIn(BaseModel):
    date: str
    lines: list[LineIn] = Field(min_length=2)
    word: str = "记"
    attachments: int = 0
    note: str = ""

    def to_input(self) -> VoucherInput:
        return VoucherInput(
            date=self.date, word=self.word, attachments=self.attachments, note=self.note,
            lines=[LineInput(**l.model_dump()) for l in self.lines],
        )


class ChatIn(BaseModel):
    messages: list[dict]
    session_id: str | None = None


def create_app(settings: Settings | None = None, demo: bool | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    demo = demo if demo is not None else os.environ.get("FW_DEMO") == "1"

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        conn = connect(settings.db_path)
        ledger = Ledger(conn)
        (seed_demo if demo else seed_accounts)(ledger)
        app.state.ledger = ledger
        yield
        conn.close()

    app = FastAPI(title="财务工作台本地服务", version="0.1.0", lifespan=lifespan)
    # Tauri WebView 的源；开发时 Vite 在 1420
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"],
        allow_methods=["*"], allow_headers=["*"],
    )

    @app.exception_handler(LedgerError)
    async def ledger_error(_: Request, e: LedgerError):
        return JSONResponse(status_code=422, content={"error": {"code": e.code, "message": e.message}})

    def auth(authorization: str = Header(default="")):
        if authorization != f"Bearer {settings.token}":
            raise HTTPException(401, detail={"code": "unauthorized", "message": "令牌不对"})

    def user(x_fw_user: str = Header(default="")) -> str:
        name = unquote(x_fw_user).strip()
        if not name:
            raise HTTPException(400, detail={"code": "no_user", "message": "缺少操作人 X-FW-User"})
        if name.startswith(AI_PREFIX):
            raise HTTPException(403, detail={"code": "ai_forbidden", "message": "界面接口不接受 AI 身份"})
        return name

    def L(request: Request) -> Ledger:
        return request.app.state.ledger

    deps = [Depends(auth)]

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": app.version}

    @app.get("/api/accounts", dependencies=deps)
    def accounts(request: Request, include_disabled: bool = False):
        return L(request).list_accounts(include_disabled)

    @app.get("/api/periods", dependencies=deps)
    def periods(request: Request):
        return L(request).list_periods()

    @app.post("/api/periods/{period}/close", dependencies=deps)
    def close(period: str, request: Request, actor: str = Depends(user)):
        L(request).close_period(period, actor)
        return {"ok": True}

    @app.get("/api/vouchers", dependencies=deps)
    def vouchers(
        request: Request, period: str | None = None, date_from: str | None = None, date_to: str | None = None,
        status: str | None = None, keyword: str | None = None, account_code: str | None = None,
        min_amount: str | None = None, max_amount: str | None = None, limit: int = 50, offset: int = 0,
    ):
        return L(request).search_vouchers(
            period, date_from, date_to, status, keyword, account_code, min_amount, max_amount, limit, offset
        )

    @app.post("/api/vouchers", dependencies=deps)
    def create(body: VoucherIn, request: Request, actor: str = Depends(user)):
        return L(request).create_voucher(body.to_input(), actor)

    @app.get("/api/vouchers/{vid}", dependencies=deps)
    def get(vid: int, request: Request):
        return L(request).get_voucher(vid)

    @app.put("/api/vouchers/{vid}", dependencies=deps)
    def update(vid: int, body: VoucherIn, request: Request, actor: str = Depends(user)):
        return L(request).update_voucher(vid, body.to_input(), actor)

    @app.delete("/api/vouchers/{vid}", dependencies=deps)
    def delete(vid: int, request: Request, actor: str = Depends(user)):
        L(request).delete_voucher(vid, actor)
        return {"ok": True}

    @app.post("/api/vouchers/{vid}/review", dependencies=deps)
    def review(vid: int, request: Request, actor: str = Depends(user)):
        return L(request).review(vid, actor)

    @app.post("/api/vouchers/{vid}/unreview", dependencies=deps)
    def unreview(vid: int, request: Request, actor: str = Depends(user)):
        return L(request).unreview(vid, actor)

    @app.post("/api/vouchers/{vid}/post", dependencies=deps)
    def post(vid: int, request: Request, actor: str = Depends(user)):
        return L(request).post(vid, actor)

    @app.get("/api/reports/trial-balance", dependencies=deps)
    def trial_balance(period: str, request: Request, include_unposted: bool = False):
        return L(request).trial_balance(period, include_unposted)

    @app.get("/api/audit", dependencies=deps)
    def audit(request: Request, target: str | None = None, limit: int = 100):
        return L(request).audit_log(target, limit)

    # ---------- AI 对话：转发到 Hermes ----------
    hermes_url = os.environ.get("HERMES_API_URL", "http://127.0.0.1:8642")
    hermes_key = os.environ.get("HERMES_API_KEY", "")

    @app.post("/api/chat", dependencies=deps)
    async def chat(body: ChatIn, actor: str = Depends(user)):
        """流式返回 Hermes 的 SSE 原文（chat.completion.chunk + hermes.tool.progress）。"""
        if not hermes_key:
            raise HTTPException(503, detail={"code": "hermes_not_configured", "message": "未配置 HERMES_API_KEY"})
        headers = {"Authorization": f"Bearer {hermes_key}"}
        if body.session_id:
            headers["X-Hermes-Session-Id"] = body.session_id
        payload = {"model": "hermes-agent", "messages": body.messages, "stream": True}

        async def relay():
            async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=None)) as client:
                try:
                    async with client.stream("POST", f"{hermes_url}/v1/chat/completions",
                                             json=payload, headers=headers) as r:
                        if r.status_code != 200:
                            text = (await r.aread()).decode("utf-8", "replace")[:500]
                            yield f'event: error\ndata: {{"status": {r.status_code}, "detail": {text!r}}}\n\n'
                            return
                        async for chunk in r.aiter_raw():
                            yield chunk
                except httpx.ConnectError:
                    yield 'event: error\ndata: {"code": "hermes_unreachable", "message": "连不上 Hermes，请确认它已启动"}\n\n'

        return StreamingResponse(relay(), media_type="text/event-stream")

    return app


def main():
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
