import { defineTool } from '@deepseek-ai/dsh-tools';
import '@deepseek-ai/dsh-system-prompt';
import { AttachmentId } from '@deepseek-ai/dsh-attachment';
import { MarketClient } from './client.js';
import { renderChart, renderChartPng, renderCsv } from './chart.js';
import { renderInteractiveChart } from './interactive.js';
import { record } from './validation.js';
export { Config } from './config.js';
export { MarketClient } from './client.js';
export const name = 'market';
export const inject = ['tools', 'systemPrompt'];
const market = { type: 'string', enum: ['crypto', 'us'], description: 'crypto = Binance 现货；us = 美股' };
const symbol = { type: 'string', description: 'crypto: BTC / BTCUSDT / BTC/USDT（省略计价币时为 USDT）；us: AAPL / NVDA' };
const instrumentSchema = { type: 'object', properties: { market, symbol }, required: ['market', 'symbol'], additionalProperties: false };
const batch = { type: 'array', items: instrumentSchema, minItems: 1, maxItems: 10 };
const candleProperties = {
    market, symbol,
    interval: { type: 'string', description: '默认 1h。通用：1m,5m,15m,30m,1h,4h,1d,1w,1M（月，区分大小写）。crypto 另支持 3m,2h,6h,8h,12h,3d。' },
    limit: { type: 'integer', minimum: 1, maximum: 1000, description: '默认 100，最多 1000。图表显示最近 300 根，CSV 保留本次全部。' },
    start: { type: 'string', description: '含时区 RFC3339 起始时间。美股默认有界回看窗口，按最新优先取一页；Binance 指定 start 后按起点取一页。' },
    end: { type: 'string', description: '含时区 RFC3339 截止时间；crypto 为不含端点，美股遵循 Alpaca 端点语义。' },
    pageToken: { type: 'string', description: '仅美股：上次返回的 nextPageToken，翻页时保留相同代码、周期、start/end。' },
};
const instructions = `行情工具（market_）：
查询价格和 K 线时调用工具获取新数据，禁止凭模型记忆编造“实时”报价。明确 crypto 或 us 市场。
crypto 为 Binance 现货，BTC 默认 BTCUSDT，USDT 不等于 USD；美股为 Alpaca，缺 Key 时解释配置，不编造数据。
回答标注 provider/feed、计价币种、sourceAt 和 fetchedAt；sourceAt 是成交时间，fetchedAt 仅是本机接收时间。
stale=true、price=null、错误或空 K 线时明确说明；休市/低成交量会导致旧成交，不据此推断市场开闭。
iex 仅单一交易所，不能称全美综合价格或全市场成交量；delayed_sip 固定延迟15分钟；sip 需要相应订阅权限。
crypto 涨跌以滚动24小时计，美股以 previous_daily_close 计，基准不同不可直接混用。
K线为未复权 OHLCV，时间 ISO UTC，股票日/周/月按纽约交易所日历；closed=false 的当前柱未完成，closed=true 也可能被数据源修订。
每次只取一页，数量不足可能因为休市/缺成交/回看窗口，不能补造K线。美股翻页保持返回的 rangeStart/rangeEnd；crypto hasMore 只是“达到本页上限可能还有数据”，根据首尾时间继续查。
market_watch 是最长75秒的有界轮询，采样结束后一次返回，不是后台订阅、WebSocket推送或永久盯盘；不要承诺在对话外自动通知。
需要K线图或下载表格时用 market_chart（若附件服务可用），不要只调用报价工具。
画图结果含 interactiveMarkdown（交互HTML链接）与 inlineMarkdown（PNG预览）。最终回答首先展示交互图链接，说明点开后可在右侧HTML预览查看十字光标、悬停OHLCV、缩放和平移，再原样内嵌PNG预览。PNG本身是静态图片。
HTML为本次查询的行情快照，不会自动接收后续行情。如果dsh的“代码工作工具”关闭，HTML预览只显示静态回退图；提示用户开启该选项或用浏览器打开HTML。SVG/CSV可作为下载链接补充。
inlineMarkdown=null 表示当前附件后端没有可内嵌的本机路径，此时明确说明只能打开PNG附件。不要自行拼接图片路径，不把长数组逐行复述。`;
export function apply(ctx, config = {}) {
    const client = new MarketClient(config);
    const lifetime = new AbortController();
    ctx.effect(() => () => lifetime.abort(new Error('dsh-market 插件已卸载')));
    const signalFor = (signal) => AbortSignal.any([signal, lifetime.signal]);
    ctx.systemPrompt.section({ name: 'tool:market', order: 660, text: ({ scope }) => ctx.tools.get('market_quote', scope) ? instructions : '' });
    const register = (toolName, title, description, properties, required, run, timeoutMs = client.config.timeoutMs + 5000) => {
        const definition = {
            name: toolName, description, parameters: { type: 'object', properties, required, additionalProperties: false },
            output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
            execute: (args, execution) => run(record(args), signalFor(execution.signal)),
            timeoutMs, isConcurrencySafe: () => true,
            presentCall: () => ({ card: 'generic', kind: 'read', title }),
        };
        ctx.tools.register(definition);
    };
    register('market_status', '行情数据源状态', '检查数据源与美股 Key 是否配置（不返回密钥，不发网络请求，不代表网络/权限验证通过）。', {}, [], () => client.status());
    register('market_quote', '查询最新行情', '获取 1–10 个加密货币/美股最近成交、买卖价、涨跌、成交量及源时间。多标的可部分成功，检查 errors/complete/stale。美股需要 Alpaca Key。', { instruments: batch }, ['instruments'], (args, signal) => client.quotes(args, signal));
    register('market_candles', '查询 OHLCV K 线', '获取真实 OHLCV K 线，按时间升序返回，含未收盘标记、来源与分页信息；不填补缺失周期。', candleProperties, ['market', 'symbol'], (args, signal) => client.candles(args, signal));
    register('market_orderbook', '查询加密货币盘口', '获取 Binance 现货多档买卖盘口及价差；美股买一卖一用 market_quote。', { market, symbol, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['market', 'symbol'], (args, signal) => client.orderbook(args, signal));
    register('market_watch', '连续采样行情', '对 1–5 个标的短时连续采样，间隔2–30秒、2–12次，间隔总计≤60秒、总执行≤75秒。结束后一次返回，不是后台订阅或推送；遇数据源错误即停止。', {
        instruments: { ...batch, maxItems: 5 }, samples: { type: 'integer', minimum: 2, maximum: 12 }, intervalSeconds: { type: 'integer', minimum: 2, maximum: 30 },
    }, ['instruments'], (args, signal) => client.watch(args, signal), 80_000);
    ctx.inject(['attachments'], child => {
        child.tools.register(defineTool({
            name: 'market_chart', description: '画可交互K线图：返回离线HTML（十字光标、悬停OHLCV、缩放和平移）的interactiveMarkdown链接、PNG正文预览及SVG/CSV。回答展示交互链接并内嵌PNG。HTML最多1000根，PNG/SVG最多300根，包含成交量、来源与未收盘状态；行情快照不自动刷新。',
            parameters: {
                market: { type: 'string', enum: ['crypto', 'us'], required: true }, symbol: { type: 'string', required: true },
                interval: { type: 'string' }, limit: { type: 'integer' }, start: { type: 'string' }, end: { type: 'string' }, pageToken: { type: 'string' },
            },
            output: {
                schema: { type: 'object', additionalProperties: false, properties: {
                        symbol: { type: 'string', required: true }, bars: { type: 'integer', required: true }, displayedBars: { type: 'integer', required: true },
                        provider: { type: 'string', required: true }, feed: { type: 'string', required: true }, delaySeconds: { type: 'integer', required: true }, fetchedAt: { type: 'string', required: true },
                        hasMore: { type: 'boolean', required: true }, nextPageToken: { type: 'string' },
                        rangeStart: { type: 'string' }, rangeEnd: { type: 'string' },
                        inlineMarkdown: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                        interactiveMarkdown: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                        files: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
                                    attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
                                } } },
                    } },
                render: (_args, value) => [
                    { type: 'text', text: `${value.symbol}：HTML含 ${value.bars} 根K线，静态图显示 ${value.displayedBars} 根；${value.provider}/${value.feed}，数据源延迟 ${value.delaySeconds}s，获取时间 ${value.fetchedAt}。${value.hasMore ? '本页之外可能还有数据。' : ''}\n${value.interactiveMarkdown ? `先展示交互图链接，点开后可悬停查看价格/OHLCV、缩放和平移：\n${value.interactiveMarkdown}` : '请打开HTML附件使用交互图。'}\nHTML为行情快照；dsh预览需开启“代码工作工具”，也可用浏览器打开。\n${value.inlineMarkdown ? `在回答中内嵌静态PNG预览（保留感叹号）：\n${value.inlineMarkdown}` : '当前附件后端没有可内嵌的本机路径，请打开PNG附件预览。'}` },
                    ...value.files.map(file => ({ type: 'file', attachment: { ...file, attachmentId: AttachmentId(file.attachmentId) } })),
                ],
            },
            async execute(args, execution) {
                const signal = signalFor(execution.signal), data = await client.candles(args, signal);
                const svg = renderChart(data), csv = renderCsv(data), png = await renderChartPng(svg, signal), html = await renderInteractiveChart(data), files = [];
                const outputs = [['png', png], ['svg', Buffer.from(svg)], ['csv', Buffer.from(csv)], ['html', Buffer.from(html)]];
                for (const [extension, content] of outputs) {
                    signal.throwIfAborted();
                    async function* bytes() { signal.throwIfAborted(); yield content; }
                    files.push(await child.attachments.saveFileStream({ data: bytes(), signal, name: `${data.symbol}-${data.interval}.${extension}` }));
                }
                const path = child.attachments.fileHostPath(files[0]);
                const inlineMarkdown = path ? `![${data.symbol} ${data.interval} K线图](<${path.replace(/[<>\r\n]/g, c => encodeURIComponent(c))}>)` : null;
                const htmlPath = child.attachments.fileHostPath(files[3]);
                const interactiveMarkdown = htmlPath ? `[打开 ${data.symbol} ${data.interval} 交互K线图](<${htmlPath.replace(/[<>\r\n]/g, c => encodeURIComponent(c))}>)` : null;
                return { symbol: data.symbol, bars: data.candles.length, displayedBars: Math.min(300, data.candles.length), provider: data.provider, feed: data.feed, delaySeconds: data.delaySeconds, fetchedAt: data.fetchedAt, hasMore: data.hasMore, inlineMarkdown, interactiveMarkdown, ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}), ...(data.rangeStart ? { rangeStart: data.rangeStart } : {}), ...(data.rangeEnd ? { rangeEnd: data.rangeEnd } : {}), files };
            },
            timeoutMs: client.config.timeoutMs + 10_000,
            isConcurrencySafe: () => true,
            presentCall: () => ({ card: 'generic', kind: 'read', title: '生成 K 线图与 CSV' }),
        }));
    });
}
