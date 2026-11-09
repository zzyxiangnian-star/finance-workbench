"""OpenAI 兼容的假 Hermes，没装真 Hermes 时用来开发和测试对话页。

    python -m finance_core.dev.fake_hermes

环境变量 HERMES_API_KEY 必须和本机服务一致。默认监听 127.0.0.1:8642。
"""

from __future__ import annotations

import asyncio
import json
import os

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

app = FastAPI(title="假 Hermes")


def _key() -> str:
    return os.environ.get("HERMES_API_KEY", "")


def _check(authorization: str) -> None:
    key = _key()
    if not key or authorization != f"Bearer {key}":
        raise HTTPException(401, detail="密钥不对")


@app.get("/v1/models")
def models(authorization: str = Header(default="")):
    _check(authorization)
    return {"data": [{"id": "hermes-agent"}]}


@app.post("/v1/chat/completions")
async def chat(authorization: str = Header(default="")):
    _check(authorization)

    async def gen():
        delay = float(os.environ.get("FAKE_HERMES_DELAY", "0.02"))
        await asyncio.sleep(delay)

        def event(name: str, data: dict) -> str:
            return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        yield event("hermes.tool.progress", {
            "toolCallId": "t1", "tool": "mcp_finance_search_vouchers", "status": "running",
        })
        await asyncio.sleep(delay)
        yield event("hermes.tool.progress", {
            "toolCallId": "t1", "tool": "mcp_finance_search_vouchers", "status": "completed",
        })
        for piece in ("本月差旅费见凭证 ", "记-0003", "。"):
            await asyncio.sleep(delay)
            payload = {"choices": [{"delta": {"content": piece}}]}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


def main() -> None:
    port = int(os.environ.get("FAKE_HERMES_PORT", "8642"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
