# 协作规则

> 2026-11-09 起：Cursor 负责写代码，Claude 负责计划书、任务卡、审查和界面把关。
> 计划书：`docs/cursor/PLAN.md`；界面规范：`docs/UI.md`；Cursor 自动读取的规则：`.cursor/rules/`。

## 角色

| 角色 | 负责 |
|---|---|
| Claude（总指挥） | 计划书、任务卡、审查合并、界面把关（审界面、必要时直接改样式和交互细节）、账务规则和安全边界的最终把关 |
| Cursor（执行） | 按任务卡写前后端代码、测试、报告 |
| 用户 | 把任务交给 Cursor，在 Windows 电脑上运行验收，做产品决定，完成 T02（本机装 Hermes） |

## 改动范围

Cursor 可以改前后端代码，但以下内容只能新增、不能削弱，改动必须在报告里单独列出：

| 内容 | 位置 |
|---|---|
| 账务校验规则 | `services/core/src/finance_core/ledger.py` |
| AI 工具权限（只能查和建草稿） | `services/core/src/finance_core/mcp_server.py` |
| 接口契约 | `apps/desktop/src/shared/api.ts`、`docs/CONTRACT.md`（三处同步改） |
| 原型样式 | `apps/desktop/src/styles/app.css`（不改，补充写 `desktop.css`） |

`docs/` 下除 `docs/reports/` 外都由 Claude 维护。

## 交付流程

1. 用户让 Cursor 做 `docs/tasks/Fxx.md`。Cursor 先列计划，用户确认后开工。
2. Cursor 在分支 `fxx-…` 提交，写 `docs/reports/Fxx-report.md`：
   - 完成情况：逐条对照验收标准，写 通过 / 未完成 / 未验证 及原因
   - 改动文件：完整列表
   - 契约和规则改动：新增了哪些接口、表、校验
   - 本机怎么验证：命令和点击步骤
   - 第三方代码：拷了什么、许可证
   - 疑问和遗留问题
   - 截图：`docs/reports/img/Fxx-*.png`
3. 推送分支后，用户告诉 Claude“Fxx 做完了”。
4. Claude 审查，写 `docs/reviews/Fxx-review.md`：通过就合并并给下一张卡；需返工就给一段可直接发给 Cursor 的返工指令。

## 硬规则

见 `.cursor/rules/00-project.mdc`。
