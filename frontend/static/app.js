/* FinMLOps sentiment dashboard: vanilla JS + Chart.js, talks to frontend/server.py */

const TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMZN', 'TSLA'];
const LABELS = ['positive', 'neutral', 'negative'];
const EXAMPLES = [
  'Nvidia beats revenue estimates as data center sales surge',
  'Tesla recalls 200,000 vehicles over steering defect',
  'Microsoft revenue grows 12% but cloud growth misses estimates',
  'Apple to hold annual shareholder meeting in February',
];

const TABS = ['dashboard', 'headlines', 'analyzer', 'models'];
const MOD_K = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const C = {};
const state = {
  ov: null,
  ticker: store('ticker') || 'NVDA',
  days: 30,
  price: store('price') !== '0',
  news: { ticker: '', label: '' },
  newsRows: [],
  models: [],
  charts: {},
  newsLoaded: false,
};

// ---------- helpers ----------
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem('finmlops.' + key);
    localStorage.setItem('finmlops.' + key, value);
  } catch {
    return null;
  }
}
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const tone = x => (x > 0 ? 'up' : x < 0 ? 'down' : 'flat');
const arrow = x => (x > 0 ? '▲' : x < 0 ? '▼' : '•');
const signed = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
const pct = (a, n) => (n ? (100 * a) / n : 0);
const f3 = v => (v == null ? '—' : v.toFixed(3));
const day = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const messageRow = msg => `<tbody><tr><td class="empty-row">${esc(msg)}</td></tr></tbody>`;

// company logo on a light tile (frontend/static/logos/<ticker>.svg); falls back to the first letter if it's missing
const logo = (ticker, cls = '') => `<span class="logo ${cls}"><img src="logos/${ticker.toLowerCase()}.svg" alt="${ticker}" loading="lazy"
  onerror="this.replaceWith(document.createTextNode('${ticker[0]}'))"></span>`;

// dashed vertical line under the cursor
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements() || [];
    if (!active.length) return;
    const x = active[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(230, 233, 239, .22)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// ---------- loading skeletons ----------
const sk = (w, cls = '', h = '') => `<span class="sk ${cls}" style="width:${w};${h ? `height:${h}` : ''}"></span>`;

function skRows(n = 6) {
  const widths = ['72%', '58%', '84%', '64%', '78%', '50%'];
  return `<tbody>${Array.from({ length: n }, (_, i) => `
    <tr>
      <td class="t-time">${sk('56px')}</td>
      <td class="t-tkr">${sk('62px', 'lg')}</td>
      <td class="t-title">${sk(widths[i % widths.length])}<span class="pub">${sk('90px')}</span></td>
      <td class="t-sent">${sk('76px', 'lg')}</td>
      <td class="t-conf">${sk('92px')}</td>
    </tr>`).join('')}</tbody>`;
}

function skChart(id, bars = 0) {
  const box = $('#' + id).parentElement;
  box.querySelector('.sk-chart')?.remove();
  const inner = bars
    ? Array.from({ length: bars }, (_, i) => sk('', '', `${30 + ((i * 37) % 60)}%`)).join('')
    : sk('', 'block');
  box.insertAdjacentHTML('beforeend', `<div class="sk-chart">${inner}</div>`);
}

function skAnalysis() {
  return `<div class="panel-head">Result</div>
    <div class="an-res">
      <div class="verdict">${sk('110px', 'xl')}${sk('56px', 'xl')}</div>
      <div class="probs">${LABELS.map(() => `<div class="prob">${sk('56px')}${sk('100%', '', '6px')}${sk('44px')}</div>`).join('')}</div>
      <div class="sub-head">${sk('100px')}</div>
      <p class="words">${sk('86%', 'lg')} ${sk('60%', 'lg')}</p>
    </div>`;
}

function showSkeletons() {
  $('#watchlist').innerHTML = TICKERS.map(() => `
    <li class="wl-row wl-item">
      <div class="wl-id">${sk('28px', '', '28px')}<div>${sk('42px')}${sk('64px')}</div></div>
      ${sk('56px', 'lg')}<span class="r">${sk('38px')}</span><span class="r">${sk('34px')}</span>
    </li>`).join('');
  $('#q-logo').innerHTML = sk('46px', '', '46px');
  $('#q-sym').innerHTML = sk('76px', 'lg');
  $('#q-name').innerHTML = sk('60px');
  $('#q-net').innerHTML = sk('100px', 'xl');
  $('#q-chg').innerHTML = sk('130px');
  $('#q-stats').innerHTML = Array.from({ length: 5 }, () => `<div class="stat">${sk('64px')}${sk('48px', 'lg')}</div>`).join('');
  $('#chart-stats').innerHTML = Array.from({ length: 4 }, () => `<div class="cs">${sk('70px')}${sk('52px', 'lg')}</div>`).join('');
  $('#tbl-dash').innerHTML = skRows(6);
  $('#tbl-models').innerHTML = skRows(3);
  skChart('chart-daily');
  skChart('chart-volume', 30);
  skChart('chart-models', 14);
}

// small "High" / "Low" labels next to the marked days (options.plugins.markers.points = [{i, text, color, above}])
const markers = {
  id: 'markers',
  afterDatasetsDraw(chart, args, opts) {
    const meta = chart.getDatasetMeta(0);
    if (!opts?.points || meta.hidden) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = `600 10.5px ${css('--sans')}`;
    ctx.textAlign = 'center';
    opts.points.forEach(({ i, text, color, above }) => {
      const p = meta.data[i];
      if (!p) return;
      ctx.fillStyle = color;
      ctx.fillText(text, p.x, above ? p.y - 11 : p.y + 19);
    });
    ctx.restore();
  },
};

const trunc = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function alpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function when(iso) {
  const d = new Date(iso);
  const mins = (Date.now() - d) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
  return `${date} ${time}`;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.detail) ? body.detail.map(d => d.msg).join('; ') : body.detail;  // FastAPI validation errors are lists
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return body;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

function setStatus(live, html) {
  const el = $('#status');
  el.classList.toggle('live', live);
  el.innerHTML = `<span class="dot"></span>${html}`;
}

// create a chart, or morph the existing one to the new data so it animates instead of redrawing
function chart(id, config) {
  const skeleton = $('#' + id).parentElement.querySelector('.sk-chart');
  if (skeleton) {
    skeleton.style.opacity = '0';
    setTimeout(() => skeleton.remove(), 250);
  }
  const c = state.charts[id];
  if (c && c.config.type === config.type && c.data.datasets.length === config.data.datasets.length) {
    c.data.labels = config.data.labels;
    config.data.datasets.forEach((d, i) => Object.assign(c.data.datasets[i], d));
    c.options = config.options;
    c.update();
    return;
  }
  c?.destroy();
  state.charts[id] = new Chart($('#' + id), config);
}

// ---------- motion ----------
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lastValue = {};

// count a number from its previous value to the new one
function countTo(el, key, to, fmt) {
  const from = lastValue[key] ?? to;
  lastValue[key] = to;
  const token = (el._tween = {});
  if (reducedMotion || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now(), duration = 550;
  const step = now => {
    if (el._tween !== token || !el.isConnected) return;
    const k = Math.min(1, (now - start) / duration), eased = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// fill every [data-k] element under root from values = {key: [number, format]}
function tweenAll(root, values) {
  $$('[data-k]', root).forEach(el => {
    const [v, fmt] = values[el.dataset.k];
    countTo(el, el.dataset.k, v, fmt);
  });
}

function reveal(el) {
  if (!el) return;
  el.classList.remove('fade-in');
  void el.offsetWidth; // restart the animation
  el.classList.add('fade-in');
}

// ---------- splash ----------
const SPLASH_MESSAGES = ['Loading market sentiment…', 'Reading the headlines…', 'Asking FinBERT how it feels…', 'Lining up the charts…'];
const splashStart = performance.now();
const splashTimer = setInterval(() => {
  const el = $('#splash-msg');
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = SPLASH_MESSAGES[(SPLASH_MESSAGES.indexOf(el.textContent) + 1) % SPLASH_MESSAGES.length];
    el.style.opacity = '1';
  }, 200);
}, 1400);

const SPLASH_MIN_MS = 3000;

// fade the splash out, but keep it up at least SPLASH_MIN_MS; resolves once it's gone
function hideSplash() {
  const wait = Math.max(0, SPLASH_MIN_MS - (performance.now() - splashStart));
  return new Promise(resolve => setTimeout(() => {
    clearInterval(splashTimer);
    const el = $('#splash');
    el.classList.add('hide');
    setTimeout(() => { el.remove(); resolve(); }, 500);
  }, wait));
}

function moveInk() {
  const active = $('.tabs button.active'), ink = $('#tab-ink');
  if (!active || !ink) return;
  ink.style.width = `${active.offsetWidth}px`;
  ink.style.transform = `translateX(${active.offsetLeft}px)`;
}

function seg(el, onPick) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', el).forEach(x => x.classList.toggle('active', x === b));
    onPick(b.dataset);
  });
}

