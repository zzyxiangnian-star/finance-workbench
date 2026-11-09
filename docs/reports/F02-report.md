# F02 报告：AI 对话

## 完成情况

1. 通过。`python -m pytest -q` 19 项通过；`npm run build` 通过。
2. 通过。假 Hermes 下发送「查一下本月差旅费凭证」，按钮先变成「停止」，结束后工具标签为「已查询凭证」，回答里的「记-0003」是可点标签，右侧栏打开这张已记账凭证（张三出差北京报销，3,560.00）。
3. 通过。关掉本机服务再拉起（同一数据目录）后，左侧「最近对话」仍在，点开历史还在。
4. 通过。生成中点「停止」，该回答只留下「（已停止）」。之后再发「再试一句」，假 Hermes 正常回答并再次标出记-0003。
5. 通过。关掉假 Hermes 后发送，页面出现「连不上 Hermes，请确认它已启动」，顶栏状态点变红。
6. 通过。不设 `HERMES_API_KEY` 时状态点为灰，悬浮提示是「按 docs/tasks/T02.md 配置 Hermes」。
7. 未验证。这台环境没有真 Hermes，不能核对「11 月管理费用一共多少 → 4840.00」。
8. 通过。浅色、深色、出错三张截图都是 1440×900。

## 改动文件

- `services/core/src/finance_core/db.py`：SCHEMA_VERSION 2，新增 chat_sessions、chat_messages
- `services/core/src/finance_core/chat_store.py`：会话和消息
- `services/core/src/finance_core/ledger.py`：`lookup_vouchers`
- `services/core/src/finance_core/api.py`：会话接口、Hermes 状态、改写 POST /api/chat、凭证号查找
- `services/core/src/finance_core/dev/fake_hermes.py`：假 Hermes
- `services/core/tests/test_api.py`
- `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/pages/ChatPage.tsx`
- `apps/desktop/src/components/ConfirmBar.tsx`
- `apps/desktop/src/components/Sidebar.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/routes.ts`
- `apps/desktop/src/styles/desktop.css`
- `apps/desktop/package.json`、`package-lock.json`：react-markdown、remark-gfm
- `docs/CONTRACT.md`
- `THIRD_PARTY.md`
- `docs/reports/img/F02-light.png`、`F02-dark.png`、`F02-error.png`

## 契约和规则改动

- 新表：`chat_sessions`、`chat_messages`。旧库打开时把 `meta.schema_version` 升到 2。
- `POST /api/chat` 请求体改为 `{message, session_id?, regenerate?}`。第一个 SSE 事件是 `event: session`。
- 新增 `GET/PATCH/DELETE /api/chats`、`GET /api/chats/{id}`、`GET /api/hermes/status`、`GET /api/vouchers/lookup`（注册在 `/api/vouchers/{id}` 之前）。
- 账务校验没有放宽。MCP 没有增加审核、记账、结账、删除、改科目。
- 访问本机 Hermes 的 httpx 客户端使用 `trust_env=False`。这台机器的 HTTP 代理会让发往 127.0.0.1 的请求得到 502。

## 本机怎么验证

```text
$env:HERMES_API_KEY="f02-dev-key"
$env:PYTHONPATH="services\core\src"
python -m finance_core.dev.fake_hermes

$env:FW_DEMO="1"
$env:HERMES_API_URL="http://127.0.0.1:8642"
python -m finance_core.api
```

桌面端打开 `/#/chat`。空状态三个建议可直接发送。Enter 发送，Shift+Enter 换行。生成中按钮是「停止」。

## 第三方代码

`react-markdown`、`remark-gfm`，均为 MIT，作为依赖安装，没有把源码拷进仓库。见 `THIRD_PARTY.md`。

## 疑问

- 右侧凭证详情复用主分支的 `VoucherDetail`。已记账凭证显示「不能修改」，审核和记账按钮按原组件的状态规则出现。
- 重新生成请求带 `regenerate: true`，不另插一条用户消息。
- 客户端中途断开的保存逻辑有单独测试（`iter_upstream`）。Starlette TestClient 和 httpx ASGITransport 都会先收完整段 SSE，测不出中途取消。
