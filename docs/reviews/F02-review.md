# F02 AI 对话页 审查

- 分支：`f02-ai-chat`（Cursor 提交 ab11fa5）
- 审查人：Claude（总指挥）
- 结论：**通过**。合并 main 时的冲突和一处输入框样式由 Claude 处理。

## 核对了什么

- 合并 main（F01）后：`pytest` 20 项、`tsc`、`npm run build`、`npm test`（4 项）全过。
- 真界面（假 Hermes + 演示数据，Playwright）：
  - 发送后文字逐段出现，工具标签从“查询凭证”变成“已查询凭证”。
  - “记-0003”是可点标签，点开右侧栏显示这张凭证。
  - 刷新后历史还在，“最近对话”列表有这一条，地址是 `/chat/<id>`。
  - 关掉假 Hermes 再发：显示“连不上 Hermes，请确认它已启动”，顶栏状态点变红。
  - 深色模式正常。
- 没验证：真 Hermes（验收第 7 条）。要等用户装好 Hermes（T02）。
- 没复测：生成中点“停止”。靠 Cursor 的报告和 `iter_upstream` 的单元测试。

## Claude 做的

1. **合并冲突**：F02 是在 F01 之前拉的分支，和 main 在 `App.tsx`、`routes.ts`、`ConfirmBar.tsx`、`desktop.css`、`api.py`、`THIRD_PARTY.md`、`package-lock.json` 上冲突。`ConfirmBar` 用 F01 的写法（`confirmLabel`、`onConfirm`），对话页的调用跟着改；路由用 main 的 `createHashRouter` 并加上 `/chat`、`/chat/:id`；锁文件重新生成。
2. **右侧栏凭证详情**：F01 给 `VoucherDetail` 加了必填的 `onDeleted`，对话页没传，类型检查不过。补上，删除后关闭右侧栏。
3. **输入框样式**：外面一层圆角卡片，里面又一个带边框的输入框，聚焦时还有蓝色系统轮廓，看着是两个框。改成原型里那样的单个圆角卡片，输入框无边框，发送按钮在卡片右下。

## 小意见

- 对话页没有重新生成之外的“编辑上一句”，不在卡里，先不做。
- `package.json` 里 `react-markdown`、`remark-gfm` 用了 `^`，规则要求写死版本，下次一起改。
