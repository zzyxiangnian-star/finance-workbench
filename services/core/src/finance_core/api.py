"""本机 HTTP 服务（FastAPI），给桌面界面用。接口约定见 docs/CONTRACT.md。

- 只监听 127.0.0.1；每个请求必须带 Authorization: Bearer <token>。
- 操作人放在 X-FW-User 头里（URL 编码的 UTF-8）。第一期没有登录，界面在设置里选当前用户。
- /api/chat 把对话转发给本机 Hermes API Server，Hermes 的密钥只留在服务端，不进 WebView。
"""

from __future__ import annotations

import os
import json
from contextlib import asynccontextmanager
from urllib.parse import unquote

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .chat_store import (
    add_message, create_session, delete_session, drop_last_assistant, get_session, history,
    list_sessions, rename_session, title_from,
)

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


def finalize_content(text: str, stopped: bool) -> str:
    return text + "（已停止）" if stopped else text


def apply_sse_block(block: str, acc_text: list[str], acc_tools: dict[str, dict]) -> None:
    event = "message"
    data: list[str] = []
    for line in block.split("\n"):
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    raw = "\n".join(data)
    if not raw or raw == "[DONE]":
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return
    if event == "hermes.tool.progress":
        tid = str(payload.get("toolCallId") or payload.get("tool") or "")
        acc_tools[tid] = {
            "id": str(payload.get("toolCallId") or ""),
            "name": str(payload.get("tool") or "工具"),
            "status": "completed" if payload.get("status") == "completed" else "running",
        }
        return
    choices = payload.get("choices") or []
    delta = (choices[0].get("delta") if choices else None) or {}
    piece = delta.get("content")
    if piece:
        acc_text.append(piece)


async def iter_upstream(request: Request, source, on_block, stopped: dict):
    """把上游 SSE 转出去。客户端已断开时停下，stopped['v'] 记为 True。"""
    buf = ""
    async for chunk in source:
        if await request.is_disconnected():
            stopped["v"] = True
            return
        yield chunk
        buf += chunk
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            on_block(block)
    if await request.is_disconnected():
        stopped["v"] = True
    elif buf.strip():
        on_block(buf)


class ChatIn(BaseModel):
    message: str = ""
    session_id: str | None = None
    regenerate: bool = False


