# 界面规范

> Cursor 写界面时照这份做。Claude 负责界面把关，审查时会对照这里和原型截图检查。

## 1. 设计依据

- 原型：`docs/prototype/<页面>.dc.html`（用浏览器打开源码看结构；`{{…}}`、`<sc-if>`、`<sc-for>` 是原型工具语法，改写成 React）。
- 样式：`apps/desktop/src/styles/app.css` 是原型原样搬过来的，**不要改它**；补充样式写 `desktop.css`。
- 气质：苹果式白色为主、浅灰侧栏、标题衬线（Noto Serif SC）、正文无衬线。参考 Claude 桌面版，不要做成传统后台模板。

## 2. 布局

- 三栏：左导航 | 主区 | 右侧栏，外壳已做好（`Shell.tsx`），页面只管主区内容，右侧栏内容用 `<RightPane>`。
- 主区：`<main className="content">`，最大宽度 1120，内边距 24/28，区块间距 22。
- 顶栏：页面标题由外壳显示；页面级按钮（期间、刷新、新建）用 `<TopActions>` 放进顶栏。
- 页面内的二级切换用 `.tabs`，筛选条用 `.ddbtn` 下拉 + `.sbox` 搜索框横排，主按钮 `.btn.pri` 靠右。
- 数据表用 `.box > .scroll > table.tbl`，金额列 `.num`（右对齐、等宽数字），底部汇总条用 `.cap`。

## 3. 组件清单（已有，直接用）

| 需要 | 用 | 位置 |
|---|---|---|
| 图标 | `<Icon name="…" />` | components/Icon.tsx |
| 悬浮提示 | 父元素加 `tt` 类 + `<Tip>` | components/Tip.tsx |
| 下拉单选 | `<Dropdown>` | components/Dropdown.tsx |
| 右侧栏 / 顶栏按钮 | `<RightPane>` / `<TopActions>` | components/RightPane.tsx |
| 状态、来源标签 | `<StatusTag>` / `<SourceTag>` | components/Status.tsx |
| 提示条 | `<Alert kind="bad|ok">` | components/Status.tsx |
| 金额格式化、合计 | `formatMoney`、`sumMoney`、`toCents` | lib/format.ts |
| 本地偏好 | `usePersistent` | lib/persist.ts |
| 防抖 | `useDebounced` | lib/useDebounced.ts |

缺的通用组件（例如确认条、输入联想框、对话气泡）按任务卡要求新建在 `components/`，写法和现有组件一致。

## 4. 细节要求

- **所有图标按钮必须有悬浮提示**，所有输入框有 `aria-label` 或 `<label>`。
- 状态色：待审核 `warn`、已审核 `ok`、已记账灰色、错误 `bad`、AI 相关 `ai`（蓝）。不要自己发明颜色，只用 CSS 变量。
- 金额：千分位、两位小数、右对齐；0 显示为空，不显示 `0.00`（合计行除外）。
- 日期：列表里 `MM-DD`，详情里 `YYYY-MM-DD`；期间显示为“2026 年 11 月”。
- 加载中用骨架条 `.skel`，不要用转圈；空状态用 `.empty`（一句衬线标题 + 一句说明）。
- 动效：只用原型里有的（`pop`、`fade`、`slide`，时长 0.12–0.2s），不加弹跳和大位移。
- 深色模式下检查一遍：不能出现写死的白底或黑字。
- 键盘：表格行 Tab 可聚焦、Enter 打开；弹层 Esc 关闭；录入类界面支持 Enter/Tab 换格。

## 5. 交付截图

报告里附三张截图（放 `docs/reports/img/`）：浅色、深色、出错或空状态。分辨率 1440×900。
