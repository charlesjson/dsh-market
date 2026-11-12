# dsh-market · 加密货币与美股行情

让 DeepSeek Harness 在对话中调用真实市场数据，查询报价、OHLCV K 线、成交量和盘口，生成可缩放、平移、悬停查看价格和 OHLCV 的离线 HTML 交互图，在对话正文内嵌 PNG 预览，并保留 SVG 与 CSV 下载。
独立插件，不需要另配大模型，不注册交易或下单功能。

可以直接向 dsh 说：

- “查询 BTC、ETH 和 NVDA 的最新行情，附数据时间。”
- “画 BTC/USDT 最近 100 根 1 小时 K 线，带成交量，导出 CSV。”
- “查看 AAPL 的日 K 线，说明数据源和是否延迟。”
- “查询 SOL/USDT 买卖前 20 档和价差。”
- “每 5 秒采样 BTC 和 ETH 的价格，共 6 次，结束后比较变化。”

## 安装

通过固定 GitHub 版本安装（安装后重启对应实例）：

```sh
dsh plugin --profile web add github:charlesjson/dsh-market#v0.2.0
```

命令行或 headless 实例使用自己的 profile，例如：

```sh
dsh plugin --profile headless add github:charlesjson/dsh-market#v0.2.0
```

桌面版在插件管理页填写 `github:charlesjson/dsh-market#v0.2.0` 后安装并启用。`desktop` profile 由 Electron 管理，npm 安装的通用 dsh CLI 会拒绝管理它；需要命令行管理时使用桌面版内置命令运行时。不要给当前 profile 同时安装两个版本。
仓库保留编译后的 `dist`，通过 GitHub 安装不需要现场编译。也可在本地 `npm pack` 后安装生成的 tgz。
包内包含 `dist` 运行文件；安装 tarball 无需 TypeScript 编译器。
目标运行时：Node ≥22.19，dsh `0.2.2-rc.1`；另验证了 `0.2.0-rc.2` 的工具注册与报价执行。
插件跟随宿主的原生/PTC 工具执行方式，不替换宿主执行器。卸载后工具和系统指引自动撤回，进行中的请求会取消。

```sh
dsh plugin --profile web remove dsh-market
```

## 数据源和“实时”的含义

| 市场 | 数据源 | 密钥 | 范围与时间 |
| --- | --- | --- | --- |
| 加密货币 | Binance 公开现货 API | 不需要 | 按交易对计价，BTC 默认 BTCUSDT；最近成交时间单独获取 |
| 美股 | Alpaca `iex`（默认） | 需要 Alpaca Key | IEX 单一交易所，不能代表全美综合行情或成交量 |
| 美股 | Alpaca `sip` | 需要相应权限的 Key | 美国交易所综合 SIP 行情 |
| 美股 | Alpaca `delayed_sip` | 需要相应权限的 Key | 综合行情延迟 15 分钟；K 线以 `sip` 加截止时间请求 |

每次调用发起 REST 请求，不复用本地缓存。`delaySeconds` 表示数据源声明的固定延迟，不包含网络延迟；0 不表示零延迟保证。
`sourceAt` 是最近成交的源时间，`fetchedAt` 是本机接收时间。成交超过默认 120 秒会标记 `stale`，即使刚完成网络请求也保留旧成交时间。
休市或低流动性标的可能返回旧成交；插件不根据“没更新”猜测开市状态。
加密货币涨跌采用滚动 24 小时基准，美股采用前一日 K 线收盘基准。
不同接口的数据不是原子快照；24 小时统计窗口、最近成交和买卖报价可能对应不同时间。

`market_watch` 是有界轮询：2–12 次、间隔 2–30 秒，间隔总计最多 60 秒，执行总时限 75 秒。
采样完成后一次返回结果，遇到数据源错误停止后续轮询。它不提供 WebSocket 推送、对话外后台订阅或永久盯盘。
数据源的地区限制、账户权限和限流会原样体现为明确错误，不自动切换成另一个市场或延迟数据源。

画图结果包含离线交互 HTML 与 `interactiveMarkdown` 链接，点击后在 dsh 右侧 HTML 预览打开。支持十字光标、悬停时间/开高低收/成交量、滚轮及按钮缩放、拖动平移、最近50根和重置全图；交互图保留本次最多1000根数据。dsh 需要开启“代码工作工具”以运行 HTML 脚本；关闭时显示静态回退图，也可用浏览器打开 HTML。图表库和数据内嵌，无需 CDN，浏览器不接收 API Key、不请求行情接口。它是本次查询快照，不自动刷新。

画图结果同时包含 PNG 预览和 `inlineMarkdown`，模型在最终回答中用 `![说明](<图片绝对路径>)` 将图片直接嵌入正文。不会要求模型具备视觉输入能力。SVG/CSV 保留为下载附件。标准桌面版和 Web 版本机附件存储支持这条路径；自定义无文件路径的存储后端会明确提示只能打开 PNG 附件。旧回答中的 SVG 文件卡片不会自动转换，需要重新请求画图。

## 配置美股 Key

加密货币可直接使用。美股在**运行 dsh 的后端进程**环境中设置：

```sh
export APCA_API_KEY_ID='你的 Alpaca Key ID'
export APCA_API_SECRET_KEY='你的 Alpaca Secret Key'
export DSH_MARKET_STOCK_FEED='iex'
```

