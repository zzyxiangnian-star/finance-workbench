# 财务工作台

公司财务部门用的本地桌面应用：完整记账 + AI 助手（Hermes Agent）。

```
apps/desktop/        Tauri + React 桌面端（界面）
  src/shared/api.ts  前端与本机服务的接口契约（只由总指挥修改）
services/core/       Python 本机服务：记账核心、HTTP 接口、给 Hermes 的 MCP 财务工具
integrations/hermes/ Hermes Agent 的专用配置（profile: finance）
docs/                协作规则、接口契约、决定记录、任务卡、报告、审查、界面原型
```

## 运行本机服务（开发）

```bash
cd services/core
python -m venv .venv && .venv\Scripts\activate      # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
pytest                                             # 17 项测试
set FW_DEMO=1 && finance-core                      # 带演示数据启动，监听 127.0.0.1:8765
```

令牌在数据目录的 `api-token` 文件里（Windows：`%APPDATA%\FinanceWorkbench\api-token`）。

## 接入 Hermes

见 `integrations/hermes/` 和任务卡 `docs/tasks/T02.md`。

## 分工

见 `docs/README.md`。
