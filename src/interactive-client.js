/* Browser entry embedded into the generated HTML, with no network dependencies. */
(() => {
  'use strict'
  const byId = id => document.getElementById(id)
  try {
    const data = JSON.parse(byId('chart-data').textContent)
    const library = window.LightweightCharts
    const rows = data.candles.map(c => ({ ...c, time: Math.floor(Date.parse(c.time) / 1000) }))
    const byTime = new Map(rows.map(c => [c.time, c]))
    const container = byId('chart')
    container.hidden = false
    const chart = library.createChart(container, {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#0b1220' }, textColor: '#a8b8cf', attributionLogo: true },
      grid: { vertLines: { color: '#182438' }, horzLines: { color: '#1d2a3e' } },
      crosshair: { mode: library.CrosshairMode.Normal, vertLine: { color: '#7f9ec5', labelBackgroundColor: '#29496f' }, horzLine: { color: '#7f9ec5', labelBackgroundColor: '#29496f' } },
      rightPriceScale: { borderColor: '#2a3a52', scaleMargins: { top: .08, bottom: .27 } },
      timeScale: { borderColor: '#2a3a52', timeVisible: true, secondsVisible: false, rightOffset: 3 },
      localization: { locale: 'zh-CN' },
      handleScroll: true, handleScale: true,
    })
    const minimum = Math.min(...rows.map(c => c.low).filter(v => v > 0))
    const precision = minimum < .001 ? 8 : minimum < 1 ? 6 : minimum < 100 ? 4 : 2
    const candles = chart.addSeries(library.CandlestickSeries, {
      upColor: '#32cfa0', downColor: '#f47288', borderVisible: false,
      wickUpColor: '#32cfa0', wickDownColor: '#f47288',
      priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
    })
    const volume = chart.addSeries(library.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: .80, bottom: 0 } })
    candles.setData(rows.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))
    volume.setData(rows.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? '#32cfa077' : '#f4728877' })))
    const format = value => value.toLocaleString('en-US', { maximumFractionDigits: 8 })
    function show(c) {
      byId('bar-time').textContent = new Date(c.time * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
      for (const key of ['open', 'high', 'low', 'close', 'volume']) byId(key).textContent = format(c[key])
      byId('close').style.color = c.close >= c.open ? '#32cfa0' : '#f47288'
      byId('bar-state').textContent = c.closed ? '已收盘' : '当前柱 · 未收盘'
    }
    chart.subscribeCrosshairMove(event => {
      const candle = byTime.get(event.time)
      show(candle || rows[rows.length - 1])
    })
    function zoom(factor) {
      const range = chart.timeScale().getVisibleLogicalRange()
      if (!range) return
      const middle = (range.from + range.to) / 2
      const half = Math.max(3, Math.min(rows.length + 10, (range.to - range.from) * factor / 2))
      chart.timeScale().setVisibleLogicalRange({ from: middle - half, to: middle + half })
    }
    byId('zoom-in').addEventListener('click', () => zoom(.7))
    byId('zoom-out').addEventListener('click', () => zoom(1.4))
    byId('recent').addEventListener('click', () => chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, rows.length - 50), to: rows.length + 2 }))
    byId('fit').addEventListener('click', () => chart.timeScale().fitContent())
    chart.timeScale().fitContent()
    show(rows[rows.length - 1])
    byId('fallback').hidden = true
    container.dataset.ready = 'true'
    window.addEventListener('pagehide', () => chart.remove(), { once: true })
  } catch (error) {
    byId('chart').hidden = true
    byId('notice').textContent = '交互图加载失败，以下为静态预览。' + (error instanceof Error ? error.message : '')
  }
})()
