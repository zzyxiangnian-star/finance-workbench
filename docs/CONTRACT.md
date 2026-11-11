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
| GET | /api/accounts | 科目列表（`include_disabled`）。每项多 `py`：名称拼音首字母小写，分隔符保留，如管理费用-办公费 → `glfy-bgf` |
| GET | /api/accounts/{code}/balance | 单科目余额：`period`、`include_unposted`（默认 false）。返回 opening/debit/credit/closing |
| GET | /api/summaries | 最近摘要：`q`、`limit`（默认 10）。去重，按最近使用时间倒序，返回字符串数组 |
| GET | /api/periods | 期间列表 |
| POST | /api/periods/{p}/close | 结账 |
| GET | /api/vouchers | 查询：period, date_from, date_to, status, keyword, account_code(前缀), min_amount, max_amount, limit, offset → `{total, items}` |
| POST | /api/vouchers | 新建（总是草稿） |
| GET | /api/vouchers/next-number | 预览下一号：`period`、`word`（默认记）→ `{"display_no":"记-0006"}`。不占号，保存时仍由后端分配 |
| GET/PUT/DELETE | /api/vouchers/{id} | 取 / 改（仅草稿）/ 删（仅草稿） |
| POST | /api/vouchers/{id}/review | 审核（审核人 ≠ 制单人） |
| POST | /api/vouchers/{id}/unreview | 反审核（仅原审核人，未记账） |
| POST | /api/vouchers/{id}/post | 记账（仅已审核） |
| GET | /api/reports/trial-balance | 科目余额表：period, include_unposted |
| GET | /api/opening-balances | 期初余额、本年累计、试算平衡、建账期间、是否锁定 |
| PUT | /api/opening-balances | `{start_period?, items:[{account_code, amount, ytd_debit?, ytd_credit?}]}`。只接受末级科目。不平衡也可以保存 |
| GET | /api/books/periods | 从建账期间到最后凭证期间与当月中较晚者，升序 |
| GET | /api/books/detail | 明细账：account_code, period_from, period_to, include_unposted |
| GET | /api/books/general | 总账：参数同明细账，不带分录 |
| GET | /api/audit | 操作日志 |
| POST | /api/chat | `{message, session_id?, regenerate?}` → SSE。第一个事件是 `event: session`（`session_id`）。随后是 Hermes 的文字和 `hermes.tool.progress`。没有 session_id 就新建会话，标题取第一句话前 20 个字。客户端断开时，已生成的内容末尾记「（已停止）」 |
| GET | /api/chats | 会话列表，按 updated_at 倒序 |
| GET | /api/chats/{id} | 会话和全部消息 |
| PATCH | /api/chats/{id} | `{title}` 改标题 |
| DELETE | /api/chats/{id} | 删除会话 |
| GET | /api/hermes/status | `{configured, reachable, model}`。未配置密钥时 configured 为 false；请求 Hermes `/v1/models`，超时 2 秒 |
| GET | /api/vouchers/lookup | `no`（如记-0003）、可选 `period`。不给期间时返回所有期间里匹配的凭证 |

类型定义以 `apps/desktop/src/shared/api.ts` 为准。

## 3. 行为约定

1. 凭证状态：草稿 → 已审核 → 已记账。只有草稿能改、能删。
2. 凭证号按期间、凭证字连续编号（记-0001 起），删除草稿会留空号，第一期不自动重排。
3. 审核人不能是制单人；AI 身份不能审核、反审核、记账、结账。这些由后端拦截，前端也要隐藏或禁用对应按钮。
4. `source = "ai"` 的凭证是 AI 草稿，界面必须显示“AI 草稿”标记。
5. 已结账期间不能新增、修改凭证。
6. 凭证日期不能早于建账期间。已有凭证时不能改建账期间。有已记账凭证或已结账期间后期初余额和本年累计不能再改。期初不平衡时不能记账。损益类科目的期初必须为 0。
7. 余额默认只算已记账；界面可切换“含未记账”。
8. AI 回答里出现凭证号（如 `记-0003`）时，前端把它渲染成可点击标签，点开右侧栏显示该凭证（`GET /api/vouchers/lookup`）。第一期按正则 `记-\d{4}` 识别。

## 4. 界面约定

- 样式基准：`docs/prototype/app.css`（CSS 变量、侧栏、分割线、按钮、下拉、悬浮提示），直接搬进 `apps/desktop/src/styles/`，保留变量名和类名。
- 页面结构参考 `docs/prototype/*.dc.html`（原型里的 `{{…}}`、`<sc-if>` 是原型工具语法，改写成 React）。
- 布局：左侧导航（可收起）| 中间主区 | 右侧栏（可关），栏间 1px 分割线可拖动调宽，宽度记在 localStorage。
- 字体：标题衬线（Noto Serif SC），正文无衬线（系统字体 / Noto Sans SC）。打包时字体放本地，不走网络。
- 浅色为主，支持深色（`.app.dark`）。
- 所有图标按钮必须有悬浮提示（原型里的 `.tip`）。下拉菜单用原型里的 `.menu` 动效。
