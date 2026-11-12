const escape = (value) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const number = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 8 });
/** Standalone SVG with embedded provenance; no scripts or third-party resources. */
export function renderChart(data) {
    const bars = data.candles.slice(-300);
    if (!bars.length)
        throw new Error('所选区间没有 K 线，无法绘图');
    const width = 1200, left = 100, right = 30, top = 105, bottom = 470, volumeTop = 510, volumeBottom = 625;
    const plotWidth = width - left - right;
    const min = Math.min(...bars.map(b => b.low)), max = Math.max(...bars.map(b => b.high)), padding = (max - min || Math.abs(max) * .01 || 1) * .08;
    const lower = min - padding, upper = max + padding, maxVolume = Math.max(1, ...bars.map(b => b.volume));
    const y = (price) => bottom - (price - lower) / (upper - lower) * (bottom - top);
    const step = plotWidth / bars.length, bodyWidth = Math.max(.8, Math.min(14, step * .7));
    const result = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="730" viewBox="0 0 1200 730" role="img" aria-label="${escape(data.symbol)} candlestick chart">`,
        '<rect width="1200" height="730" fill="#0b1220"/>',
        '<g fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="13">',
        `<text x="30" y="35" font-size="24" font-weight="700">${escape(data.symbol)} · ${escape(data.interval)} · ${escape(data.currency)}</text>`,
        `<text x="30" y="62">${escape(data.provider)} / ${escape(data.feed)} · ${escape(data.coverage)} · delay ${data.delaySeconds}s · raw / unadjusted</text>`,
        `<text x="30" y="83">Fetched ${escape(data.fetchedAt)} · ${bars.length} bars${data.candles.length > 300 ? ' (latest 300 displayed)' : ''} · green up / red down · dashed = incomplete</text>`,
    ];
    for (let n = 0; n <= 5; n++) {
        const price = lower + (upper - lower) * n / 5, yy = y(price);
        result.push(`<path d="M${left} ${yy}H${width - right}" stroke="#243145"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end">${number(price)}</text>`);
    }
    bars.forEach((bar, n) => {
        const x = left + (n + .5) * step, color = bar.close >= bar.open ? '#34d399' : '#fb7185';
        const bodyTop = Math.min(y(bar.open), y(bar.close)), bodyHeight = Math.max(1, Math.abs(y(bar.open) - y(bar.close)));
        const vol = bar.volume / maxVolume * (volumeBottom - volumeTop);
        result.push(`<g><title>${escape(bar.time)} O ${bar.open} H ${bar.high} L ${bar.low} C ${bar.close} V ${bar.volume}${bar.closed ? '' : ' INCOMPLETE'}</title><path d="M${x} ${y(bar.high)}V${y(bar.low)}" stroke="${color}"/><rect x="${x - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight}" fill="${color}"${bar.closed ? '' : ' fill-opacity="0.25" stroke="' + color + '" stroke-dasharray="3 2"'}/><rect x="${x - bodyWidth / 2}" y="${volumeBottom - vol}" width="${bodyWidth}" height="${vol}" fill="${color}" opacity="0.65"/></g>`);
    });
    result.push(`<text x="30" y="${volumeTop + 10}">Volume</text>`);
    for (let n = 0; n <= Math.min(4, bars.length - 1); n++) {
        const count = Math.min(4, bars.length - 1), index = count ? Math.round(n / count * (bars.length - 1)) : 0;
        const label = bars[index].time.replace('T', ' ').slice(0, 16);
        const x = left + (index + .5) * step;
        result.push(`<text x="${x}" y="650" text-anchor="${n === 0 ? 'start' : n === count ? 'end' : 'middle'}">${escape(label)}</text>`);
    }
    result.push('<text x="30" y="689">Time labels: UTC. Exchange bar calendar: ' + escape(data.timezone) + '. Missing periods are not synthesized.</text>', '</g></svg>');
    return result.join('\n');
}
export function renderCsv(data) {
    // All cell values are validated numbers, ISO timestamps, booleans or fixed symbols.
    const header = 'market,symbol,currency,interval,provider,feed,delay_seconds,fetched_at,adjustment,time,end_time,open,high,low,close,volume,closed';
    return [header, ...data.candles.map(c => [data.market, data.symbol, data.currency, data.interval, data.provider, data.feed, data.delaySeconds, data.fetchedAt, data.adjustment, c.time, c.endTime, c.open, c.high, c.low, c.close, c.volume, c.closed].join(','))].join('\r\n') + '\r\n';
}
