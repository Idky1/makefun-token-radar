// Token Radar dashboard: board, live tokens and the model, from window.RADAR (data.js).
// No network, no framework. Hash routes: #/detail/<slug> opens one protocol,
// #/filter/<category> opens the board filtered to that category.

(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.textContent = 'No radar data (data.js missing).'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var rows = D.rows, live = D.live;

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return v > 0 ? '<span class="up">' + s + '</span>' : v < 0 ? '<span class="down">' + s + '</span>' : s;
  }
  function ageText(a) {
    if (a === null || a === undefined) return '—';
    if (a < 30) return a + 'd';
    if (a < 365) return Math.round(a / 30) + 'mo';
    return (a / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chainPills(chains) {
    return chains.map(function (c) { return '<span class="pill">' + esc(c) + '</span>'; }).join('');
  }

  // ---- header ----
  $('modelVersion').textContent = D.model_version;
  $('headline').textContent = D.board_size + ' pre-token protocols ranked by implied value · ' +
    D.watchlist_size + ' on the watchlist · ' + D.early_size + ' found below the floor · ' +
    D.live_size + ' live tokens set aside · snapshot ' + D.as_of;
  $('sourceLine').textContent = 'Source: ' + D.source.replace(/^DefiLlama /, 'DefiLlama — ') + ' · floor ' + money(D.floor_usd);

  // ---- filter options ----
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  function fillSelect(el, values, label) {
    el.innerHTML = '<option value="">' + label + '</option>' + values.sort().map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  fillSelect($('cat'), Object.keys(cats), 'All categories');
  fillSelect($('chain'), Object.keys(chains), 'All chains');

  // ---- state ----
  var state = { view: 'board', q: '', cat: '', chain: '', sort: 'rank' };

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = state.sort;
    out.sort(function (a, b) {
      if (k === 'implied') return b.implied_value_usd - a.implied_value_usd;
      if (k === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (k === 'change') return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d);
      if (k === 'age') return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days);
      return a.rank - b.rank;
    });
    return out;
  }

  function renderBoard() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + chainPills(r.chains.slice(0, 3)) + (r.chains.length > 3 ? '<span class="pill">+' + (r.chains.length - 3) + '</span>' : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
  }

  function renderLive() {
    $('liveRows').innerHTML = live.map(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : '—';
      return '<tr><td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + chainPills(r.chains.slice(0, 3)) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + ratio + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  function renderModel() {
    var g = D.derived;
    $('multRows').innerHTML =
      '<tr><td><b>All categories (global median)</b></td><td class="num">' + g.tokenized_protocols + '</td><td class="num"><b>' + g.global_multiple.toFixed(4) + '×</b></td></tr>' +
      g.categories.map(function (c) {
        return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.protocols + '</td><td class="num">' + c.multiple.toFixed(4) + '×</td></tr>';
      }).join('');
  }

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) { showView('board'); return; }
    var base = r.tvl_usd * r.base_multiple;
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">#' + r.rank + ' · ' + esc(r.category || 'uncategorised') + ' · ' + chainPills(r.chains) +
      ' · listed ' + esc(r.listed_at || 'unknown') + ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + '</p>' +
      '<h3>Implied value: ' + money(r.implied_value_usd) + '</h3>' +
      '<p class="math">TVL ' + money(r.tvl_usd) + ' × multiple <b>' + r.base_multiple.toFixed(4) + '×</b> = base ' + money(base) +
      '<br>× growth <b>' + r.growth_multiplier.toFixed(4) + '×</b> × maturity <b>' + r.maturity_multiplier.toFixed(4) + '×</b>' +
      '<br>= <b>' + money(r.implied_value_usd) + '</b></p>' +
      '<p class="note">' + (r.multiple_source === 'category'
        ? 'The ' + r.base_multiple.toFixed(4) + '× multiple is the median market-cap-to-TVL ratio of the ' + r.multiple_protocols + ' tokenized ' + esc(r.category || 'uncategorised') + ' protocols in this snapshot — not a fixed constant.'
        : 'The ' + r.base_multiple.toFixed(4) + '× multiple is the global median market-cap-to-TVL ratio of all tokenized protocols in this snapshot — ' + esc(r.category || 'uncategorised') + ' has too few tokenized protocols of its own to price one, so the global median is used.') + '</p>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    setView('detail');
  }

  function setView(v) {
    state.view = v;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === v || (v === 'detail' && tabs[i].getAttribute('data-view') === 'board'));
    $('controls').style.display = v === 'board' ? '' : 'none';
    $('boardView').hidden = v !== 'board';
    $('detailView').hidden = v !== 'detail';
    $('liveView').hidden = v !== 'live';
    $('modelView').hidden = v !== 'model';
  }
  function showView(v) {
    if (v === 'board') { if (location.hash) history.replaceState(null, '', location.pathname); }
    setView(v);
  }

  // ---- events ----
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.getAttribute('data-view')); });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { location.hash = '#/detail/' + tr.getAttribute('data-slug'); }
  });
  $('backBtn').addEventListener('click', function () { location.hash = ''; showView('board'); });
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; renderBoard(); });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; renderBoard(); });
  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var map = { rank: 'rank', name: 'rank', category: 'rank', tvl: 'tvl', change: 'change', age: 'age', implied: 'implied' };
      state.sort = map[th.getAttribute('data-k')] || 'rank';
      $('sort').value = state.sort;
      renderBoard();
    });
  });
  window.addEventListener('hashchange', route);

  function route() {
    var h = location.hash || '';
    var path = h.replace(/^#\/?/, '');
    if (path.indexOf('detail/') === 0) { showDetail(decodeURIComponent(path.slice(7))); return; }
    if (path.indexOf('filter/') === 0) {
      var cat = decodeURIComponent(path.slice(7));
      state.cat = cat;
      $('cat').value = cat;
      setView('board');
      renderBoard();
      return;
    }
    setView('board');
    renderBoard();
  }

  renderBoard();
  renderLive();
  renderModel();
  route();
})();
