# 接口与行为契约 v0.1

## 1. 进程结构

```
┌────────── Tauri 桌面端（WebView：React）──────────┐
│  src/shared/api.ts ──HTTP──▶ 本机服务 127.0.0.1:8765 │
└───────────────────────────────────────────────────┘
          本机服务（services/core, FastAPI）
            ├─ 记账核心 ledger.py ──▶ SQLite（数据目录/ledger.db）
            └─ /api/chat ──转发──▶ Hermes API Server 127.0.0.1:8642
                                     └─ stdio ▶ finance MCP 工具（mcp_server.py，同一个 SQLite）
```

- Tauri 负责拉起本机服务和 Hermes（第一期开发时可手动启动），读取数据目录里的 `api-token` 交给前端。
- 前端只和本机服务说话；Hermes 的 `API_SERVER_KEY` 不进 WebView。
- 数据目录：Windows `%APPDATA%\FinanceWorkbench`，其他系统 `~/.finance-workbench`，可用 `FW_DATA_DIR` 覆盖。

## 2. HTTP 接口

所有 `/api/*`（除 `/api/health`）都要带：
- `Authorization: Bearer <api-token>`
- `X-FW-User: <URL 编码的操作人姓名>`（写操作必需）。以 `ai:` 开头的身份会被拒绝。

错误统一格式：`{"error": {"code": "unbalanced", "message": "借贷不平衡：…"}}`（业务错误 HTTP 422）。
`message` 可以直接显示给用户。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 健康检查，不需要令牌 |
| GET | /api/accounts | 科目列表（`include_disabled`） |
| GET | /api/periods | 期间列表 |
| POST | /api/periods/{p}/close | 结账 |
| GET | /api/vouchers | 查询：period, date_from, date_to, status, keyword, account_code(前缀), min_amount, max_amount, limit, offset → `{total, items}` |
| POST | /api/vouchers | 新建（总是草稿） |
| GET/PUT/DELETE | /api/vouchers/{id} | 取 / 改（仅草稿）/ 删（仅草稿） |
| POST | /api/vouchers/{id}/review | 审核（审核人 ≠ 制单人） |
| POST | /api/vouchers/{id}/unreview | 反审核（仅原审核人，未记账） |
| POST | /api/vouchers/{id}/post | 记账（仅已审核） |
| GET | /api/reports/trial-balance | 科目余额表：period, include_unposted |
| GET | /api/audit | 操作日志 |
| POST | /api/chat | `{messages, session_id?}` → SSE（Hermes 原样转发） |

类型定义以 `apps/desktop/src/shared/api.ts` 为准。

## 3. 行为约定

1. 凭证状态：草稿 → 已审核 → 已记账。只有草稿能改、能删。
2. 凭证号按期间、凭证字连续编号（记-0001 起），删除草稿会留空号，第一期不自动重排。
3. 审核人不能是制单人；AI 身份不能审核、反审核、记账、结账。这些由后端拦截，前端也要隐藏或禁用对应按钮。
4. `source = "ai"` 的凭证是 AI 草稿，界面必须显示“AI 草稿”标记。
5. 已结账期间不能新增、修改凭证。
6. 余额默认只算已记账；界面可切换“含未记账”。
7. AI 回答里出现凭证号（如 `记-0003`）时，前端把它渲染成可点击标签，点开右侧栏显示该凭证（用 `api.vouchers({keyword})` 或 id 查）。第一期按正则 `记-\d{4}` 识别。

## 4. 界面约定

- 样式基准：`docs/prototype/app.css`（CSS 变量、侧栏、分割线、按钮、下拉、悬浮提示），直接搬进 `apps/desktop/src/styles/`，保留变量名和类名。
- 页面结构参考 `docs/prototype/*.dc.html`（原型里的 `{{…}}`、`<sc-if>` 是原型工具语法，改写成 React）。
- 布局：左侧导航（可收起）| 中间主区 | 右侧栏（可关），栏间 1px 分割线可拖动调宽，宽度记在 localStorage。
- 字体：标题衬线（Noto Serif SC），正文无衬线（系统字体 / Noto Sans SC）。打包时字体放本地，不走网络。
- 浅色为主，支持深色（`.app.dark`）。
- 所有图标按钮必须有悬浮提示（原型里的 `.tip`）。下拉菜单用原型里的 `.menu` 动效。
