# 财务工作台第一期：Cursor 开发计划书

> 写给 Cursor。总指挥：Claude（计划、任务卡、审查、界面把关）。执行：Cursor（写代码、测试、报告）。验收：用户在自己的 Windows 电脑上运行。
> 本地工程：`C:\Users\30882\Desktop\财务工作台`（GitHub：zzyxiangnian-star/finance-workbench）

## 1. 目标

第一期做完后，财务部可以在工作台里完整记一个月的账（录凭证、审核、记账、看账簿和余额表、结账、出两张报表），并能让 AI 查账、根据发票生成草稿凭证。

## 2. 现在已经有的（不要重做）

| 部分 | 位置 | 说明 |
|---|---|---|
| 记账核心 | `services/core/src/finance_core/ledger.py` | 科目、凭证增删改查、审核/反审核/记账、结账、科目余额表、操作日志，17 项测试 |
| 本机服务 | `services/core/src/finance_core/api.py` | FastAPI，127.0.0.1:8765，令牌 + 操作人头，`/api/chat` 转发 Hermes |
| Hermes 财务工具 | `services/core/src/finance_core/mcp_server.py` | 查凭证、查余额、余额表、建草稿凭证 |
| 接口契约 | `apps/desktop/src/shared/api.ts`、`docs/CONTRACT.md` | 前端唯一的后端入口 |
| 桌面端外壳 | `apps/desktop/src/components/` | 三栏可拖动、Ctrl K、深色模式、切换操作人 |
| 记账页（只读部分） | `apps/desktop/src/pages/LedgerPage.tsx` | 凭证列表、筛选、右侧详情、审核/记账按钮 |
| 界面原型 | `docs/prototype/*.dc.html` | 11 个页面的设计稿，界面以它为准 |

## 3. 架构（不要改动这个结构）

```
Tauri 窗口（React） ──HTTP+令牌──▶ 本机服务 FastAPI :8765 ──▶ 记账核心 ──▶ SQLite
                                        └─/api/chat 转发──▶ Hermes :8642 ──stdio──▶ 财务 MCP 工具 ──▶ 记账核心
```

## 4. 任务卡顺序

| 卡 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| F01 | 凭证录入：新增/编辑/删除草稿/复制凭证、科目选择器、借贷实时合计、快捷键 | — | 已发 |
| F02 | AI 对话页：流式回答、工具进度、凭证号标签点开右侧栏、会话列表 | — | 已发（可与 F01 并行，不同分支） |
| F03 | 账簿：明细账、总账、期初余额录入与试算平衡 | F01 | 待写 |
| F04 | 期末：结转损益生成凭证、结账/反结账、科目余额表页、导出 Excel | F03 | 待写 |
| F05 | 报表：资产负债表、利润表（小企业会计准则格式）、导出 | F04 | 待写 |
| F06 | 发票中心后端：导入 PDF/OFD/图片、字段识别、查重、文件存储、MCP 工具 | — | 待写 |
| F07 | 发票中心界面：列表、预览、核对字段、生成草稿凭证 | F01、F06 | 待写 |
| F08 | 打包：Tauri 拉起本机服务和 Hermes、Windows 安装包、自动备份 | 全部 | 待写 |

每张卡审查通过、合并后，Claude 再写下一张卡，因为前一张的结果会影响下一张的细节。

## 5. 每张卡的流程

1. 用户把任务卡发给 Cursor（或者直接说“做 F01”，Cursor 自己读 `docs/tasks/F01.md`）。
2. Cursor 先列实施计划，用户确认后开始写代码。
3. Cursor 在分支 `fxx-…` 上提交，写 `docs/reports/Fxx-report.md`，推送分支。
4. 用户告诉 Claude“Fxx 做完了”。
5. Claude 拉分支审查：跑测试、在云端起服务截图检查界面，写 `docs/reviews/Fxx-review.md`。
   - 通过：Claude 合并到 main，写下一张卡。
   - 需返工：review 里有一段“返工指令”，用户原样发给 Cursor。
6. 界面细节（间距、对齐、动效、文案）Claude 可能直接在合并时小改，不需要退回。

## 6. 质量门槛（每张卡都适用）

- `cd services/core && pytest` 全部通过，新功能有测试。
- `cd apps/desktop && npm run build` 无错误。
- `.cursor/rules/00-project.mdc` 里的硬规则一条都不违反。
- 报告里写清“怎么在本机验证”，用户能照着点一遍。

## 7. 暂定默认（用户还没最终确认，按这个做）

- 单机 SQLite，表结构可迁 PostgreSQL；没有登录，界面里选当前操作人。
- Windows 优先。科目表按《小企业会计准则》。暂不做旧软件数据导入。
