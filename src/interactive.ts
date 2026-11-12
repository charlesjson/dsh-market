import { readFile } from 'node:fs/promises'
import type { Candles } from './types.js'
import { renderChart } from './chart.js'

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
let assets: Promise<{ library: string; client: string; license: string }> | undefined

/** A self-contained snapshot; neither credentials nor network requests reach the browser. */
export async function renderInteractiveChart(data: Candles): Promise<string> {
  if (!data.candles.length) throw new Error('所选区间没有 K 线，无法绘图')
  assets ??= Promise.all([
    readFile(new URL('./lightweight-charts.standalone.production.js', import.meta.resolve('lightweight-charts')), 'utf8'),
    readFile(new URL('./interactive-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../LICENSE', import.meta.resolve('lightweight-charts')), 'utf8'),
  ]).then(([library, client, license]) => ({ library, client, license }))
  const { library, client, license } = await assets
  const payload = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const script = (source: string) => source.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.symbol)} · 交互 K 线</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0b1220;color:#dce5f2;font-family:system-ui,sans-serif}main{height:100dvh;min-height:470px;display:flex;flex-direction:column}header{padding:18px 20px 10px;border-bottom:1px solid #233146}h1{font-size:23px;margin:0 0 7px;letter-spacing:.3px}.meta,.hint,footer{font-size:12px;color:#99abc3}.meta{line-height:1.6}.toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}button{background:#152237;color:#dce5f2;border:1px solid #33445e;border-radius:6px;padding:7px 12px;cursor:pointer;font:inherit;font-size:12px}button:hover,button:focus-visible{background:#243c5a;outline:1px solid #4b8be8}.hint{padding:8px 20px;margin:0}.ohlcv{display:flex;flex-wrap:wrap;gap:7px 17px;min-height:60px;padding:10px 20px;background:#101b2c;font-size:13px;font-variant-numeric:tabular-nums}.ohlcv span{white-space:nowrap}.ohlcv b{color:#ecf3ff;font-weight:600}.ohlcv time{flex-basis:100%;font-size:12px;color:#a1b4ce}#chart{flex:1;min-height:240px;position:relative}#chart[hidden]{display:none}#fallback{padding:12px 20px;overflow:auto;flex:1}#fallback svg{width:100%;height:auto;display:block}.notice{font-size:13px;color:#f2c877;line-height:1.6}footer{padding:9px 20px;border-top:1px solid #233146;display:flex;gap:10px;flex-wrap:wrap;align-items:center}footer a{color:#88b8ff}details{font-size:11px}details pre{white-space:pre-wrap;max-height:180px;overflow:auto}@media(max-width:520px){header{padding:12px}h1{font-size:19px}.ohlcv{padding:9px 12px;gap:6px 12px;font-size:12px}.hint,footer{padding:8px 12px}}
</style></head><body><main>
<header><h1>${escape(data.symbol)} <small>· ${escape(data.interval)} · ${escape(data.currency)}</small></h1><div class="meta">${escape(data.provider)} / ${escape(data.feed)} · ${escape(data.coverage)} · 数据源延迟 ${data.delaySeconds}s<br>获取于 ${escape(data.fetchedAt)} · ${data.candles.length} 根 · 未复权 · 时间 UTC</div>
<nav class="toolbar" aria-label="图表操作"><button id="zoom-in" type="button">放大 ＋</button><button id="zoom-out" type="button">缩小 −</button><button id="recent" type="button">最近 50 根</button><button id="fit" type="button">查看全部 / 重置</button></nav></header>
<p class="hint">移动指针查看价格与 OHLCV · 滚轮缩放 · 拖动平移 · 触屏可拖动和双指缩放</p>
<div id="ohlcv" class="ohlcv" role="status" aria-live="polite"><time id="bar-time">将指针移到 K 线上</time><span>开 <b id="open">—</b></span><span>高 <b id="high">—</b></span><span>低 <b id="low">—</b></span><span>收 <b id="close">—</b></span><span>量 <b id="volume">—</b></span><span id="bar-state"></span></div>
<div id="chart" hidden aria-label="可交互蜡烛图和成交量"></div><div id="fallback"><p id="notice" class="notice">交互图加载中。如果一直显示静态图，请在 dsh 开启“代码工作工具”，或使用浏览器打开此 HTML 文件。</p>${renderChart(data)}</div>
<footer><span>行情快照；更新数据请重新查询。未收盘 K 线仍可能变化。</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener">Charts by TradingView</a><details><summary>开源许可</summary><pre>${escape(license)}</pre></details></footer>
</main><script id="chart-data" type="application/json">${payload}</script><script>${script(library)}</script><script>${script(client)}</script></body></html>`
}
