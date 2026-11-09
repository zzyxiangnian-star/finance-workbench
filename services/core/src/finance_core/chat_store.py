"""对话会话存储。不涉及账务规则。"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def title_from(message: str) -> str:
    text = " ".join(message.split())
    return text[:20] or "新对话"


def _message(row: sqlite3.Row) -> dict:
    tools = json.loads(row["tools_json"] or "[]")
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "tools": tools,
        "created_at": row["created_at"],
    }


def list_sessions(conn: sqlite3.Connection, limit: int = 50) -> list[dict]:
    rows = conn.execute(
        "SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC, id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_session(conn: sqlite3.Connection, sid: str) -> dict | None:
    row = conn.execute("SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id = ?", (sid,)).fetchone()
    if row is None:
        return None
    msgs = conn.execute(
        "SELECT id, role, content, tools_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY id",
        (sid,),
    ).fetchall()
    return {**dict(row), "messages": [_message(m) for m in msgs]}


def create_session(conn: sqlite3.Connection, title: str) -> str:
    sid = uuid.uuid4().hex
    t = now()
    conn.execute(
        "INSERT INTO chat_sessions(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (sid, title, t, t),
    )
    return sid


def rename_session(conn: sqlite3.Connection, sid: str, title: str) -> dict | None:
    t = now()
    conn.execute("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?", (title, t, sid))
    row = conn.execute(
        "SELECT id, title, created_at, updated_at FROM chat_sessions WHERE id = ?", (sid,)
    ).fetchone()
    return dict(row) if row else None


def delete_session(conn: sqlite3.Connection, sid: str) -> bool:
    cur = conn.execute("DELETE FROM chat_sessions WHERE id = ?", (sid,))
    return cur.rowcount > 0


def add_message(conn: sqlite3.Connection, sid: str, role: str, content: str, tools: list | None = None) -> None:
    t = now()
    conn.execute(
        "INSERT INTO chat_messages(session_id, role, content, tools_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (sid, role, content, json.dumps(tools or [], ensure_ascii=False), t),
    )
    conn.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", (t, sid))


def history(conn: sqlite3.Connection, sid: str) -> list[dict]:
    rows = conn.execute(
        "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id",
        (sid,),
    ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def drop_last_assistant(conn: sqlite3.Connection, sid: str) -> None:
    row = conn.execute(
        "SELECT id, role FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1",
        (sid,),
    ).fetchone()
    if row is not None and row["role"] == "assistant":
        conn.execute("DELETE FROM chat_messages WHERE id = ?", (row["id"],))