class TitleIn(BaseModel):
    title: str


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

    @app.get("/api/vouchers/lookup", dependencies=deps)
    def lookup(request: Request, no: str, period: str | None = None):
        return L(request).lookup_vouchers(no, period)

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

    # ---------- AI 对话 ----------
    def hermes_cfg() -> tuple[str, str]:
        return os.environ.get("HERMES_API_URL", "http://127.0.0.1:8642"), os.environ.get("HERMES_API_KEY", "")

    @app.get("/api/hermes/status", dependencies=deps)
    async def hermes_status():
        url, key = hermes_cfg()
        if not key:
            return {"configured": False, "reachable": False, "model": None}
        try:
            async with httpx.AsyncClient(timeout=2, trust_env=False) as client:
                r = await client.get(f"{url}/v1/models", headers={"Authorization": f"Bearer {key}"})
            if r.status_code != 200:
                return {"configured": True, "reachable": False, "model": None}
            data = r.json()
            model = None
            if isinstance(data, dict) and data.get("data"):
                model = data["data"][0].get("id")
            return {"configured": True, "reachable": True, "model": model}
        except httpx.HTTPError:
            return {"configured": True, "reachable": False, "model": None}

    @app.get("/api/chats", dependencies=deps)
    def chats(request: Request):
        return list_sessions(L(request).conn)

    @app.get("/api/chats/{sid}", dependencies=deps)
    def chat_detail(sid: str, request: Request):
        found = get_session(L(request).conn, sid)
        if found is None:
            raise HTTPException(404, detail={"code": "chat_not_found", "message": "没有这个对话"})
        return found

    @app.patch("/api/chats/{sid}", dependencies=deps)
    def chat_rename(sid: str, body: TitleIn, request: Request):
        title = body.title.strip()
        if not title:
            raise HTTPException(422, detail={"code": "empty_title", "message": "标题不能为空"})
        found = rename_session(L(request).conn, sid, title[:40])
        if found is None:
            raise HTTPException(404, detail={"code": "chat_not_found", "message": "没有这个对话"})
        return found

    @app.delete("/api/chats/{sid}", dependencies=deps)
    def chat_delete(sid: str, request: Request):
        if not delete_session(L(request).conn, sid):
            raise HTTPException(404, detail={"code": "chat_not_found", "message": "没有这个对话"})
        return {"ok": True}

    @app.post("/api/chat", dependencies=deps)
    async def chat(body: ChatIn, request: Request, actor: str = Depends(user)):
        """把本会话历史发给 Hermes，并把回答和工具调用存下来。"""
        url, key = hermes_cfg()
        if not key:
            raise HTTPException(503, detail={"code": "hermes_not_configured", "message": "未配置 HERMES_API_KEY"})
        conn = L(request).conn
        text = body.message.strip()
        if body.regenerate:
            if not body.session_id:
                raise HTTPException(422, detail={"code": "no_session", "message": "重新生成需要已有对话"})
            if get_session(conn, body.session_id) is None:
                raise HTTPException(404, detail={"code": "chat_not_found", "message": "没有这个对话"})
            drop_last_assistant(conn, body.session_id)
            sid = body.session_id
        else:
            if not text:
                raise HTTPException(422, detail={"code": "empty_message", "message": "请输入要问的内容"})
            if body.session_id:
                if get_session(conn, body.session_id) is None:
                    raise HTTPException(404, detail={"code": "chat_not_found", "message": "没有这个对话"})
                sid = body.session_id
            else:
                sid = create_session(conn, title_from(text))
            add_message(conn, sid, "user", text)

        prior = history(conn, sid)
        if not prior or prior[-1]["role"] != "user":
            raise HTTPException(422, detail={"code": "no_message", "message": "这个对话里没有可以重新生成的提问"})

        acc_text: list[str] = []
        acc_tools: dict[str, dict] = {}
        stopped_flag = {"v": False}

        async def relay():
            saved = False

            def save() -> None:
                nonlocal saved
                if saved:
                    return
                saved = True
                content = finalize_content("".join(acc_text), stopped_flag["v"])
                if content or acc_tools or stopped_flag["v"]:
                    add_message(conn, sid, "assistant", content, list(acc_tools.values()))

            try:
                yield f"event: session\ndata: {json.dumps({'session_id': sid})}\n\n"
                headers = {"Authorization": f"Bearer {key}", "X-Hermes-Session-Id": sid}
                payload = {"model": "hermes-agent", "messages": prior, "stream": True}
                async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=None), trust_env=False) as client:
                    async with client.stream(
                        "POST", f"{url}/v1/chat/completions", json=payload, headers=headers,
                    ) as upstream:
                        if upstream.status_code != 200:
                            detail = (await upstream.aread()).decode("utf-8", "replace")[:500]
                            yield f'event: error\ndata: {{"status": {upstream.status_code}, "detail": {detail!r}}}\n\n'
                            return
                        async for chunk in iter_upstream(
                            request, upstream.aiter_text(),
                            lambda block: apply_sse_block(block, acc_text, acc_tools),
                            stopped_flag,
                        ):
                            yield chunk
            except httpx.HTTPError:
                yield 'event: error\ndata: {"code": "hermes_unreachable", "message": "连不上 Hermes，请确认它已启动"}\n\n'
            except BaseException:
                stopped_flag["v"] = True
                save()
                raise
            else:
                save()

        return StreamingResponse(relay(), media_type="text/event-stream")

    return app


def main():
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