function setupCharts() {
  Object.assign(C, {
    positive: css('--pos'), neutral: css('--neu'), negative: css('--neg'),
    accent: css('--accent'), price: css('--price'), grid: css('--border'), muted: css('--muted'), faint: css('--faint'), text: css('--text'),
  });
  Chart.defaults.color = C.muted;
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.font.family = css('--sans');
  Chart.defaults.font.size = 11;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = reducedMotion ? 0 : 550;
  Chart.defaults.animation.easing = 'easeOutQuart';
  Object.assign(Chart.defaults.plugins.legend.labels, { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14 });
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: css('--tooltip'), borderColor: css('--border-2'), borderWidth: 1,
    titleColor: C.text, bodyColor: C.muted, padding: 10, cornerRadius: 4, boxPadding: 4,
  });
}

// ---------- shared views ----------
const current = () => state.ov.tickers.find(t => t.ticker === state.ticker);
const change = t => t.week.net - t.prev.net;

// a market product must never pass old sentiment off as current
function renderStale() {
  const hours = (Date.now() - new Date(state.ov.as_of)) / 36e5;
  $('#stale').hidden = hours < 24;
  if (hours >= 24) $('#stale-text').textContent = `The newest article is ${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''} old, so this isn't current sentiment.`;
}

function renderAsOf() {
  const asOf = new Date(state.ov.as_of).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#as-of').textContent = `Data as of ${asOf} · scored by v${state.ov.scored_by}`;
}

function spark(daily) {
  const v = daily.slice(-14).map(d => d.net);
  if (v.length < 2) return '<span></span>';
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const y = val => (21 - ((val - min) / span) * 20).toFixed(1);
  const pts = v.map((val, i) => `${((i / (v.length - 1)) * 56).toFixed(1)},${y(val)}`).join(' ');
  const t = tone(v[v.length - 1] - v[0]);
  return `<svg class="spark" viewBox="0 0 56 22" preserveAspectRatio="none">
    <polygon class="${t}" points="0,22 ${pts} 56,22"/><polyline class="${t}" points="${pts}"/></svg>`;
}

function renderWatchlist() {
  $('#watchlist').innerHTML = state.ov.tickers.map(t => `
    <li class="wl-row wl-item" data-ticker="${t.ticker}">
      <div class="wl-id">${logo(t.ticker)}<div><b>${t.ticker}</b><span>${esc(t.name)}</span></div></div>
      ${spark(t.daily)}
      <span class="num ${tone(t.week.net)}">${signed(t.week.net)}</span>
      <span class="num ${tone(change(t))}">${signed(change(t))}</span>
    </li>`).join('');
}

