/* FinMLOps sentiment dashboard: vanilla JS + Chart.js, talks to frontend/server.py */

const TICKERS = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMZN', 'TSLA'];
const LABELS = ['positive', 'neutral', 'negative'];
const TABS = ['dashboard', 'headlines'];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const C = {};
const state = {
  ov: null,
  ticker: store('ticker') || 'NVDA',
  days: 30,
  price: store('price') !== '0',
  charts: {},
  news: { ticker: '', label: '' },
  newsRows: [],
  newsLoaded: false,
  drawer: null,
  drawerToken: null,
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
const day = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const messageRow = msg => `<tbody><tr><td class="empty-row">${esc(msg)}</td></tr></tbody>`;

// company logo on a light tile (logos/<ticker>.svg); falls back to first letter
const logo = (ticker, cls = '') => `<span class="logo ${cls}"><img src="logos/${ticker.toLowerCase()}.svg" alt="${ticker}" loading="lazy"
  onerror="this.replaceWith(document.createTextNode('${ticker[0]}'))"></span>`;

// dashed vertical line under cursor
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

function showSkeletons() {
  $('#tape').innerHTML = TICKERS.map(() => `<div class="tape-item">${sk('40px')}${sk('36px')}${sk('44px')}</div>`).join('');
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
  $('#mix').innerHTML = `<div class="mixbar">${sk('100%', '', '8px')}</div>
    <div class="mix-rows">${LABELS.map(() => `<div class="mix-row">${sk('8px', '', '8px')}${sk('64px')}${sk('30px')}${sk('34px')}${sk('40px')}</div>`).join('')}</div>`;
  $('#tbl-dash').innerHTML = skRows(6);
  $('#heatmap').innerHTML = TICKERS.map(() => sk('100%', '', '22px')).join('');
  skChart('chart-daily');
  skChart('chart-volume', 30);
  skChart('chart-peers');
}

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
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `${res.status} ${res.statusText}`);
  return body;
}

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

function setStatus(live, html) {
  const el = $('#status');
  if (!el) return;
  el.classList.toggle('live', live);
  el.innerHTML = `<span class="dot"></span>${html}`;
}

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

function tweenAll(root, values) {
  $$('[data-k]', root).forEach(el => {
    const entry = values[el.dataset.k];
    if (!entry) return;
    const [v, fmt] = entry;
    countTo(el, el.dataset.k, v, fmt);
  });
}

function reveal(el) {
  if (!el) return;
  el.classList.remove('fade-in');
  void el.offsetWidth;
  el.classList.add('fade-in');
}

// ---------- splash ----------
const SPLASH_MESSAGES = ['Loading market sentiment…', 'Reading the headlines…', 'Asking FinBERT how it feels…', 'Lining up the charts…'];
const splashStart = performance.now();
const splashTimer = setInterval(() => {
  const el = $('#splash-msg');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = SPLASH_MESSAGES[(SPLASH_MESSAGES.indexOf(el.textContent) + 1) % SPLASH_MESSAGES.length];
    el.style.opacity = '1';
  }, 200);
}, 1400);

const SPLASH_MIN_MS = 2000;

function hideSplash() {
  const wait = Math.max(0, SPLASH_MIN_MS - (performance.now() - splashStart));
  return new Promise(resolve => setTimeout(() => {
    clearInterval(splashTimer);
    const el = $('#splash');
    if (!el) return resolve();
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
  if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', el).forEach(x => x.classList.toggle('active', x === b));
    onPick(b.dataset);
  });
}

function showTab(name) {
  if (!TABS.includes(name)) name = 'dashboard';
  history.replaceState(null, '', `#${name}`);
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  moveInk();
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'headlines' && !state.newsLoaded) loadNews();
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
    backgroundColor: '#0c1016', borderColor: css('--border-2'), borderWidth: 1,
    titleColor: C.text, bodyColor: C.muted, padding: 10, cornerRadius: 4, boxPadding: 4,
  });
}

// ---------- dashboard data & rendering ----------
const current = () => state.ov?.tickers?.find(t => t.ticker === state.ticker) || state.ov?.tickers?.[0];
const change = t => (t ? t.week.net - t.prev.net : 0);

