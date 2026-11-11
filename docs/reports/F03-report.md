# F03 报告：账簿

## 完成情况

1. 通过。`services/core` 里 `python -m pytest -q` 27 项通过。`apps/desktop` 里 `npm test` 4 项通过，`npm run build` 通过。
2. 通过。演示账 100201、2026-11、只含已记账：期初借 500,000.00，记-0001 贷方 1,280.00，余额借 498,720.00，本月贷方合计 1,280.00。
3. 通过。同一科目打开「含未记账」后，多出记-0004 借方 113,000.00、记-0005 贷方 860.00，两行都有「未记账」标签，期末借 610,860.00。
4. 通过。上级科目 5602 只含已记账时借方合计 4,840.00，行上有科目列；含未记账后借方合计 5,700.00。
5. 通过。总账 1122、2026-11：本月借方 113,000.00，余额借 113,000.00。含未记账后借贷相抵，方向为平。点「本月合计」切到该月明细账。
6. 通过。明细账点凭证号打开右侧凭证。凭证里点科目名称，跳到该科目、该凭证期间的明细账。录入页余额卡有「查看明细账」，离开未保存凭证前会先确认。
7. 通过。空数据目录录入库存现金 10,000.00、银行存款-基本户 200,000.00、实收资本 210,000.00，底栏为「试算平衡」。实收资本改成 200,000.00 后显示「不平衡，差额 10,000.00」。
8. 通过。不平衡时审核后的凭证点记账，页面提示「期初余额不平衡（借方 210000.00，贷方 200000.00），请先调整期初」。改回平衡并保存后，记账成功。再打开期初页，输入框不可编辑，提示「已有记账凭证，期初余额不能再改」。
9. 通过。另一空目录把建账期间改成 2026-07，出现年初余额、本年累计借方、本年累计贷方。主营业务收入本年累计贷方 300,000.00，年初余额为 -300,000.00。
10. 通过。凭证日期 2026-06-30 保存时，页面提示「凭证日期早于建账期间 2026-07」。
11. 通过。没有真 Hermes。stdio 测试拉起 MCP 后，工具列表含 `detail_ledger`，调用 100201、2026-11 得到期初 500000.00、首行记-0001。
12. 通过。四张截图都是 1440×900：`docs/reports/img/F03-light.png`、`F03-general.png`、`F03-opening-dark.png`、`F03-locked.png`。

## 改动文件

- `services/core/src/finance_core/books.py`：期初、期间列表、明细账和总账
- `services/core/src/finance_core/db.py`：新增 `opening_ytd`，不升 SCHEMA_VERSION
- `services/core/src/finance_core/ledger.py`：建账期间、期初锁定、记账前试算、凭证日期不得早于建账期间
- `services/core/src/finance_core/seed.py`：首次科目写入当前月；演示账固定 2026-11
- `services/core/src/finance_core/api.py`：期初和账簿路由
- `services/core/src/finance_core/mcp_server.py`：只读工具 `detail_ledger`
- `services/core/tests/test_books.py`、`tests/test_mcp_stdio.py`
- `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/pages/BooksPage.tsx`
- `apps/desktop/src/pages/LedgerPage.tsx`、`VoucherDetail.tsx`、`VoucherEntryPage.tsx`
- `apps/desktop/src/components/AccountPicker.tsx`、`MoneyInput.tsx`
- `apps/desktop/src/styles/desktop.css`
- `apps/desktop/package-lock.json`：补齐 package.json 里已有的 vitest，让 `tsc` 能找到类型
- `docs/CONTRACT.md`
- `docs/reports/img/F03-*.png`

## 契约和规则改动

- 新表 `opening_ytd`（科目、期间、借方分、贷方分）。SCHEMA 每次连接都会执行，旧库用 `CREATE TABLE IF NOT EXISTS` 补上，`SCHEMA_VERSION` 仍是 2。
- 新增 `GET/PUT /api/opening-balances`、`GET /api/books/periods`、`GET /api/books/detail`、`GET /api/books/general`。
- `GET /api/opening-balances` 多一个 `start_locked`：已有任意凭证时不能改建账期间，金额仍可能可改。
- 记账前检查期初试算。不平衡时 `opening_unbalanced`。凭证期间早于建账期间时 `before_start`。已记账或已结账后改期初为 `opening_locked`。损益类期初必须为 0，`pl_opening`。AI 改期初为 `ai_forbidden`。
- 原有借贷平衡、审核人不得是制单人、已结账不能改，都没有放宽。MCP 只增加只读的 `detail_ledger`，没有审核、记账、结账、删除、改科目。
- 演示账数据没有改。

## 本机怎么验证

1. `cd services/core`，`python -m pytest -q`。
2. `cd apps/desktop`，`npm test`，`npm run build`。
3. 演示数据：`FW_DEMO=1`、`FW_API_TOKEN=f01-dev-token`，打开 `#/ledger?tab=books&book=detail&account=100201&from=2026-11&to=2026-11`。再看 5602、总账 1122，以及「含未记账」。
4. 空目录不要设 `FW_DEMO`。期初页录入三个金额，看底栏；改实收资本后再看。记账失败和锁定按验收第 8 条走一遍。
5. 另一个空目录把建账期间改成 2026 年 7 月，主营业务收入本年累计贷方填 300000，看年初余额。凭证日期改成 2026-06-30 再保存。

## 第三方代码

没有新增依赖。`package-lock.json` 只是装上仓库里已经声明的 vitest。

## 疑问和遗留问题

- 已结账锁定和已记账锁定共用 `opening_locked`，句子不同：结账是「已有结账期间，期初余额不能再改」。
- 年初余额按科目方向折成有符号数。贷方科目、本年累计贷方 300,000、期初为 0 时，年初余额是 `-300,000.00`。
- 总账和明细账共用 `ledger_book`。总账响应里没有 `lines`。
- 本年累计包含查询范围之前、同一年里已经发生的月份；`opening_ytd` 只加进建账所在年度。

## 截图

- `docs/reports/img/F03-light.png`：明细账，浅色
- `docs/reports/img/F03-general.png`：总账
- `docs/reports/img/F03-opening-dark.png`：期初余额，深色，试算平衡
- `docs/reports/img/F03-locked.png`：期初已锁定