function renderTable(el, rows) {
  if (!rows.length) {
    el.innerHTML = messageRow('No headlines match.');
    return;
  }
  el._rows = rows; // the detail panel steps through these
  el.innerHTML = `
    <thead><tr><th class="t-time">Time</th><th class="t-tkr">Ticker</th><th>Headline</th><th>Sentiment</th><th class="t-conf">Confidence</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr class="row-in" style="--i:${Math.min(i, 14)}" data-idx="${i}" tabindex="0">
        <td class="t-time num">${when(r.published)}</td>
        <td class="t-tkr"><span class="tkr" data-ticker="${r.ticker}">${logo(r.ticker)}${r.ticker}</span></td>
        <td class="t-title">
          <span class="hl">${esc(r.title)}</span>${r.url ? `<a class="ext" href="${esc(r.url)}" target="_blank" rel="noopener" aria-label="Open article">↗</a>` : ''}
          <span class="pub">${esc(r.publisher)}</span>
        </td>
        <td class="t-sent"><span class="pill ${r.pred}">${cap(r.pred)}</span></td>
        <td class="t-conf"><span class="conf"><i style="width:${(r.confidence * 100).toFixed(0)}%"></i></span><span class="num">${(r.confidence * 100).toFixed(0)}%</span></td>
      </tr>`).join('')}
    </tbody>`;
}

// ---------- dashboard ----------
async function selectTicker(ticker) {
  if (!state.ov) return;
  if (!state.ov.tickers.some(t => t.ticker === ticker)) ticker = state.ov.tickers[0].ticker;
  state.ticker = ticker;
  store('ticker', ticker);
  $$('.wl-item').forEach(el => el.classList.toggle('active', el.dataset.ticker === ticker));
  renderQuote();
  document.title = `${ticker} ${signed(current().week.net)} · FinMLOps Sentiment`;
  renderDaily();
  $('#tbl-dash').innerHTML = skRows(6);
  try {
    const rows = await api(`/api/headlines?ticker=${ticker}&limit=8`);
    if (state.ticker !== ticker) return;
    $('#dash-count').textContent = state.ticker;
    renderTable($('#tbl-dash'), rows);
  } catch (e) {
    $('#tbl-dash').innerHTML = messageRow(e.message);
  }
}

function renderQuote() {
  const t = current(), w = t.week, d = change(t);
  if ($('#q-sym').textContent !== t.ticker) reveal($('.quote-id'));
  $('#q-logo').innerHTML = logo(t.ticker, 'lg');
  $('#q-sym').textContent = t.ticker;
  $('#q-name').textContent = t.name;
  $('#q-net').className = `big num ${tone(w.net)}`;
  countTo($('#q-net'), 'q-net', w.net, v => signed(v));
  $('#q-chg').innerHTML = `<span class="chip ${tone(d)}">${arrow(d)} ${signed(d)} vs prior 7D</span>`;
  const int = v => Math.round(v).toLocaleString('en-US');
  const percent = v => `${v.toFixed(0)}%`;
  const stats = [
    ['Articles 7D', 'q-articles', `prior ${t.prev.articles}`],
    ['Positive', 'q-positive', `${w.positive} articles`],
    ['Neutral', 'q-neutral', `${w.neutral} articles`],
    ['Negative', 'q-negative', `${w.negative} articles`],
  ];
  $('#q-stats').innerHTML = stats.map(([label, key, h]) => `
    <div class="stat"><span class="label">${label}</span><span class="v num" data-k="${key}"></span><span class="h">${h}</span></div>`).join('')
    + `<div class="stat"><span class="label">Last article</span><span class="v num">${when(t.latest_at)}</span><span class="h"></span></div>`;
  tweenAll($('#q-stats'), {
    'q-articles': [w.articles, int],
    ...Object.fromEntries(LABELS.map(l => [`q-${l}`, [pct(w[l], w.articles), percent]])),
  });
}

function renderDaily() {
  let rows = current().daily;
  if (state.days) {
    const cut = new Date(new Date(state.ov.as_of) - state.days * 864e5).toISOString().slice(0, 10);
    rows = rows.filter(r => r.date > cut);
  }
  if (!rows.length) return;
  const labels = rows.map(r => day(r.date));
  const nets = rows.map(r => r.net);
  const hi = rows.reduce((a, b) => (b.net > a.net ? b : a)), lo = rows.reduce((a, b) => (b.net < a.net ? b : a));
  const avg = nets.reduce((a, b) => a + b, 0) / nets.length;
  const total = rows.reduce((a, r) => a + r.articles, 0);
  const closes = rows.map(r => r.close ?? null);
  const known = closes.filter(v => v != null);
  const showPrice = known.length > 1 && state.price;
  $('#price-toggle').hidden = known.length < 2;
  $('#price-toggle').classList.toggle('on', state.price);

  const stat = (label, key, h = '', cls = '') => `<div class="cs"><span class="label">${label}</span><span class="v num ${cls}" data-k="${key}"></span><span class="h">${h}</span></div>`;
  const priceChange = known.length > 1 ? (known[known.length - 1] / known[0] - 1) * 100 : 0;
  const fresh = !$('#chart-stats [data-k]');
  $('#chart-stats').innerHTML = [
    stat('Average net', 'c-avg', `${rows.length} days`, tone(avg)),
    stat('Articles', 'c-total', `${Math.round(total / rows.length)} / day`),
    known.length > 1 ? stat('Close', 'c-close', `<span class="${tone(priceChange)}">${signed(priceChange, 2)}%</span> in range`) : '',
    `<div class="chart-legend"><span><i class="line"></i>Net sentiment</span>${showPrice ? '<span><i class="line price"></i>Close price</span>' : ''}${LABELS.map(l => `<span><i class="bg-${l}"></i>${cap(l)}</span>`).join('')}</div>`,
  ].join('');
  if (fresh) reveal($('#chart-stats'));
  tweenAll($('#chart-stats'), {
    'c-avg': [avg, v => signed(v)],
    'c-total': [total, v => Math.round(v).toLocaleString('en-US')],
    'c-close': [known[known.length - 1] ?? 0, v => `$${v.toFixed(2)}`],
  });

  const PRICE_AXIS = 58;
  const yAxis = extra => ({ position: 'right', afterFit: s => { s.width = 46; }, ...extra });
  const tooltip = { position: 'nearest', caretPadding: 8 };

  // mark the most positive and most negative day; clicking any day opens its top headlines
  const hiIdx = rows.indexOf(hi), loIdx = rows.indexOf(lo);
  const marked = i => i === hiIdx || i === loIdx;
  const dayHeadlines = i => {
    const r = rows[i], list = [r.top_positive, r.top_negative].filter(Boolean);
    return { list, start: i === loIdx && r.top_negative ? list.indexOf(r.top_negative) : 0 };
  };

  const datasets = [{
    label: 'Net sentiment', data: nets, yAxisID: 'y', order: 1,
    borderColor: C.accent, borderWidth: 2, tension: 0.15,
    pointRadius: rows.map((_, i) => (marked(i) ? 5 : 0)),
    pointBackgroundColor: rows.map((_, i) => (i === hiIdx ? C.positive : i === loIdx ? C.negative : C.accent)),
    pointBorderColor: css('--panel'), pointBorderWidth: 2,
    pointHoverRadius: 5, pointHoverBackgroundColor: C.accent, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
    fill: { target: 'origin', above: alpha(C.positive, 0.1), below: alpha(C.negative, 0.12) },
  }];
  if (known.length > 1) {
    // always present (hidden when toggled off) so turning it on/off animates instead of redrawing
    datasets.push({
      label: 'Close', data: closes, yAxisID: 'price', order: 0, spanGaps: true, hidden: !showPrice,
      borderColor: C.price, borderWidth: 1.5, tension: 0.2, fill: false,
      pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: C.price, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
    });
  }

  chart('chart-daily', {
    type: 'line',
    data: { labels, datasets },
    plugins: [crosshair, markers],
    options: {
      layout: { padding: { top: 16 } },
      interaction: { mode: 'index', intersect: false },
      onClick: (e, els) => {
        if (!els.length) return;
        const { list, start } = dayHeadlines(els[0].index);
        if (!list.length) return toast(`No headlines for ${labels[els[0].index]}.`);
        openDrawer(list, start);
      },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: {
        legend: { display: false },
        markers: {
          points: [
            { i: hiIdx, text: 'High', color: C.positive, above: true },
            ...(loIdx !== hiIdx ? [{ i: loIdx, text: 'Low', color: C.negative, above: false }] : []),
          ],
        },
        tooltip: {
          ...tooltip,
          filter: ctx => ctx.parsed.y != null,
          callbacks: {
            label: ctx => (ctx.dataset.yAxisID === 'price' ? ` Close: $${ctx.parsed.y.toFixed(2)}` : ` Net sentiment: ${signed(ctx.parsed.y)}`),
            afterBody: items => {
              const r = rows[items[0].dataIndex], out = [];
              if (r.top_positive || r.top_negative) out.push('');
              if (r.top_positive) out.push(`▲ ${trunc(r.top_positive.title)}`);
              if (r.top_negative) out.push(`▼ ${trunc(r.top_negative.title)}`);
              return out;
            },
            footer: items => (dayHeadlines(items[0].dataIndex).list.length ? 'Click to read the top headlines' : ''),
          },
          footerColor: C.faint, footerFont: { weight: 500, size: 10.5 }, footerMarginTop: 8,
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { display: false }, border: { display: false } },
        y: yAxis({
          grace: '8%',
          border: { display: false },
          grid: { color: ctx => (ctx.tick.value === 0 ? css('--border-2') : C.grid) },
          ticks: { color: showPrice ? C.accent : C.muted, maxTicksLimit: 6, callback: v => (v > 0 ? '+' : '') + v },
        }),
        price: {
          display: showPrice, position: 'left', grace: '5%',
          afterFit: s => { s.width = PRICE_AXIS; },
          border: { display: false }, grid: { display: false },
          ticks: { color: C.price, maxTicksLimit: 6, callback: v => `$${Math.round(v)}` },
        },
      },
    },
  });

  chart('chart-volume', {
    type: 'bar',
    data: {
      labels,
      datasets: LABELS.map(l => ({
        label: cap(l), data: rows.map(r => r[l]), stack: 'articles',
        backgroundColor: alpha(C[l], 0.55), hoverBackgroundColor: C[l],
        barPercentage: 0.8, categoryPercentage: 0.9,
      })),
    },
    plugins: [crosshair],
    options: {
      layout: { padding: { left: showPrice ? PRICE_AXIS : 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { color: C.grid }, ticks: { maxRotation: 0, autoSkipPadding: 18 } },
        y: yAxis({ stacked: true, beginAtZero: true, border: { display: false }, grid: { color: C.grid }, ticks: { maxTicksLimit: 3, color: C.faint } }),
      },
    },
  });
}

async function showNoData(msg) {
  $('#watchlist').innerHTML = '<li class="wl-empty">No data yet.</li>';
  let health = null;
  try { health = await (await fetch('/api/health')).json(); } catch (e) { /* older server: show the steps without ticks */ }
  const steps = [
    [health?.champion, 'A champion model', health?.champion ? `v${health.champion} is registered` : 'Train and register the first one', 'uv run python -m scripts.train baseline'],
    [health?.predictions, 'Headlines labeled by it', 'Every article scored once and cached', 'uv run python -m frontend.server score'],
    [health?.prices, 'Stock prices (optional)', 'Daily closes for the price overlay', 'uv run python -m frontend.server prices'],
  ];
  $('#view-dashboard').innerHTML = `
    <div class="panel empty-state">
      <h2>Almost there: no predictions to show yet</h2>
      <p>${health ? 'Three steps get the dashboard running. Here is where you are:' : esc(msg)}</p>
      <ol class="setup">${steps.map(([done, title, hint, cmd]) => `
        <li><span class="${done ? 'mark-ok' : 'mark-no'}">${done ? '✓' : ''}</span>
          <div><b>${title}</b><span class="h">${hint}</span></div>
          ${done ? '' : `<code>${cmd}</code>`}</li>`).join('')}
      </ol>
      <p class="muted">Then refresh this page. No server restart needed.</p>
    </div>`;
}

// ---------- theme ----------
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  store('theme', next);
  $('#theme-btn').setAttribute('aria-label', `Switch to the ${next === 'light' ? 'dark' : 'light'} theme`);
  setupCharts(); // charts read their colors from the CSS variables, so redraw them in the new palette
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};
  if (state.ov) renderDaily();
  if (state.models.length) renderModelChart();
}

// ---------- news feed ----------
async function loadNews() {
  state.newsLoaded = true;
  const { ticker, label } = state.news;
  $('#tbl-news').innerHTML = skRows(10);
  try {
    state.newsRows = await api(`/api/headlines?ticker=${ticker}&label=${label}&limit=300`);
    filterNews();
  } catch (e) {
    $('#tbl-news').innerHTML = messageRow(e.message);
  }
}

function filterNews() {
  const q = $('#f-search').value.trim().toLowerCase();
  const rows = q ? state.newsRows.filter(r => `${r.title} ${r.publisher}`.toLowerCase().includes(q)) : state.newsRows;
  $('#news-count').textContent = `${rows.length} shown`;
  renderTable($('#tbl-news'), rows);
}

// ---------- analyzer ----------
async function analyze(text) {
  if (!text.trim()) return;
  const btn = $('#an-form .btn');
  btn.disabled = true;
  $('#an-result').innerHTML = skAnalysis();
  try {
    renderAnalysis(await predictText(text));
  } catch (e) {
    $('#an-result').innerHTML = `<div class="panel-head">Result</div><div class="empty error">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function renderAnalysis(r) {
  $('#an-result').innerHTML = `
    <div class="panel-head">Result</div>
    <div class="an-res">
      <div class="verdict"><span class="pill lg ${r.label}">${cap(r.label)}</span><span class="num">${(r.probs[r.label] * 100).toFixed(0)}%</span><span class="muted">confidence</span></div>
      ${analysisBody(r)}
    </div>`;
  reveal($('#an-result .an-res'));
}