桌面版也可以读取运行用户的 `~/.config/dsh-market/connection.json`：

```sh
mkdir -p ~/.config/dsh-market
chmod 700 ~/.config/dsh-market
```

文件内容（示例占位符需要替换）：

```json
{
  "keyId": "YOUR_ALPACA_KEY_ID",
  "secretKey": "YOUR_ALPACA_SECRET_KEY",
  "feed": "iex"
}
```

```sh
chmod 600 ~/.config/dsh-market/connection.json
```

配置每次调用读取，Key 轮换不需重打包。环境变量逐字段优先于文件，`feed` 支持 `iex`、`sip`、`delayed_sip`。
Key 只放在发往 Alpaca 固定 HTTPS 域名的请求头，不作为工具参数或返回值交给模型。
连接文件过大、权限过宽、只配一半 Key 或格式错误都会报错；加密货币查询独立于美股配置。
不要把 Key 发进对话。

## 工具

| 工具 | 参数 | 输出 |
| --- | --- | --- |
| `market_status` | 无 | 本地配置状态，不联网验证权限或连接 |
| `market_quote` | `instruments: [{market, symbol}]`，最多10个 | 最近成交、买卖价、涨跌、成交量、来源时间、`stale`、逐项错误 |
| `market_candles` | `market, symbol, interval?, limit?, start?, end?, pageToken?` | 升序 OHLCV、`closed`、数据源、时间范围、分页提示 |
| `market_orderbook` | `market: "crypto", symbol, limit?`（1–100档） | 买卖盘口、价差、更新序号；源时间缺失时明确标注 |
| `market_watch` | `instruments`（最多5个）、`samples?`、`intervalSeconds?` | 多次报价采样，`complete` 和停止原因 |
| `market_chart` | 同 `market_candles` | 交互 HTML、`interactiveMarkdown` 链接、PNG 预览和 SVG/CSV 附件；需要宿主提供 `attachments` 服务 |

`market` 必须为 `crypto` 或 `us`。BTC、ETH 等未指定计价币的加密货币代码默认附加 USDT；可用 `ETHBTC`、`BTC/USDC` 明确交易对。
USDT 与 USD 分别标注。美股使用 AAPL、NVDA、BRK.B 等 ticker，不做模糊名称猜测。
批量查询可以部分成功：检查 `complete` 与 `errors`。空行情不会伪装成价格 0。

### K 线和分页

默认 `interval=1h, limit=100`，每页最多1000根，原始未复权数据。

- 通用周期：`1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M`。`1M` 是月，`1m` 是分钟。
- 加密货币另支持：`3m, 2h, 6h, 8h, 12h, 3d`。
- 时间参数必须含时区，例如 `2026-11-01T00:00:00Z`；返回时间统一 ISO UTC。
- Binance `end` 不含端点；美股 `end` 遵循 Alpaca 端点语义。股票日、周、月边界按纽约时区计算，包含夏令时变化。
- `closed=false` 表示当前周期未完成。`closed=true` 也不保证上游不会修订数据。
- 没有成交的周期可能没有柱，不补零、不伪造 K 线。默认回看窗口有限，数量不足不代表没有更早历史。
- Binance：省略 `start` 获取截止时间之前最近的一页；指定 `start` 后从起点取一页。`hasMore=true` 仅表示达到了本页条数上限，可能还有数据。往前查时把 `end` 设为本页第一根 `time`；往后查时把 `start` 设为最后一根 `endTime`。
- Alpaca：按最新优先取一页，再升序返回。翻页传 `nextPageToken`，并把本页返回的 `rangeStart/rangeEnd` 作为下一页 `start/end`，保持周期与代码相同。窗口固定可以避免默认“现在”漂移。插件不自动拉取全部历史。
- PNG 预览和 SVG 显示本次数据最后300根、包含成交量和未收盘虚线；CSV 包含本次返回的全部柱、来源及时间信息。SVG 可在浏览器打开，不依赖外部脚本或网络资源。

## Cordis 可选设置

插件默认不需要额外参数。可在宿主相应插件配置中覆盖：

```yaml
connectionFile: /absolute/path/to/connection.json
timeoutMs: 15000
maxResponseBytes: 2097152
staleAfterSeconds: 120
```

HTTP 有超时、响应大小上限和取消信号；不跟随重定向、不输出上游任意错误正文。
HTTP 401/403 提示密钥/订阅/地区权限，429 提示限流；不自动重试造成请求放大。

## 开发与验证

```sh
cd /srv/data/code/dshplugin/dsh-market
npm ci --ignore-scripts
npm run typecheck
npm test
npm run smoke
npm pack
```

`npm test` 使用确定性模拟数据和真实 Cordis / dsh ToolRuntime / 原生执行器验证注册、查询、附件、取消及卸载。
`npm run smoke` 访问真实 Binance；只有检测到美股 Key 时才额外访问 Alpaca。
真实美股连接未配置时会明确显示跳过，不把模拟接口测试称作真实行情验证。

接口依据：[Binance 公开市场数据域名](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only)、
[Binance 行情接口](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)、
[Alpaca Snapshot](https://docs.alpaca.markets/us/reference/stocksnapshotsingle)、
[Alpaca Historical Bars](https://docs.alpaca.markets/us/reference/stockbars)、
[Alpaca Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq)。

交互图使用 [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)，遵循 Apache-2.0 许可，生成文件保留署名、链接和许可全文。