function renderTape() {
  const items = state.ov.tickers.map(t => `
    <button class="tape-item" data-ticker="${t.ticker}">
      <b>${t.ticker}</b>
      <span class="num ${tone(t.week.net)}">${signed(t.week.net)}</span>
      <span class="num ${tone(change(t))}">${arrow(change(t))} ${signed(change(t))}</span>
    </button>`).join('');
  const asOf = new Date(state.ov.as_of).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('#tape').innerHTML = `${items}<div class="tape-asof">Data as of ${asOf} · scored by v${esc(state.ov.scored_by)}</div>`;
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
    <li class="wl-row wl-item ${t.ticker === state.ticker ? 'active' : ''}" data-ticker="${t.ticker}">
      <div class="wl-id">${logo(t.ticker)}<div><b>${t.ticker}</b><span>${esc(t.name)}</span></div></div>
      ${spark(t.daily)}
      <span class="num ${tone(t.week.net)}">${signed(t.week.net)}</span>
      <span class="num ${tone(change(t))}">${signed(change(t))}</span>
    </li>`).join('');
}

function renderTable(el, rows) {
  if (!rows || !rows.length) {
    el.innerHTML = messageRow('No headlines match.');
    return;
  }
  el._rows = rows; // the detail panel steps through these
  el.innerHTML = `
    <thead><tr><th>Time</th><th class="t-tkr">Ticker</th><th>Headline</th><th>Sentiment</th><th class="t-conf">Confidence</th></tr></thead>
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

async function selectTicker(ticker) {
  if (!state.ov) return;
  if (!state.ov.tickers.some(t => t.ticker === ticker)) ticker = state.ov.tickers[0].ticker;
  state.ticker = ticker;
  store('ticker', ticker);
  $$('.wl-item, .tape-item').forEach(el => el.classList.toggle('active', el.dataset.ticker === ticker));
  markHeatmapRow();
  renderQuote();
  renderDaily();
  renderMix();
  renderPeers();
  $('#tbl-dash').innerHTML = skRows(6);
  try {
    const rows = await api(`/api/headlines?ticker=${ticker}&limit=25`);
    if (state.ticker !== ticker) return;
    $('#dash-count').textContent = `${rows.length} most recent`;
    renderTable($('#tbl-dash'), rows);
  } catch (e) {
    $('#tbl-dash').innerHTML = messageRow(e.message);
  }
}

function renderQuote() {
  const t = current();
  if (!t) return;
  const w = t.week, d = change(t);
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
  const t = current();
  if (!t) return;
  let rows = t.daily;
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
    stat('High', 'c-hi', day(hi.date), tone(hi.net)),
    stat('Low', 'c-lo', day(lo.date), tone(lo.net)),
    stat('Articles', 'c-total', `${Math.round(total / rows.length)} / day`),
    known.length > 1 ? stat('Close', 'c-close', `<span class="${tone(priceChange)}">${signed(priceChange, 2)}%</span> in range`) : '',
    `<div class="chart-legend"><span><i class="line"></i>Net sentiment</span>${showPrice ? '<span><i class="line price"></i>Close price</span>' : ''}${LABELS.map(l => `<span><i class="bg-${l}"></i>${cap(l)}</span>`).join('')}</div>`,
  ].join('');
  if (fresh) reveal($('#chart-stats'));
  tweenAll($('#chart-stats'), {
    'c-avg': [avg, v => signed(v)],
    'c-hi': [hi.net, v => signed(v)],
    'c-lo': [lo.net, v => signed(v)],
    'c-total': [total, v => Math.round(v).toLocaleString('en-US')],
    'c-close': [known[known.length - 1] ?? 0, v => `$${v.toFixed(2)}`],
  });

  const PRICE_AXIS = 58;
  const yAxis = extra => ({ position: 'right', afterFit: s => { s.width = 46; }, ...extra });
  const tooltip = { position: 'nearest', caretPadding: 8 };

  const hiIdx = rows.indexOf(hi), loIdx = rows.indexOf(lo);
  const marked = i => i === hiIdx || i === loIdx;

  const datasets = [{
    label: 'Net sentiment', data: nets, yAxisID: 'y', order: 1,
    borderColor: C.accent, borderWidth: 2, tension: 0.35,
    pointRadius: rows.map((_, i) => (marked(i) ? 5 : 0)),
    pointBackgroundColor: rows.map((_, i) => (i === hiIdx ? C.positive : i === loIdx ? C.negative : C.accent)),
    pointBorderColor: css('--panel'), pointBorderWidth: 2,
    pointHoverRadius: 5, pointHoverBackgroundColor: C.accent, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
    fill: { target: 'origin', above: alpha(C.positive, 0.1), below: alpha(C.negative, 0.12) },
  }];
  if (known.length > 1) {
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
        const r = rows[els[0].index];
        const list = [r.top_positive, r.top_negative].filter(Boolean);
        if (!list.length) return toast(`No headlines for ${labels[els[0].index]}.`);
        const start = els[0].index === loIdx && r.top_negative ? list.indexOf(r.top_negative) : 0;
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
              if (r.top_positive) out.push(`▲ ${trunc(r.top_positive.title)}`);
              if (r.top_negative) out.push(`▼ ${trunc(r.top_negative.title)}`);
              return out;
            },
            footer: items => {
              const r = rows[items[0].dataIndex];
              return (r.top_positive || r.top_negative) ? 'Click to read top headlines' : '';
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { display: false }, border: { display: false } },
        y: yAxis({
          grace: '8%',
          border: { display: false },
          grid: { color: ctx => (ctx.tick.value === 0 ? css('--border-2') : C.grid) },
          ticks: { maxTicksLimit: 6, callback: v => (v > 0 ? '+' : '') + v },
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

function renderMix() {
  const t = current();
  if (!t) return;
  const w = t.week, p = t.prev;
  let bar = $('#mix .mixbar.real');
  if (!bar) {
    $('#mix').innerHTML = `<div class="mixbar real">${LABELS.map(l => `<span class="bg-${l}" style="width:0"></span>`).join('')}</div><div class="mix-rows"></div>`;
    bar = $('#mix .mixbar.real');
    reveal($('#mix'));
    void bar.offsetWidth;
  }
  LABELS.forEach((l, i) => { bar.children[i].style.width = `${pct(w[l], w.articles)}%`; });
  const values = {};
  $('#mix .mix-rows').innerHTML = LABELS.map(l => {
    const now = pct(w[l], w.articles), diff = now - pct(p[l], p.articles);
    const good = Math.round(l === 'positive' ? diff : l === 'negative' ? -diff : 0);
    values[`m-${l}-n`] = [w[l], v => Math.round(v)];
    values[`m-${l}-p`] = [now, v => `${v.toFixed(0)}%`];
    return `<div class="mix-row">
      <span class="swatch bg-${l}"></span><span>${cap(l)}</span>
      <span class="num" data-k="m-${l}-n"></span><span class="num" data-k="m-${l}-p"></span>
      <span class="num small ${tone(good)}">${signed(diff, 0)} pp</span>
    </div>`;
  }).join('');
  tweenAll($('#mix'), values);
}

function renderPeers() {
  const peers = [...state.ov.tickers].sort((a, b) => b.week.net - a.week.net);
  chart('chart-peers', {
    type: 'bar',
    data: {
      labels: peers.map(t => t.ticker),
      datasets: [{
        data: peers.map(t => t.week.net),
        backgroundColor: peers.map(t => (t.ticker === state.ticker ? C.accent : alpha(t.week.net >= 0 ? C.positive : C.negative, 0.45))),
        borderRadius: 3, barThickness: 14,
      }],
    },
    options: {
      indexAxis: 'y',
      onClick: (e, els) => els.length && selectTicker(peers[els[0].index].ticker),
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Net 7D: ${signed(ctx.parsed.x)}` } } },
      scales: {
        x: { ticks: { callback: v => (v > 0 ? '+' : '') + v } },
        y: { grid: { display: false }, ticks: { color: C.text, font: { weight: 600 } } },
      },
    },
  });
}

function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function heat(v, max) {
  const k = Math.max(-1, Math.min(1, v / max)), t = Math.abs(k) ** 0.75;
  const base = rgb(css('--panel-2')), end = rgb(k >= 0 ? C.positive : C.negative);
  return `rgb(${base.map((b, i) => Math.round(b + (end[i] - b) * t)).join(',')})`;
}

function renderHeatmap() {
  const tickers = state.ov.tickers;
  const dates = [...new Set(tickers.flatMap(t => t.daily.map(d => d.date)))].sort();
  const byDate = Object.fromEntries(tickers.map(t => [t.ticker, Object.fromEntries(t.daily.map(d => [d.date, d]))]));
  const max = Math.max(40, ...tickers.flatMap(t => t.daily.map(d => Math.abs(d.net))));
  const head = dates.map((d, i) => {
    const dt = new Date(`${d}T00:00:00Z`), dom = dt.getUTCDate(), weekend = [0, 6].includes(dt.getUTCDay());
    const month = i === 0 || dom === 1;
    return `<span class="hm-day ${weekend ? 'wknd' : ''} ${month ? 'month' : ''}">${month ? dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : dom}</span>`;
  }).join('');
  const rows = tickers.map((t, r) => `
    <div class="hm-row" data-row="${t.ticker}">
      <button class="hm-label" data-ticker="${t.ticker}">${logo(t.ticker)}${t.ticker}</button>
      ${dates.map((d, c) => {
        const day = byDate[t.ticker][d];
        return day && day.articles
          ? `<span class="hm-cell" data-t="${t.ticker}" data-d="${d}" style="--c:${c};--r:${r};background:${heat(day.net, max)}"></span>`
          : `<span class="hm-cell empty" style="--c:${c};--r:${r}"></span>`;
      }).join('')}
    </div>`).join('');
  $('#heatmap').style.setProperty('--n', dates.length);
  $('#heatmap').innerHTML = `<div class="hm-row hm-head" style="--n:${dates.length}"><span></span>${head}</div>${rows}`;
  $$('#heatmap .hm-row').forEach(row => row.style.setProperty('--n', dates.length));
  state.heat = byDate;
  markHeatmapRow();
}

function markHeatmapRow() {
  $$('#heatmap .hm-row[data-row]').forEach(row => row.classList.toggle('sel', row.dataset.row === state.ticker));
}

function heatTip(cell) {
  const tip = $('#hm-tip');
  if (!tip) return;
  if (!cell) return tip.classList.remove('show');
  const day = state.heat[cell.dataset.t][cell.dataset.d];
  const top = day.top_positive || day.top_negative;
  tip.innerHTML = `
    <div class="tip-head"><b>${cell.dataset.t} · ${day.date ? new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''}</b>
      <b class="num ${tone(day.net)}">${signed(day.net)}</b></div>
    <div class="num">${day.articles} articles · ${day.positive} pos · ${day.neutral} neu · ${day.negative} neg</div>
    ${day.top_positive ? `<div class="tip-hl">▲ ${esc(trunc(day.top_positive.title, 70))}</div>` : ''}
    ${day.top_negative ? `<div class="tip-hl">▼ ${esc(trunc(day.top_negative.title, 70))}</div>` : ''}
    ${top ? '<div class="tip-foot">Click to read the top headlines</div>' : ''}`;
  const r = cell.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let top_ = r.top - h - 10;
  if (top_ < 60) top_ = r.bottom + 10;
  tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
  tip.style.top = `${top_}px`;
  tip.classList.add('show');
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

// ---------- headline detail panel (drawer) ----------
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
    <div class="sub-head">Headline text</div>
    <div id="dr-analysis">
      <p class="muted" style="line-height:1.6;font-size:13.5px">${esc(r.text || r.title)}</p>
    </div>
    <div class="dr-actions">
      ${r.url ? `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Read the article ↗</a>` : ''}
    </div>`;
  $('#dr-body').scrollTop = 0;
  reveal($('#dr-body'));
}

function showNoData(msg) {
  $('#view-dashboard').innerHTML = `
    <div class="panel empty-state">
      <h2>No predictions to show yet</h2>
      <p>${esc(msg)}</p>
      <pre>uv run python -m scripts.train baseline   # first champion
uv run python -m frontend.server score         # label news.parquet</pre>
    </div>`;
  $('#watchlist').innerHTML = '<li class="wl-empty">No data yet.</li>';
  $('#tape').innerHTML = '<div class="tape-item muted">No predictions yet</div>';
}

function bindUI() {
  // Navigation tabs
  $$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  addEventListener('resize', moveInk);
  document.fonts?.ready?.then(moveInk);
  moveInk();

  // Watchlist & Tape item click
  document.addEventListener('click', e => {
    const item = e.target.closest('[data-ticker]');
    if (item && !item.closest('.tbl')) {
      e.preventDefault();
      showTab('dashboard');
      selectTicker(item.dataset.ticker);
    }
  });

  // Range selector
  const range = $('#range');
  if (range) {
    range.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      $$('button', range).forEach(x => x.classList.toggle('active', x === b));
      state.days = Number(b.dataset.days);
      renderDaily();
    });
  }

  // Price toggle
  const priceToggle = $('#price-toggle');
  if (priceToggle) {
    priceToggle.addEventListener('click', () => {
      state.price = !state.price;
      store('price', state.price ? '1' : '0');
      priceToggle.classList.toggle('on', state.price);
      renderDaily();
    });
  }

  // News filters
  const fTicker = $('#f-ticker');
  if (fTicker) {
    fTicker.innerHTML = ['<button data-t="" class="active">All</button>', ...TICKERS.map(t => `<button data-t="${t}">${t}</button>`)].join('');
    seg(fTicker, d => { state.news.ticker = d.t; loadNews(); });
  }
  const fLabel = $('#f-label');
  if (fLabel) {
    seg(fLabel, d => { state.news.label = d.label; loadNews(); });
  }
  $('#f-search')?.addEventListener('input', filterNews);

  // Headline tables open drawer
  ['#tbl-dash', '#tbl-news'].forEach(sel => {
    const table = $(sel);
    if (!table) return;
    const open = e => {
      const tr = e.target.closest('tr[data-idx]');
      if (tr && !e.target.closest('a, .tkr')) openDrawer(table._rows, Number(tr.dataset.idx));
    };
    table.addEventListener('click', open);
    table.addEventListener('keydown', e => { if (e.key === 'Enter') open(e); });
  });

  // Drawer events
  $('#dr-close')?.addEventListener('click', closeDrawer);
  $('#drawer-backdrop')?.addEventListener('click', closeDrawer);
  $('#dr-prev')?.addEventListener('click', () => stepDrawer(-1));
  $('#dr-next')?.addEventListener('click', () => stepDrawer(1));

  // Global key navigation
  addEventListener('keydown', e => {
    if (state.drawer) {
      if (e.key === 'Escape') closeDrawer();
      if (e.key === 'ArrowLeft') stepDrawer(-1);
      if (e.key === 'ArrowRight') stepDrawer(1);
    }
  });

  // Heatmap hover & click
  const hm = $('#heatmap');
  if (hm) {
    hm.addEventListener('mouseover', e => heatTip(e.target.closest('.hm-cell:not(.empty)')));
    hm.addEventListener('mouseleave', () => heatTip(null));
    addEventListener('scroll', () => heatTip(null), { passive: true });
    hm.addEventListener('click', e => {
      const cell = e.target.closest('.hm-cell:not(.empty)');
      if (!cell) return;
      const day = state.heat?.[cell.dataset.t]?.[cell.dataset.d];
      if (!day) return;
      const list = [day.top_positive, day.top_negative].filter(Boolean);
      heatTip(null);
      if (!list.length) return toast(`No headlines for ${cell.dataset.t} on ${cell.dataset.d}.`);
      openDrawer(list, 0);
    });
  }
}

async function init() {
  setupCharts();
  bindUI();
  showSkeletons();
  try {
    state.ov = await api('/api/overview');
  } catch (e) {
    showNoData(e.message);
  }
  await hideSplash();
  if (state.ov) {
    setStatus(true, 'Live');
    renderTape();
    renderWatchlist();
    renderHeatmap();
    reveal($('#tape'));
    reveal($('#watchlist'));
    reveal($('.quote'));
    await selectTicker(state.ticker);
    const tab = location.hash.replace('#', '');
    if (tab && TABS.includes(tab)) showTab(tab);
  } else {
    setStatus(false, 'Offline');
  }
}

init();