// probabilities, highlighted words and top drivers for a /api/predict result (used by the Analyzer and the detail panel)
function analysisBody(r) {
  const max = Math.max(1e-6, ...r.words.map(w => Math.abs(w.impact)));
  const words = r.words.map(w => {
    const color = w.impact >= 0 ? C.positive : C.negative;
    const a = (Math.abs(w.impact) / max) * 0.55;
    return `<span class="w" style="background:${alpha(color, a)}" title="${signed(w.impact * 100)} pts">${esc(w.word)}</span>`;
  }).join(' ');
  const ranked = [...r.words].sort((a, b) => b.impact - a.impact);
  const list = items => (items.length
    ? items.map(w => `<div class="driver"><span>${esc(w.word)}</span><span class="num ${tone(w.impact)}">${signed(w.impact * 100)}</span></div>`).join('')
    : '<div class="driver muted">none</div>');
  const probs = LABELS.map(l => `
    <div class="prob"><span>${cap(l)}</span><div class="bar"><i class="bg-${l}" style="width:${(r.probs[l] * 100).toFixed(1)}%"></i></div>
    <span class="num">${(r.probs[l] * 100).toFixed(1)}%</span></div>`).join('');

  return `
    <div class="probs">${probs}</div>
    <div class="sub-head">Word influence
      <span class="legend"><i style="background:${alpha(C.negative, 0.55)}"></i>toward negative<i style="background:${alpha(C.positive, 0.55)}"></i>toward positive</span>
    </div>
    <p class="words">${words}</p>
    <div class="drivers">
      <div><div class="sub-head">Pushes positive</div>${list(ranked.filter(w => w.impact > 0).slice(0, 4))}</div>
      <div><div class="sub-head">Pushes negative</div>${list(ranked.filter(w => w.impact < 0).reverse().slice(0, 4))}</div>
    </div>
    <p class="note">Influence = how many points the positive-minus-negative score drops when that word is removed.</p>`;
}

