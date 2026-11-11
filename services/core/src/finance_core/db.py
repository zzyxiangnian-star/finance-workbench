"""SQLite 存储。第一期单机 SQLite（WAL），表结构保持可迁移到 PostgreSQL：
不用 SQLite 特有类型，金额用整数分，时间用 ISO 字符串。"""

import sqlite3
from pathlib import Path

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 会计科目。category: asset 资产 / liability 负债 / common 共同 / equity 所有者权益 / cost 成本 / pl 损益
-- direction: debit 借 / credit 贷（余额方向）
CREATE TABLE IF NOT EXISTS accounts (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('asset','liability','common','equity','cost','pl')),
    direction   TEXT NOT NULL CHECK (direction IN ('debit','credit')),
    parent_code TEXT REFERENCES accounts(code),
    enabled     INTEGER NOT NULL DEFAULT 1
);

-- 会计期间，形如 2026-11。status: open / closed
CREATE TABLE IF NOT EXISTS periods (
    period    TEXT PRIMARY KEY,
    status    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_by TEXT,
    closed_at TEXT
);

-- 期初余额（按科目余额方向记，正数）
CREATE TABLE IF NOT EXISTS opening_balances (
    account_code TEXT NOT NULL REFERENCES accounts(code),
    period       TEXT NOT NULL,
    cents        INTEGER NOT NULL,
    PRIMARY KEY (account_code, period)
);

-- 凭证。status: draft 草稿 / reviewed 已审核 / posted 已记账
-- source: manual 人工 / ai AI 草稿 / import 导入
CREATE TABLE IF NOT EXISTS vouchers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    period      TEXT NOT NULL REFERENCES periods(period),
    word        TEXT NOT NULL DEFAULT '记',
    number      INTEGER NOT NULL,
    date        TEXT NOT NULL,
    attachments INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewed','posted')),
    source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai','import')),
    maker       TEXT NOT NULL,
    reviewer    TEXT,
    poster      TEXT,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE (period, word, number)
);

CREATE TABLE IF NOT EXISTS voucher_lines (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_id   INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
    line_no      INTEGER NOT NULL,
    summary      TEXT NOT NULL,
    account_code TEXT NOT NULL REFERENCES accounts(code),
    debit_cents  INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
    credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON voucher_lines(account_code);

-- 操作日志：只追加
CREATE TABLE IF NOT EXISTS audit_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     TEXT NOT NULL,
    actor  TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
);

-- AI 对话。session id 用文本，消息用自增序号保证顺序。
CREATE TABLE IF NOT EXISTS chat_sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content     TEXT NOT NULL,
    tools_json  TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

-- 建账前的本年累计发生额（年初到建账期间之前）。金额为整数分。
CREATE TABLE IF NOT EXISTS opening_ytd (
    account_code TEXT NOT NULL REFERENCES accounts(code),
    period       TEXT NOT NULL,
    debit_cents  INTEGER NOT NULL DEFAULT 0,
    credit_cents INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_code, period)
);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if str(path) != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    if int(row["value"]) < SCHEMA_VERSION:
        conn.execute("UPDATE meta SET value = ? WHERE key = 'schema_version'", (str(SCHEMA_VERSION),))
    return conn
