# dsh-market 0.1.0 验证记录

验证日期：2026-11-12（Asia/Shanghai）。

- TypeScript 类型检查通过；22 项确定性测试全部通过。
- `npm pack` 生成约20 KiB的安装包；检查包含运行文件与 Cordis 补丁、不含 node_modules/连接配置。另在临时空目录以生产依赖安装该 tgz，成功加载插件导出，验证后清理临时目录。
- 真实 Cordis 4.1.0、dsh ToolRuntime 0.2.2-rc.1、原生执行器 0.2.2-rc.1：通过导出的插件对象及 Config 加载，查询输入验证、规范输出、SVG/CSV 原生附件、卸载清理及进行中请求取消均通过。
- dsh 0.2.0-rc.2 / Cordis 4.0.x：使用现有旧版依赖独立验证工具注册与报价执行通过。
- 真实 Binance API：BTCUSDT 最新成交与滚动24小时行情、10根/72根小时K线、5档双边盘口通过。
- 真实 Binance 连续采样：2次、间隔2秒，`complete=true`，源成交时间由 `2026-11-12T01:41:10.073Z` 更新为 `2026-11-12T01:41:12.532Z`。
- 72根真实小时K线渲染为 SVG，再使用 rsvg-convert 渲染 PNG 并视觉检查：价格蜡烛图、成交量、UTC横轴、来源信息、当前未收盘虚线柱均正常。示例见 [图表](docs/chart-example.png)。
- 模拟 Alpaca 接口验证 IEX 来源、请求头鉴权、前收盘涨跌、空成交、延迟 SIP 截止时间、稳定分页，以及纽约时区夏令时和月份边界。

当前环境未配置 Alpaca Key，真实美股连接验证明确跳过；未声称已验证账户权限或实际美股行情。
实时更新采用按需 REST 查询和有界轮询，采样结束后统一返回，不包含后台 WebSocket 订阅或永久盯盘。

## 0.1.1：对话正文内嵌预览

旧版 market_chart 仅返回 SVG/CSV 文件块，回归用例可复现没有 PNG 和内嵌图片语法。
新版额外渲染真实 PNG，返回可信附件路径组成的 inlineMarkdown，并明确指导最终回答内嵌图片。
23 项测试通过，覆盖 PNG 签名和尺寸、原生工具输出、带空格路径及无本机路径后端的明确降级。
使用真实 BTCUSDT 最近48根小时K线生成 PNG 并视觉检查，示例见 docs/inline-example.png。
PNG 渲染依赖采用预编译的 resvg-js，无需宿主额外安装绘图命令或允许构建脚本。

## 0.2.0：离线交互 HTML

25项测试通过；原生工具额外返回HTML附件与interactiveMarkdown链接，HTML保留本页全部数据。
浏览器中使用真实180根BTCUSDT小时K线，验证十字光标价格、悬停OHLCV、滚轮缩放、拖动平移、最近50根和重置。
在与dsh相同的sandbox="allow-scripts"（无allow-same-origin）iframe中成功加载，关闭脚本时保留静态SVG回退。
HTML内嵌图表库与数据，不使用CDN、行情请求或密钥；保留TradingView署名及Apache-2.0许可。
界面验证截图：docs/interactive-preview.png；离线示例：docs/interactive-example.html。