// ---------- headline detail panel ----------
const predictText = text => api('/api/predict', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
});

function openDrawer(rows, idx) {
  if (!rows?.length) return;
  const wasOpen = Boolean(state.drawer);
  state.drawer = { rows, idx, returnFocus: wasOpen ? state.drawer.returnFocus : document.activeElement };
  renderDrawer();
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#dr-close').focus({ preventScroll: true }), 60);
}

function closeDrawer() {
  if (!state.drawer) return;
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-backdrop').classList.remove('open');
  document.body.style.overflow = '';
  state.drawer.returnFocus?.focus?.({ preventScroll: true });
  state.drawer = null;
  state.drawerToken = null;
}

function stepDrawer(delta) {
  const d = state.drawer;
  if (!d || d.idx + delta < 0 || d.idx + delta >= d.rows.length) return;
  d.idx += delta;
  renderDrawer();
}

async function renderDrawer() {
  const { rows, idx } = state.drawer, r = rows[idx];
  $('#dr-meta').innerHTML = `${logo(r.ticker)}<b>${r.ticker}</b><span class="muted">${esc(r.publisher)}</span><span class="muted num">· ${when(r.published)}</span>`;
  $('#dr-pos').textContent = rows.length > 1 ? `${idx + 1} / ${rows.length}` : '';
  $('#dr-prev').hidden = $('#dr-next').hidden = rows.length < 2;
  $('#dr-prev').disabled = idx === 0;
  $('#dr-next').disabled = idx === rows.length - 1;
  $('#dr-body').innerHTML = `
    <h2 class="dr-title" id="dr-title">${esc(r.title)}</h2>
    ${r.summary ? `<p class="dr-summary">${esc(r.summary)}</p>` : ''}
    <div class="dr-verdict">
      <span class="pill lg ${r.pred}">${cap(r.pred)}</span>
      <span class="num">${(r.confidence * 100).toFixed(0)}%</span><span class="muted">confidence · champion model</span>
    </div>
    <div class="sub-head">Why the model thinks so</div>
    <div id="dr-analysis">
      <div class="probs">${LABELS.map(() => `<div class="prob">${sk('56px')}${sk('100%', '', '6px')}${sk('44px')}</div>`).join('')}</div>
      <p class="words" style="margin-top:16px">${sk('90%', 'lg')} ${sk('70%', 'lg')} ${sk('50%', 'lg')}</p>
    </div>
    <div class="dr-actions">
      ${r.url ? `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Read the article ↗</a>` : ''}
      <button class="btn ghost" id="dr-analyze">Open in Analyzer</button>
    </div>`;
  $('#dr-body').scrollTop = 0;
  reveal($('#dr-body'));

  const token = (state.drawerToken = {});
  try {
    const result = await predictText(r.text || r.title);
    if (state.drawerToken === token) $('#dr-analysis').innerHTML = analysisBody(result);
  } catch (e) {
    if (state.drawerToken === token) $('#dr-analysis').innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
  }
}

// ---------- guided tour ----------
const TOUR = [
  { sel: '.watchlist', title: 'Your watchlist', text: 'The Magnificent 7 with each one\'s <b>net sentiment</b> over the last 7 days: the % of positive headlines minus the % of negative ones, as labeled by our model. Click a ticker to open it.' },
  { sel: '.quote', title: 'The ticker at a glance', text: 'This week\'s net sentiment, how much it moved compared with the week before, and the split between positive, neutral and negative news.' },
  { sel: '.chart-panel', title: 'Sentiment vs. price', text: '<b>Blue</b> is daily net sentiment, <b>amber</b> is the closing price. <b>High</b> and <b>Low</b> mark the extremes. Hover any day to see its top headlines, and click to read them.' },
  { sel: '.headlines-panel', title: 'Why the model decided', text: 'Every headline with the model\'s label and confidence. Click one to see <b>which words</b> pushed it toward positive or negative.' },
  { sel: '.tabs', title: 'More tools', text: '<b>Analyzer</b> scores any headline you paste. <b>Models</b> shows the champion, the candidates, and the rule a new model must pass to be promoted.' },
  { sel: '#status', title: 'The live model', text: `The current champion and its macro F1. Press <kbd>${MOD_K}</kbd> anytime to jump to a ticker, find a headline or analyze one, and <b>?</b> to replay this tour.` },
];

