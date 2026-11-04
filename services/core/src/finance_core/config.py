"""运行配置：全部来自环境变量，便于 Tauri 启动时注入。"""

import os
import secrets
from dataclasses import dataclass
from pathlib import Path


def default_data_dir() -> Path:
    # Windows 优先：%APPDATA%\FinanceWorkbench；其他系统 ~/.finance-workbench
    appdata = os.environ.get("APPDATA")
    return Path(appdata) / "FinanceWorkbench" if appdata else Path.home() / ".finance-workbench"


@dataclass
class Settings:
    data_dir: Path
    db_path: Path
    host: str
    port: int
    token: str

    @classmethod
    def from_env(cls) -> "Settings":
        data_dir = Path(os.environ.get("FW_DATA_DIR") or default_data_dir())
        data_dir.mkdir(parents=True, exist_ok=True)
        token = os.environ.get("FW_API_TOKEN") or _load_or_create_token(data_dir)
        return cls(
            data_dir=data_dir,
            db_path=Path(os.environ.get("FW_DB_PATH") or data_dir / "ledger.db"),
            host=os.environ.get("FW_HOST", "127.0.0.1"),
            port=int(os.environ.get("FW_PORT", "8765")),
            token=token,
        )


def _load_or_create_token(data_dir: Path) -> str:
    """本机服务令牌：防止本机其他程序或网页随意调用接口。Tauri 读取同一个文件。"""
    f = data_dir / "api-token"
    if f.exists():
        return f.read_text().strip()
    t = secrets.token_urlsafe(32)
    f.write_text(t)
    try:
        f.chmod(0o600)
    except OSError:
        pass
    return t
