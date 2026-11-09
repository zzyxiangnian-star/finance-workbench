# 第三方代码记录

工作台只在公司内部使用，可以直接拷贝开源代码（包括 GPL）。每段拷进来的代码在这里记一行；
以后如果要对外分发，先处理这里列出的 GPL/AGPL 部分（开源或替换）。

| 日期 | 拷进来的位置 | 来源项目与文件 | 许可证 | 说明 |
|---|---|---|---|---|
| — | — | 暂无 | — | 目前全部为自写代码；样式和图标来自本项目自己的界面原型 docs/prototype |
| 2026-11-09 | services/core 依赖 pypinyin（未拷源码） | pypinyin（mozillazg/python-pinyin） | MIT | 科目名称拼音首字母，整词调用 Style.FIRST_LETTER |
| 2026-11-09 | apps/desktop 开发依赖 vitest（未拷源码） | vitest（vitest-dev/vitest） | MIT | 前端单元测试，覆盖金额格式和大写金额 |
| 2026-11-09 | apps/desktop 依赖 react-markdown、remark-gfm | remarkjs/react-markdown、remarkjs/remark-gfm | MIT | 对话页渲染 Markdown，未拷贝源码 |