// ---------- command palette ----------
const ICON = {
  go: '<svg viewBox="0 0 16 16"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  action: '<svg viewBox="0 0 16 16"><path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  analyze: '<svg viewBox="0 0 16 16"><path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};
const GROUPS = ['Tickers', 'Headlines', 'Go to', 'Actions'];
const pal = { items: [], active: 0, headlines: [], loading: false, timer: null, hideTimer: null, returnFocus: null };

// fuzzy match: a direct substring scores high (more if at the start), otherwise the letters in order
function fuzzy(query, text) {
  const q = query.toLowerCase(), t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return { score: 100 - at + (at === 0 ? 50 : 0), idx: Array.from(q, (_, k) => at + k) };
  const idx = [];
  for (let i = 0, j = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) { idx.push(i); j++; }
  return idx.length === q.length ? { score: 40 - (idx[idx.length - 1] - idx[0]), idx } : null;
}

const mark = (text, idx) => {
  const hit = new Set(idx);
  return Array.from(text, (ch, i) => (hit.has(i) ? `<mark>${esc(ch)}</mark>` : esc(ch))).join('');
};

function paletteCommands() {
  const tickers = state.ov?.tickers || TICKERS.map(t => ({ ticker: t, name: '' }));
  const cmds = tickers.map(t => ({
    group: 'Tickers', title: t.ticker, sub: t.name, keys: `${t.ticker} ${t.name}`, icon: logo(t.ticker),
    right: t.week ? `<span class="num ${tone(t.week.net)}">${signed(t.week.net)}</span>` : '',
    run: () => {
      if (!state.ov) return toast('No predictions loaded yet.');
      showTab('dashboard');
      selectTicker(t.ticker);
    },
  }));
  [['dashboard', 'Dashboard'], ['headlines', 'News feed'], ['analyzer', 'Analyzer'], ['models', 'Models']].forEach(([id, name]) => cmds.push({
    group: 'Go to', title: name, keys: `${name} ${id}`, icon: ICON.go, run: () => showTab(id),
  }));
  const actions = [
    ...[[7, '1 week'], [14, '2 weeks'], [30, '1 month'], [0, 'all time']].map(([days, label]) => ({
      title: `Chart range: ${label}`, keys: `chart range ${label}`,
      run: () => { showTab('dashboard'); $(`#range button[data-days="${days}"]`).click(); },
    })),
    ...($('#price-toggle').hidden ? [] : [{
      title: state.price ? 'Hide the price overlay' : 'Show the price overlay', keys: 'price overlay stock close toggle',
      run: () => { showTab('dashboard'); $('#price-toggle').click(); },
    }]),
    { title: 'Take the guided tour', keys: 'guided tour help', run: startTour },
    { title: 'Switch light / dark theme', keys: 'theme light dark mode', run: toggleTheme },
  ];
  actions.forEach(a => cmds.push({ group: 'Actions', icon: ICON.action, ...a }));
  return cmds;
}

function renderPalette() {
  const q = $('#pal-input').value.trim();
  const items = [];
  for (const c of paletteCommands()) {
    const m = q ? fuzzy(q, c.keys) : { score: 0 };
    if (!m) continue;
    const t = q ? fuzzy(q, c.title) : null;
    items.push({ ...c, score: m.score, html: t ? mark(c.title, t.idx) : esc(c.title) });
  }
  pal.headlines.forEach((h, i) => {
    const at = h.title.toLowerCase().indexOf(q.toLowerCase());
    items.push({
      group: 'Headlines', score: 30, icon: logo(h.ticker),
      html: at >= 0 ? mark(h.title, Array.from(q, (_, k) => at + k)) : esc(h.title),
      right: `<span class="pill sm ${h.pred}">${cap(h.pred)}</span>`,
      run: () => openDrawer(pal.headlines, i),
    });
  });
  if (q.length >= 3) {
    items.push({
      group: 'Actions', score: -1, icon: ICON.analyze, html: `Analyze “${esc(trunc(q, 56))}”`, sub: 'with the champion model',
      run: () => { showTab('analyzer'); $('#an-text').value = q; analyze(q); },
    });
  }
  // with a query, the group holding the best match comes first
  const best = g => Math.max(...items.filter(it => it.group === g).map(it => it.score), -Infinity);
  const groups = q ? [...GROUPS].sort((a, b) => best(b) - best(a)) : GROUPS;
  pal.items = groups.flatMap(g => items.filter(it => it.group === g).sort((a, b) => b.score - a.score));
  pal.active = Math.min(pal.active, Math.max(0, pal.items.length - 1));

  let html = '', last = '';
  pal.items.forEach((it, i) => {
    if (it.group !== last) html += `<div class="pal-group">${it.group}</div>`;
    last = it.group;
    html += `
      <div class="pal-item ${i === pal.active ? 'active' : ''}" data-i="${i}" id="pal-opt-${i}" role="option" aria-selected="${i === pal.active}">
        <span class="pal-icon">${it.icon}</span>
        <span class="pal-main">${it.html}${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ''}</span>
        <span class="pal-right">${it.right || ''}<span class="pal-enter">↵</span></span>
      </div>`;
  });
  if (pal.loading) html += `<div class="pal-group">Headlines</div><div class="pal-loading">${sk('72%')}</div>`;
  $('#pal-list').innerHTML = html || `<div class="pal-empty">No results for “${esc(q)}”</div>`;
  $('#pal-input').setAttribute('aria-activedescendant', pal.items.length ? `pal-opt-${pal.active}` : '');
  $('#pal-count').textContent = pal.items.length ? `${pal.items.length} result${pal.items.length === 1 ? '' : 's'}` : '';
}

function setPaletteActive(i, scroll = true) {
  pal.active = i;
  $$('#pal-list .pal-item').forEach(el => {
    const on = Number(el.dataset.i) === i;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', on);
    if (on && scroll) el.scrollIntoView({ block: 'nearest' });
  });
  $('#pal-input').setAttribute('aria-activedescendant', `pal-opt-${i}`);
}

// headline search runs on the server, a moment after typing stops
function searchHeadlines() {
  clearTimeout(pal.timer);
  const q = $('#pal-input').value.trim();
  pal.headlines = [];
  pal.loading = q.length >= 2 && q.length <= 80 && Boolean(state.ov);
  if (!pal.loading) return;
  pal.timer = setTimeout(async () => {
    let found = [];
    try { found = await api(`/api/headlines?q=${encodeURIComponent(q)}&limit=6`); } catch { /* the rest of the palette still works */ }
    if ($('#pal-input').value.trim() !== q) return;
    pal.headlines = found;
    pal.loading = false;
    renderPalette();
  }, 180);
}

function openPalette() {
  if (state.tour) return;
  closeDrawer();
  clearTimeout(pal.hideTimer);
  const el = $('#palette');
  if (el.hidden) pal.returnFocus = document.activeElement;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('open'));
  $('#pal-input').value = '';
  pal.active = 0;
  pal.headlines = [];
  pal.loading = false;
  renderPalette();
  $('#pal-input').focus();
}

