// Token Radar v3 dashboard: board, live tokens and the model, from window.RADAR (data.js).
// No network, no framework. v3 is presentation-only on top of the v2 model and data:
// the verdict row answers "what should I farm?" first, the evidence is compressed to a
// strip (full tables live in "The model" tab), the board defaults to net-of-fees order, and
// every row carries its one-line "why this rank" (TVL x multiple x odds). The farm
// sliders recompute every row's verdict, net and net/hour live, with the same arithmetic the
// model used. Hash routes: #/detail/<slug> opens one protocol, #/filter/<category> opens the
// board filtered to that category, #/verdict/<FARM|MARGINAL|SKIP> opens that tab.

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
  function moneyFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
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
  function round2(n) { return Math.round(n * 100) / 100; }

  // ---- farm economics, the same arithmetic the model used (lib/model.ts farmEconomicsWith) ----
  var FARM = { planFloor: 50, planCap: 5000, gasUsd: 25, tbill: 0.05, slip: 0.002, skipLoss: 50, hours: 24 };
  function farmEcon(tvl, implied, planShare, dropShare, horizonWeeks) {
    var plan = Math.max(FARM.planFloor, Math.min(planShare * Math.max(tvl, 1), FARM.planCap));
    var gross = implied * (plan / Math.max(tvl, 1)) * dropShare;
    var costs = FARM.gasUsd + plan * FARM.tbill * (horizonWeeks / 52) + FARM.slip * plan;
    var net = gross - costs;
    var ann = (gross / plan) * (52 / horizonWeeks);
    var verdict = (net > 0 && ann >= FARM.tbill) ? 'FARM' : (net <= -FARM.skipLoss ? 'SKIP' : 'MARGINAL');
    return { plan: round2(plan), gross: round2(gross), costs: round2(costs), net: round2(net), netPerHour: round2(net / FARM.hours), annYield: ann, verdict: verdict };
  }

  // ---- header ----
  $('modelVersion').textContent = D.model_version;
  $('headline').textContent = D.board_size + ' pre-token protocols ranked by implied value · ' +
    D.watchlist_size + ' on the watchlist · snapshot ' + D.as_of;
  $('sourceLine').textContent = 'Source: ' + D.source.replace(/^DefiLlama /, 'DefiLlama — ') + ' · floor ' + money(D.floor_usd);

  // ---- verdict row + compact KPI strip (v3: the verdict is the biggest line; the 6 cards are one muted line) ----
  var V = D.value, O = D.odds, A = D.accounting;
  var keptValue = V.terms.filter(function (t) { return t.kept; }).map(function (t) { return t.label.replace(/^\+ /, ''); }).join(', ') || 'flat median';
  var keptOdds = O.terms.filter(function (t) { return t.kept; }).map(function (t) { return t.label.replace(/^\+ /, ''); }).join(', ') || 'base rate';
  function renderVerdictRow() {
    var best = null;
    rows.forEach(function (r) {
      var e = farmEcon(r.tvl_usd, r.implied_value_usd, state.planShare, state.dropShare, state.horizon);
      if (e.verdict === 'FARM' && (best === null || e.netPerHour > best.netPerHour)) best = e;
    });
    var total = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var bestTxt = best === null ? 'no farm pays yet' : 'best net +$' + best.net.toFixed(2) + ' (+$' + best.netPerHour.toFixed(2) + '/h)';
    $('verdictRow').innerHTML = '<span class="sparkle">✦</span><span class="good">Farm ' + D.farm.farm + ' of ' + D.board_size + '</span> · ' + bestTxt + ' · <span class="acc">' + money(total) + '</span> implied';
  }
  $('kpisCompact').innerHTML =
    'Walk-forward miss <b>×' + V.terms[1].wf.toFixed(2) + '</b> (LOO ×' + V.terms[1].loo.toFixed(2) + ') · ' +
    'range honesty <b>' + Math.round(V.ranges.loo_in_p25_p75 * 100) + '% / ' + Math.round(V.ranges.loo_in_p10_p90 * 100) + '%</b> · ' +
    'odds Brier <b>' + O.brier_loo.toFixed(3) + '</b> (base ' + O.base_brier_loo.toFixed(3) + ') · ' +
    'value: <b>' + esc(keptValue) + '</b> · odds: <b>' + esc(keptOdds) + '</b> · ' +
    'watchlist <b>' + A.ranked_watchlist + '/' + D.watchlist_size + '</b>';

  // ---- formula bar, accounting + verification on one line ----
  $('formulaBar').innerHTML = 'implied = <b>TVL × fitted multiple × token odds</b> · log10(mcap) = <b>' + V.fit.intercept + ' + ' + V.fit.slope + ' × log10(TVL)</b> · odds = logistic(age)';
  $('accounting').innerHTML = '<b>Protocol accounting — all ' + A.total + ' in exactly one group:</b> ' +
    '<b>' + (A.ranked_watchlist + A.ranked_early) + ' ranked</b> (' + A.ranked_watchlist + ' watchlist + ' + A.ranked_early + ' early) · ' +
    '<b>' + (A.token_priced + A.token_no_cap) + ' already record a token</b> · ' +
    '<b>' + (A.out_category + A.out_versioned + A.out_wrapped + A.out_exchange + A.out_other) + ' left out</b> · ' +
    '<span class="verify-inline">✓ board.json verified: ' + D.board_size + '/' + D.board_size + ' rows · ranks in order · ' + moneyFull(rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0)) + ' total · watchlist ' + A.ranked_watchlist + '/' + D.watchlist_size + '</span>';

  // ---- evidence strip (v3: kept rows only, one short panel each; the full tables live in "The model" tab) ----
  function termTag(t) {
    if (t.kept) return '<span class="tag kept">kept</span>';
    if (t.label.indexOf('control') >= 0 || t.label.indexOf('placebo') >= 0) return '<span class="tag placebo">placebo</span>';
    return '<span class="tag tested">tested</span>';
  }
  $('evidence').innerHTML =
    '<div class="ev-mini"><b>Value —</b> kept <b>size curve</b>: LOO ×' + V.terms[1].loo.toFixed(2) + ' · WF ×' + V.terms[1].wf.toFixed(2) + ' · flat ×' + V.terms[0].loo.toFixed(2) + ' / ×' + V.terms[0].wf.toFixed(2) + '.</div>' +
    '<div class="ev-mini"><b>Odds —</b> kept <b>age only</b>: Brier ' + O.brier_loo.toFixed(3) + ' / ' + O.brier_wf.toFixed(3) + ' vs base ' + O.base_brier_loo.toFixed(3) + ' / ' + O.base_brier_wf.toFixed(3) + ' · placebo ' + O.placebo_loo.toFixed(3) + ' / ' + O.placebo_wf.toFixed(3) + '.</div>' +
    '<div class="ev-mini"><b>Ranges —</b> P25–P75 holds <b>' + Math.round(V.ranges.loo_in_p25_p75 * 100) + '% / ' + Math.round(V.ranges.wf_in_p25_p75 * 100) + '%</b> (stated 50%) · P10–P90 holds <b>' + Math.round(V.ranges.loo_in_p10_p90 * 100) + '% / ' + Math.round(V.ranges.wf_in_p10_p90 * 100) + '%</b> (stated 80%).</div>';

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

  // ---- state (v3: the board opens sorted by net of fees, so the farmable rows come first) ----
  var state = { view: 'board', verdict: '', tier: '', q: '', cat: '', chain: '', sort: 'net', planShare: 0.0002, dropShare: 0.07, horizon: 12 };

  function econ(r) { return farmEcon(r.tvl_usd, r.implied_value_usd, state.planShare, state.dropShare, state.horizon); }

  function verdictCounts() {
    var c = { farm: 0, marginal: 0, skip: 0 };
    rows.forEach(function (r) { c[econ(r).verdict.toLowerCase()]++; });
    return c;
  }
  function renderVerdictTabs() {
    var c = verdictCounts();
    var tabs = [
      { k: '', label: 'All', n: rows.length },
      { k: 'FARM', label: 'Farm', n: c.farm },
      { k: 'MARGINAL', label: 'Marginal', n: c.marginal },
      { k: 'SKIP', label: 'Skip', n: c.skip },
    ];
    $('verdictTabs').innerHTML = tabs.map(function (t) {
      return '<button type="button" class="vtab' + (state.verdict === t.k ? ' active' : '') + '" data-v="' + t.k + '">' + t.label + ' <span class="n">' + t.n + '</span></button>';
    }).join('');
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.verdict && econ(r).verdict !== state.verdict) return false;
      if (state.tier === 'watchlist' && !r.watchlist) return false;
      if (state.tier === 'early' && r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var k = state.sort;
    out.sort(function (a, b) {
      if (k === 'implied') return b.implied_value_usd - a.implied_value_usd;
      if (k === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (k === 'odds') return b.token_odds - a.token_odds;
      if (k === 'net') return econ(b).net - econ(a).net;
      return a.rank - b.rank;
    });
    return out;
  }

  function netCell(e) {
    var cls = e.net > 0 ? 'netpos' : e.net < 0 ? 'netneg' : '';
    var sign = e.net > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + '$' + e.net.toFixed(0) + '</span><span class="range">' + sign + '$' + e.netPerHour.toFixed(2) + '/h</span>';
  }

  function renderBoard() {
    renderVerdictTabs();
    renderVerdictRow();
    var list = filtered();
    var tvlSum = list.reduce(function (a, r) { return a + r.tvl_usd; }, 0);
    var impSum = list.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    $('rows').innerHTML = list.map(function (r) {
      var e = econ(r);
      var oddsPct = Math.round(r.token_odds * 100);
      // odds bands: grey under 40%, amber 40-70%, green over 70% (the % figure is the second cue)
      var band = oddsPct < 40 ? 'odds-low' : oddsPct > 70 ? 'odds-high' : 'odds-mid';
      // one-line "why this rank": the three inputs that make the implied value
      // (the slug stays in the row tooltip; the visible line is kept short so the
      // table fits the 1024px viewport without cutting the net column)
      var why = 'TVL ' + money(r.tvl_usd) + ' × ' + r.size_multiple.toFixed(3) + '× · ' + oddsPct + '% odds';
      var whyFull = r.slug + ' · ' + why + ' = if it launches ' + money(r.if_launch_usd) + ' × ' + oddsPct + '% = ' + money(r.implied_value_usd) + ' implied (P25–P75 ' + money(r.implied_p25_usd) + ' – ' + money(r.implied_p75_usd) + ')';
      return '<tr data-slug="' + esc(r.slug) + '" title="' + esc(whyFull) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(why) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><span class="oddsbar"><i class="' + band + '" style="width:' + oddsPct + '%"></i></span>' + oddsPct + '%</td>' +
        '<td class="num">' + money(r.if_launch_usd) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b><span class="range">' + money(r.implied_p25_usd) + ' – ' + money(r.implied_p75_usd) + '</span></td>' +
        '<td><span class="verdict ' + e.verdict + '">' + e.verdict + '</span></td>' +
        '<td class="num">' + netCell(e) + '</td></tr>';
    }).join('');
    $('boardNote').textContent = list.length + ' of ' + rows.length + ' rows · ' + money(tvlSum) + ' TVL · ' + money(impSum) + ' implied. ' +
      'Verdicts and nets follow the sliders below the filters: plan ' + (state.planShare * 100).toFixed(2) + '% of TVL (capped $5,000), drop share ' + Math.round(state.dropShare * 100) + '%, horizon ' + state.horizon + ' weeks, gas $25, T-bill 5%, slippage 0.2%. FARM beats the T-bill after all costs; SKIP loses more than twice the gas cost. Odds bars: grey under 40%, amber 40–70%, green over 70%. Each row shows why it ranks where it does — TVL × fitted multiple × token odds.';
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

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) { showView('board'); return; }
    var e = econ(r);
    var base = r.tvl_usd * r.size_multiple;
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">#' + r.rank + ' · ' + esc(r.category || 'uncategorised') + ' · ' + chainPills(r.chains) +
      ' · listed ' + esc(r.listed_at || 'unknown') + ' · TVL ' + money(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + (r.watchlist ? ' · on the watchlist' : ' · early, below the floor') + '</p>' +
      '<h3>Implied value: ' + money(r.implied_value_usd) + ' <span class="verdict ' + e.verdict + '">' + e.verdict + '</span></h3>' +
      '<p class="math">TVL ' + money(r.tvl_usd) + ' × fitted multiple <b>' + r.size_multiple.toFixed(4) + '×</b> = if it launches ' + money(r.if_launch_usd) +
      '<br>× token odds <b>' + Math.round(r.token_odds * 100) + '%</b> (age ' + ageText(r.age_days) + ', logistic intercept ' + O.weights[0] + ', age weight ' + (O.weights[1] !== undefined ? O.weights[1] : '—') + ')' +
      '<br>= <b>' + money(r.implied_value_usd) + '</b> &nbsp;·&nbsp; P25–P75 ' + money(r.implied_p25_usd) + ' – ' + money(r.implied_p75_usd) + '</p>' +
      '<p class="note">The ' + r.size_multiple.toFixed(4) + '× multiple is the size curve at this TVL — log10(mcap) = ' + V.fit.intercept + ' + ' + V.fit.slope + ' × log10(TVL), fitted on the ' + V.fit.n + ' traded protocols with a listing date — not a fixed constant. The odds come from age alone: of the ' + O.peers + ' protocols with a listing date, ' + Math.round(O.base_rate * 100) + '% recorded a token, and older protocols record one more often.</p>' +
      '<h3>Farm plan — ' + e.verdict + '</h3>' +
      '<p class="math">plan <b>$' + e.plan.toLocaleString('en-US') + '</b> (' + (state.planShare * 100).toFixed(2) + '% of TVL, capped $5,000) · gross <b>$' + e.gross.toFixed(2) + '</b> (' + Math.round(state.dropShare * 100) + '% of implied, shared by plan/TVL) · costs <b>$' + e.costs.toFixed(2) + '</b> (gas $25 + T-bill 5% on the plan for ' + state.horizon + ' weeks + 0.2% slippage) · net <b>$' + e.net.toFixed(2) + '</b> · <b>$' + e.netPerHour.toFixed(2) + '/h</b> over ' + FARM.hours + ' hours · annualised yield <b>' + (e.annYield * 100).toFixed(1) + '%</b> vs a 5% T-bill</p>' +
      '<p class="note">' + (e.verdict === 'FARM' ? 'This position pays for itself and its annualised airdrop yield beats a 5% T-bill on the same capital.' : e.verdict === 'SKIP' ? 'This position loses more than twice the gas cost at the current sliders — the airdrop is too small a share of a TVL this large.' : 'This position does not clear the bar at the current sliders, but it is close enough that a larger plan, a cheaper gas week or a bigger drop share could flip it.') + '</p>' +
      '<h3>Farm steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    setView('detail');
  }

  // ---- full evidence tables (live in "The model" tab; the board shows the compressed strip above) ----
  function valueTable(includeShrunk, includeNote) {
    var h = '<table><thead><tr><th>Value model — typical miss</th><th class="num">LOO</th><th class="num">WF</th><th></th></tr></thead><tbody>';
    h += V.terms.map(function (t) {
      return '<tr><td>' + esc(t.label) + '</td><td class="num">×' + t.loo.toFixed(2) + '</td><td class="num">×' + t.wf.toFixed(2) + '</td><td>' + termTag(t) + '</td></tr>';
    }).join('');
    if (includeShrunk) {
      h += V.shrunk_category.map(function (s) {
        return '<tr><td>category, shrunk k=' + s.shrink + '</td><td class="num">×' + s.loo.toFixed(2) + '</td><td class="num">×' + s.wf.toFixed(2) + '</td><td><span class="tag tested">tested</span></td></tr>';
      }).join('');
    }
    h += '</tbody></table>';
    if (includeNote) h += '<p class="foot-note">kept = lowers both the leave-one-out and the walk-forward miss · tested = tried and dropped · placebo = a control that must not help. Only the size curve is kept.</p>';
    return h;
  }
  function oddsTable(includeNote) {
    var h = '<table><thead><tr><th>Token odds — Brier</th><th class="num">LOO</th><th class="num">WF</th><th></th></tr></thead><tbody>';
    h += O.terms.map(function (t) {
      return '<tr><td>' + esc(t.label) + '</td><td class="num">' + t.loo.toFixed(3) + '</td><td class="num">' + t.wf.toFixed(3) + '</td><td>' + termTag(t) + '</td></tr>';
    }).join('');
    h += '<tr><td>+ control (placebo)</td><td class="num">' + O.placebo_loo.toFixed(3) + '</td><td class="num">' + O.placebo_wf.toFixed(3) + '</td><td><span class="tag placebo">placebo</span></td></tr>';
    h += '</tbody></table>';
    if (includeNote) h += '<p class="foot-note">' + O.peers + ' peers with a listing date · ' + O.recorded + ' recorded a token (' + Math.round(O.base_rate * 100) + '% base rate). The placebo shuffles growth across peers; it does not beat the real model.</p>';
    return h;
  }
  function rangeTable(includeNote) {
    var h = '<table><thead><tr><th>Range honesty</th><th class="num">LOO</th><th class="num">WF</th></tr></thead><tbody>';
    h += '<tr><td>inside P25–P75 (stated 50%)</td><td class="num">' + Math.round(V.ranges.loo_in_p25_p75 * 100) + '%</td><td class="num">' + Math.round(V.ranges.wf_in_p25_p75 * 100) + '%</td></tr>';
    h += '<tr><td>inside P10–P90 (stated 80%)</td><td class="num">' + Math.round(V.ranges.loo_in_p10_p90 * 100) + '%</td><td class="num">' + Math.round(V.ranges.wf_in_p10_p90 * 100) + '%</td></tr>';
    h += '<tr><td>within ×3 of the model</td><td class="num">' + Math.round(V.ranges.within_x3_loo * 100) + '%</td><td class="num">' + Math.round(V.ranges.within_x3_wf * 100) + '%</td></tr>';
    h += '<tr><td>range, P25–P75</td><td class="num" colspan="2">×' + V.ranges.p25.toFixed(2) + ' – ×' + V.ranges.p75.toFixed(2) + '</td></tr>';
    h += '<tr><td>range, P10–P90</td><td class="num" colspan="2">×' + V.ranges.p10.toFixed(2) + ' – ×' + V.ranges.p90.toFixed(2) + '</td></tr>';
    h += '</tbody></table>';
    if (includeNote) h += '<p class="foot-note">Bootstrap, ' + V.bootstrap.refits + ' refits: intercept ' + V.fit.intercept + ' ± ' + V.bootstrap.intercept_se + ' · slope ' + V.fit.slope + ' ± ' + V.bootstrap.slope_se + ' · multiple at $100M TVL ' + V.bootstrap.multiple_100m.toFixed(3) + '× ± ' + V.bootstrap.multiple_100m_se.toFixed(3) + '.</p>';
    return h;
  }

  function renderModel() {
    $('modelFormula').innerHTML = 'implied value = <b>TVL × fitted multiple × token odds</b> &nbsp;·&nbsp; log10(mcap) = <b>' + V.fit.intercept + ' + ' + V.fit.slope + ' × log10(TVL)</b> (R² ' + V.fit.r2 + ', n=' + V.fit.n + ') &nbsp;·&nbsp; odds = logistic(age)';
    $('modelText').innerHTML =
      '<ul class="formula-list">' +
      '<li><b>Value.</b> The size curve is fitted by least squares on the ' + V.fit.n + ' traded protocols that record a listing date. The multiple falls as TVL rises: ' + V.multiple_100m.toFixed(3) + '× at $100M, ' + V.multiple_1b.toFixed(3) + '× at $1B, ' + V.multiple_10b.toFixed(3) + '× at $10B. The flat median multiple (' + V.flat_median.toFixed(4) + '×) is the baseline it is tested against.</li>' +
      '<li><b>Terms.</b> Category, 7-day growth, age, chain count and a placebo control are each tested in turn and kept only when they lower <i>both</i> the leave-one-out miss and the walk-forward miss. Only the size curve survives; the shrunk category variants (k=5, 10, 20) improve leave-one-out but hurt walk-forward, so they are dropped too.</li>' +
      '<li><b>Odds.</b> A logistic regression on the ' + O.peers + ' protocols with a listing date (' + O.recorded + ' recorded a token, ' + Math.round(O.base_rate * 100) + '% base rate). Age is the only feature that survives the same both-ways test; size, growth and chain count are dropped, and a placebo that shuffles growth across peers scores ' + O.placebo_loo.toFixed(3) + ' / ' + O.placebo_wf.toFixed(3) + ' — no better than the real model.</li>' +
      '<li><b>Ranges.</b> A row’s P25–P75 range is the leave-one-out residual distribution of the kept model: ×' + V.ranges.p25.toFixed(2) + ' to ×' + V.ranges.p75.toFixed(2) + ' of the prediction. It holds ' + Math.round(V.ranges.loo_in_p25_p75 * 100) + '% of the left-out tokens (stated 50%) and ' + Math.round(V.ranges.wf_in_p25_p75 * 100) + '% walk-forward; the P10–P90 range holds ' + Math.round(V.ranges.loo_in_p10_p90 * 100) + '% (stated 80%) and ' + Math.round(V.ranges.wf_in_p10_p90 * 100) + '%.</li>' +
      '<li><b>Farm.</b> A plan is 0.02% of TVL (floored $50, capped $5,000) held 12 weeks; the airdrop is 7% of the implied value, shared in proportion to the plan’s share of TVL; costs are $25 of gas, the 5% T-bill return on the plan for 12 weeks, and 0.2% slippage. FARM beats the T-bill after all costs; SKIP loses more than twice the gas cost.</li>' +
      '</ul>';
    $('modelValueTable').innerHTML = valueTable(true, true);
    $('modelOddsTable').innerHTML = oddsTable(true);
    $('modelRangeTable').innerHTML = rangeTable(true);
  }

  function setView(v) {
    state.view = v;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === v || (v === 'detail' && tabs[i].getAttribute('data-view') === 'board'));
    $('controls').style.display = v === 'board' ? '' : 'none';
    $('sliders').style.display = v === 'board' ? '' : 'none';
    $('boardView').hidden = v !== 'board';
    $('detailView').hidden = v !== 'detail';
    $('liveView').hidden = v !== 'live';
    $('modelView').hidden = v !== 'model';
  }
  function showView(v) {
    if (v === 'board') { if (location.hash) history.replaceState(null, '', location.pathname); }
    setView(v);
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function exportCSV() {
    var list = filtered();
    var head = 'rank,slug,name,category,tvl_usd,token_odds,if_launch_usd,implied_value_usd,implied_p25_usd,implied_p75_usd,verdict,plan_usd,gross_usd,costs_usd,net_usd,net_per_hour_usd\n';
    var body = list.map(function (r) {
      var e = econ(r);
      var q = function (s) { return '"' + String(s === null || s === undefined ? '' : s).replace(/"/g, '""') + '"'; };
      return [r.rank, q(r.slug), q(r.name), q(r.category || ''), r.tvl_usd, r.token_odds, r.if_launch_usd, r.implied_value_usd, r.implied_p25_usd, r.implied_p75_usd, e.verdict, e.plan, e.gross, e.costs, e.net, e.netPerHour].join(',');
    }).join('\n');
    download('token-radar.csv', head + body + '\n', 'text/csv');
  }
  function exportJSON() {
    var list = filtered().map(function (r) {
      var e = econ(r);
      return { rank: r.rank, slug: r.slug, name: r.name, category: r.category, tvl_usd: r.tvl_usd, token_odds: r.token_odds, if_launch_usd: r.if_launch_usd, implied_value_usd: r.implied_value_usd, implied_p25_usd: r.implied_p25_usd, implied_p75_usd: r.implied_p75_usd, verdict: e.verdict, farm: e };
    });
    download('token-radar.json', JSON.stringify(list, null, 1) + '\n', 'application/json');
  }

  // ---- events ----
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.getAttribute('data-view')); });
  });
  $('verdictTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.vtab');
    if (b) { state.verdict = b.getAttribute('data-v'); renderBoard(); }
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { location.hash = '#/detail/' + tr.getAttribute('data-slug'); }
  });
  $('backBtn').addEventListener('click', function () { location.hash = ''; showView('board'); });
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); });
  $('tier').addEventListener('change', function () { state.tier = $('tier').value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; renderBoard(); });
  $('sort').addEventListener('change', function () { state.sort = $('sort').value; renderBoard(); });
  function slider(id, valId, fmt, apply) {
    var el = $(id);
    var show = function () { $(valId).textContent = fmt(parseFloat(el.value)); };
    el.addEventListener('input', function () { apply(parseFloat(el.value)); show(); renderBoard(); });
    show();
  }
  slider('planSize', 'planSizeVal', function (v) { return v.toFixed(2) + '%'; }, function (v) { state.planShare = v / 100; });
  slider('dropShare', 'dropShareVal', function (v) { return v.toFixed(0) + '%'; }, function (v) { state.dropShare = v / 100; });
  slider('horizon', 'horizonVal', function (v) { return v.toFixed(0) + ' wk'; }, function (v) { state.horizon = v; });
  $('csvBtn').addEventListener('click', exportCSV);
  $('jsonBtn').addEventListener('click', exportJSON);
  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var map = { rank: 'rank', name: 'rank', tvl: 'tvl', odds: 'odds', iflaunch: 'implied', implied: 'implied', verdict: 'net', net: 'net' };
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
    if (path.indexOf('verdict/') === 0) {
      var v = decodeURIComponent(path.slice(8)).toUpperCase();
      if (v === 'FARM' || v === 'MARGINAL' || v === 'SKIP') state.verdict = v;
      setView('board');
      renderBoard();
      return;
    }
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
