# 协作规则

## 角色

| 角色 | 负责 | 说明 |
|---|---|---|
| 总指挥（Claude） | 架构、接口契约、记账核心、Hermes 接入、权限与安全边界、审查合并 | 写任务卡，审查每份交付 |
| 执行（Antigravity 里的 Gemini） | 按任务卡做界面、页面、打包脚本等 | 只改任务卡允许的目录 |
| 用户 | 把任务卡交给 Gemini，在本机运行和验收，做产品决定 | 本机操作步骤写在任务卡里 |

## 归属（谁能改哪里）

| 路径 | 归属 | Gemini 可以改吗 |
|---|---|---|
| `services/core/**` | 总指挥 | 不可以 |
| `apps/desktop/src/shared/**` | 总指挥（接口契约） | 不可以，需要改就提“契约变更请求” |
| `integrations/**` | 总指挥 | 不可以 |
| `docs/**`（`docs/reports/` 除外） | 总指挥 | 不可以 |
| `docs/reports/Txx-report.md` | 执行 | 必须写 |
| `apps/desktop/**`（shared 除外） | 执行 | 按任务卡范围 |

## 流程

1. 总指挥写 `docs/tasks/Txx.md`（背景、任务、验收标准、不在范围）。
2. 用户把任务卡全文交给 Gemini。Gemini 先读本文件、`docs/CONTRACT.md` 和任务卡，再动手。
3. Gemini 完成后写 `docs/reports/Txx-report.md`，格式：
   - 完成情况：逐条对照验收标准，写 通过 / 未完成 及原因
   - 改动文件：完整列表
   - 本机怎么验证：命令和点击步骤
   - 契约变更请求：没有就写“无”
   - 遗留问题
4. 用一个提交（或一个分支）交回，提交信息以 `Txx:` 开头。
5. 总指挥写 `docs/reviews/Txx-review.md`：通过就给下一张任务卡；需返工就给一段可直接复制给 Gemini 的返工指令。

## 硬规则（所有人）

- 金额在前端一律是字符串（`Money` 类型），不要转成 `number` 做加减；需要合计时调后端。
- 前端访问后端只通过 `src/shared/api.ts`。
- 不在代码里写任何密钥；不往仓库提交 `.env`、数据库文件、`api-token`。
- 审核、记账、结账只能由人点按钮完成；AI 只能生成草稿。界面上 AI 生成的草稿要有明显标记。
- 界面风格以 `docs/prototype/app.css` 和 `docs/prototype/*.dc.html` 为准（见 `docs/CONTRACT.md` 第 4 节）。