function closePalette() {
  const el = $('#palette');
  if (el.hidden) return;
  clearTimeout(pal.timer);
  el.classList.remove('open');
  pal.hideTimer = setTimeout(() => { el.hidden = true; }, reducedMotion ? 0 : 200);
  pal.returnFocus?.focus?.({ preventScroll: true });
}

function runPalette(i) {
  const item = pal.items[i];
  if (!item) return;
  closePalette();
  item.run();
}

const tourTarget = () => $(state.tour.steps[state.tour.i].sel);

function startTour() {
  closeDrawer();
  closePalette();
  showTab('dashboard');
  const steps = TOUR.filter(s => $(s.sel)?.offsetParent);
  if (!steps.length) return;
  state.tour = { steps, i: 0 };
  const el = $('#tour');
  el.hidden = false;
  fillTourStep();
  scrollToTarget();
  // start a bit larger and lower than the target, so the spotlight and card settle into place
  const goal = tourGoal();
  state.tour.spot = { x: goal.spot.x - 24, y: goal.spot.y - 24, w: goal.spot.w + 48, h: goal.spot.h + 48 };
  state.tour.pop = { x: goal.pop.x, y: goal.pop.y + 14 };
  requestAnimationFrame(() => el.classList.add('open'));
  state.tour.raf = requestAnimationFrame(tourFrame);
  $('#tour-next').focus({ preventScroll: true });
}

function fillTourStep() {
  const { steps, i } = state.tour, step = steps[i];
  $('#tour-step').textContent = `Step ${i + 1} of ${steps.length}`;
  $('#tour-title').textContent = step.title;
  $('#tour-text').innerHTML = step.text;
  $('#tour-back').disabled = i === 0;
  $('#tour-next').textContent = i === steps.length - 1 ? 'Finish' : 'Next';
}

// move to another step: the card glides there while its text crossfades
function showTourStep() {
  scrollToTarget();
  const body = $('#tour-body');
  body.classList.add('swap');
  clearTimeout(state.tour.swapTimer);
  state.tour.swapTimer = setTimeout(() => {
    if (!state.tour) return;
    fillTourStep();
    body.classList.remove('swap');
  }, reducedMotion ? 0 : 150);
  $('#tour-next').focus({ preventScroll: true });
}

// scroll only when the target isn't already comfortably on screen (the top bar never needs it)
function scrollToTarget() {
  const el = tourTarget(), r = el.getBoundingClientRect();
  if (el.closest('.topbar')) return;
  if (r.top < 96 || r.bottom > innerHeight - 16) el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
}

// where the spotlight and card should be right now (recomputed every frame, so it follows scrolling)
function tourGoal() {
  const r = tourTarget().getBoundingClientRect(), pad = 6, gap = 14, m = 12;
  const pop = $('#tour-pop'), w = pop.offsetWidth, h = pop.offsetHeight;
  let top = r.bottom + gap, left = Math.min(Math.max(m, r.left), innerWidth - w - m);
  if (top + h > innerHeight - m) top = r.top - gap - h; // above
  if (top < m) { // neither fits: tuck it inside the bottom-right of the highlighted area
    top = Math.min(r.bottom - h - 16, innerHeight - h - m);
    left = Math.min(r.right - w - 16, innerWidth - w - m);
  }
  if (r.right + gap + w < innerWidth - m && r.height > innerHeight * 0.45) { // tall targets: to the right
    left = r.right + gap;
    top = Math.min(Math.max(m, r.top), innerHeight - h - m);
  }
  return {
    spot: { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 },
    pop: { x: Math.max(m, left), y: Math.max(m, top) },
  };
}

// every frame, ease the spotlight and card toward their goal (time-based, so it's the same at any frame rate)
function tourFrame(now) {
  const t = state.tour;
  if (!t) return;
  const dt = Math.min(64, now - (t.last ?? now));
  t.last = now;
  const k = reducedMotion ? 1 : 1 - Math.exp(-dt / 80);
  const goal = tourGoal();
  for (const key in goal.spot) t.spot[key] += (goal.spot[key] - t.spot[key]) * k;
  for (const key in goal.pop) t.pop[key] += (goal.pop[key] - t.pop[key]) * k;
  const spot = $('#tour-spot');
  spot.style.transform = `translate3d(${t.spot.x}px, ${t.spot.y}px, 0)`;
  spot.style.width = `${t.spot.w}px`;
  spot.style.height = `${t.spot.h}px`;
  $('#tour-pop').style.transform = `translate3d(${t.pop.x}px, ${t.pop.y}px, 0)`;
  t.raf = requestAnimationFrame(tourFrame);
}

function stepTour(delta) {
  const t = state.tour;
  if (!t) return;
  if (t.i + delta >= t.steps.length) return endTour();
  if (t.i + delta < 0) return;
  t.i += delta;
  showTourStep();
}

function endTour() {
  const t = state.tour;
  if (!t) return;
  state.tour = null;
  cancelAnimationFrame(t.raf);
  clearTimeout(t.swapTimer);
  store('toured', '1');
  const el = $('#tour');
  el.classList.remove('open');
  setTimeout(() => { if (!state.tour) el.hidden = true; }, reducedMotion ? 0 : 300);
}

// ---------- models ----------
async function loadModels() {
  try {
    state.models = await api('/api/models');
  } catch (e) {
    setStatus(false, 'Registry unavailable');
    $('#tbl-models').innerHTML = messageRow(e.message);
    $('#chart-models').parentElement.querySelector('.sk-chart')?.remove();
    return;
  }
  const champ = state.models.find(m => m.champion);
  setStatus(Boolean(champ), champ ? `Champion <b>v${champ.version}</b> · Macro F1 <b class="num">${f3(champ.f1_macro)}</b>` : 'No champion yet');
  if (!state.models.length) {
    $('#chart-models').parentElement.querySelector('.sk-chart')?.remove();
    $('#tbl-models').innerHTML = messageRow('No registered models yet. Run: uv run python -m scripts.train baseline');
    return;
  }
  $('#tbl-models').innerHTML = `
    <thead><tr><th>Version</th><th>Run</th><th>Registered</th><th class="r">Macro F1</th><th class="r">Accuracy</th><th>Status</th></tr></thead>
    <tbody>${state.models.map(m => `
      <tr>
        <td class="num">v${m.version}</td>
        <td>${esc(m.run)}</td>
        <td class="num t-time">${when(m.created)}</td>
        <td class="num r">${f3(m.f1_macro)}</td>
        <td class="num r">${f3(m.accuracy)}</td>
        <td>${m.champion ? '<span class="badge champ">Champion</span>' : '<span class="badge">Candidate</span>'}</td>
      </tr>`).join('')}
    </tbody>`;
}

function renderModelChart() {
  const champ = state.models.find(m => m.champion);
  const other = state.models.find(m => !m.champion);
  const shown = [champ, other].filter(Boolean);
  chart('chart-models', {
    type: 'bar',
    data: {
      labels: TICKERS,
      datasets: shown.map(m => ({
        label: `v${m.version}${m.champion ? ' · champion' : ''}`,
        data: TICKERS.map(t => m.per_ticker[t]),
        backgroundColor: m.champion ? C.accent : alpha(C.muted, 0.5),
        borderRadius: 3, barPercentage: 0.8, categoryPercentage: 0.7,
      })),
    },
    options: {
      plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${f3(ctx.parsed.y)}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: C.text, maxRotation: 0, autoSkip: false, font: { size: 10.5, weight: 600 } } },
        y: { min: 0, max: 1, ticks: { stepSize: 0.2, callback: v => v.toFixed(1) } },
      },
    },
  });
}

// ---------- navigation ----------
function showTab(name) {
  if (!TABS.includes(name)) name = 'dashboard';
  history.replaceState(null, '', `#${name}`);
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  moveInk();
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'headlines' && !state.newsLoaded) loadNews();
  if (name === 'models' && state.models.length) renderModelChart();
}

function bindUI() {
  $$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  addEventListener('resize', moveInk);
  document.fonts?.ready.then(moveInk);
  moveInk();

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-ticker]');
    if (!el || !state.ov) return;
    showTab('dashboard');
    selectTicker(el.dataset.ticker);
  });

  seg($('#range'), d => {
    state.days = Number(d.days);
    renderDaily();
  });
  $('#price-toggle').addEventListener('click', () => {
    state.price = !state.price;
    store('price', state.price ? '1' : '0');
    renderDaily();
  });

  $('#f-ticker').innerHTML = ['<button data-t="" class="active">All</button>', ...TICKERS.map(t => `<button data-t="${t}">${t}</button>`)].join('');
  seg($('#f-ticker'), d => { state.news.ticker = d.t; loadNews(); });
  seg($('#f-label'), d => { state.news.label = d.label; loadNews(); });
  $('#f-search').addEventListener('input', filterNews);

  $('#examples').innerHTML = EXAMPLES.map(t => `<button class="example">${esc(t)}</button>`).join('');
  $('#examples').addEventListener('click', e => {
    const b = e.target.closest('.example');
    if (!b) return;
    $('#an-text').value = b.textContent;
    analyze(b.textContent);
  });
  $('#an-form').addEventListener('submit', e => { e.preventDefault(); analyze($('#an-text').value); });
  $('#an-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); analyze($('#an-text').value); }
  });

  // command palette
  $('#omni-kbd').textContent = MOD_K;
  $('#omnibox').addEventListener('click', () => openPalette());
  $('#pal-backdrop').addEventListener('click', closePalette);
  $('#pal-input').addEventListener('input', () => {
    pal.active = 0;
    searchHeadlines();
    renderPalette();
  });
  $('#pal-input').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = pal.items.length;
      if (n) setPaletteActive((pal.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(pal.active); }
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  $('#pal-list').addEventListener('mousemove', e => {
    const item = e.target.closest('.pal-item');
    if (item && Number(item.dataset.i) !== pal.active) setPaletteActive(Number(item.dataset.i), false);
  });
  $('#pal-list').addEventListener('click', e => {
    const item = e.target.closest('.pal-item');
    if (item) runPalette(Number(item.dataset.i));
  });
  // headline rows open the detail panel (click, or Enter when the row is focused)
  ['#tbl-dash', '#tbl-news'].forEach(sel => {
    const table = $(sel);
    const open = e => {
      const tr = e.target.closest('tr[data-idx]');
      if (tr && !e.target.closest('a, .tkr')) openDrawer(table._rows, Number(tr.dataset.idx));
    };
    table.addEventListener('click', open);
    table.addEventListener('keydown', e => { if (e.key === 'Enter') open(e); });
  });
  $('#dr-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  $('#dr-prev').addEventListener('click', () => stepDrawer(-1));
  $('#dr-next').addEventListener('click', () => stepDrawer(1));
  $('#dr-body').addEventListener('click', e => {
    if (!e.target.closest('#dr-analyze')) return;
    const r = state.drawer.rows[state.drawer.idx], text = r.text || r.title;
    closeDrawer();
    showTab('analyzer');
    $('#an-text').value = text;
    analyze(text);
  });

  $('#dash-all').addEventListener('click', () => showTab('headlines'));

  // guided tour
  $('#tour-btn').addEventListener('click', startTour);
  $('#theme-btn').addEventListener('click', toggleTheme);
  $('#tour-next').addEventListener('click', () => stepTour(1));
  $('#tour-back').addEventListener('click', () => stepTour(-1));
  $('#tour-skip').addEventListener('click', endTour);

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('#palette').hidden) openPalette();
      else closePalette();
      return;
    }
    if (!$('#palette').hidden) return; // the palette input handles its own keys
    if (state.tour) {
      if (e.key === 'Escape') endTour();
      if (e.key === 'ArrowRight') stepTour(1);
      if (e.key === 'ArrowLeft') stepTour(-1);
      return;
    }
    if (state.drawer) {
      if (e.key === 'Escape') closeDrawer();
      if (e.key === 'ArrowLeft') stepDrawer(-1);
      if (e.key === 'ArrowRight') stepDrawer(1);
      return;
    }
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      openPalette();
    }
  });
}

async function init() {
  setupCharts();
  bindUI();
  showSkeletons();
  const models = loadModels();
  try {
    state.ov = await api('/api/overview');
  } catch (e) {
    showNoData(e.message);
  }
  const splashGone = hideSplash();
  if (state.ov) {
    renderAsOf();
    renderStale();
    renderWatchlist();
    reveal($('#watchlist'));
    reveal($('.quote'));
    await selectTicker(state.ticker);
  }
  await models;
  showTab(location.hash.slice(1));
  // first visit: show the tour once the splash is gone
  await splashGone;
  if (state.ov && !store('toured') && location.hash.slice(1) === 'dashboard') setTimeout(startTour, 400);
}

init();
