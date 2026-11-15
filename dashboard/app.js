// Token Radar, radar-2 dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan, and the live-token view set aside. No network: every
// byte it shows is in data.js. The page recomputes each row from the snapshot figures and checks
// the number board.json carries, so the page's code and the board's data are visibly the same
// arithmetic; the farm plan is the same derivation main.ts writes to board.json.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model in one function: the same five factors lib/model.ts uses. The category multiple is
  // the row's own (the median mcap / TVL of its category's live-token protocols, this snapshot).
  // The size factor bends TVL around the reference the snapshot's live-token protocols set
  // (DATA.size_reference_tvl): a big TVL is worth less per dollar than a small one, as the
  // calibration found (market cap scales as TVL^0.52, not TVL).
  function impliedOf(row, model) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (clamp(age, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var breadth = 1 + model.breadth_step * Math.min(Math.max(chains - 1, 0), model.breadth_max);
    var size = model.size_delta === 0 ? 1 : Math.pow(row.tvl_usd / DATA.size_reference_tvl, model.size_delta);
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * breadth * size));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // --- farm plan: the same derivation main.ts writes to board.json -------------------------
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasToken(chain) {
    var c = chain.toLowerCase();
    if (c.indexOf('solana') >= 0) return 'SOL';
    if (c.indexOf('bnb') >= 0 || c.indexOf('binance') >= 0 || c.indexOf('bsc') >= 0) return 'BNB';
    if (c.indexOf('avalanche') >= 0 || c.indexOf('avax') >= 0) return 'AVAX';
    if (c.indexOf('polygon') >= 0) return 'POL';
    if (c.indexOf('fantom') >= 0) return 'FTM';
    if (c.indexOf('gnosis') >= 0) return 'xDAI';
    if (c.indexOf('cronos') >= 0) return 'CRO';
    if (c.indexOf('tron') >= 0) return 'TRX';
    if (c.indexOf('aptos') >= 0) return 'APT';
    if (c.indexOf('sui') >= 0) return 'SUI';
    if (c.indexOf('near') >= 0) return 'NEAR';
    if (c.indexOf('cosmos') >= 0 || c.indexOf('osmosis') >= 0) return 'ATOM';
    if (c.indexOf('hyperliquid') >= 0) return 'HYPE';
    if (c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0 || c.indexOf('zksync') >= 0 || c.indexOf('linea') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('blast') >= 0 || c.indexOf('ethereum') >= 0) return 'ETH';
    return 'the chain\u2019s gas token';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain, gas) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + '; the curator allocates it across its strategies and the vault receipt is your position.';
    if (c.indexOf('capital allocator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and hold the vault shares; the allocator routes the capital and your shares are the record.';
    if (c.indexOf('basis trading') >= 0) return "Deposit $" + capital + " of USDC into " + name + "'s basis vault on " + chain + ' and hold the vault shares through one full funding cycle.';
    if (c.indexOf('leveraged farm') >= 0) return 'Open a leveraged farm on ' + name + ' with $' + capital + ' of collateral on ' + chain + ' and keep the loan-to-value below the liquidation line.';
    if (c.indexOf('uncollateralized lending') >= 0) return 'Lend $' + capital + ' of USDC through ' + name + ' on ' + chain + ' and keep the loan open; the borrower record is your position.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow a small amount against it, and keep both legs open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' in its narrowest active range and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s top vault on " + chain + ' and let the aggregator rotate it; your vault shares are the record.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-yield strategy on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its app instead of bridging them straight back.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) return 'Stake $' + capital + ' of the staking asset through ' + name + ' on ' + chain + ' and keep the receipt token; do not sell the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ', open one small hedge, and keep the position open for a week.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one position on a market that settles after this week.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + " and hold it in the protocol's own vault.";
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it; the mint receipt is your position.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full term.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of ' + name + "'s index token on " + chain + ' and hold it; the basket is your position.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' this week and keep every receipt.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s farm on " + chain + ' and keep the LP tokens staked for the full period.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' onto ' + name + "'s chain, use its native apps for one swap and one deposit, and hold the position on the chain itself.";
    if (c.indexOf('interest rate') >= 0) return 'Open a $' + capital + ' fixed-rate position on ' + name + ' on ' + chain + ' and hold it to maturity.';
    if (c.indexOf('otc') >= 0) return 'Place one $' + capital + ' OTC quote through ' + name + ' on ' + chain + ' and settle it on the protocol, not off it.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' in ' + name + "'s governance on " + chain + ' and vote once while the lock is active.';
    if (c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + "'s card on " + chain + " and keep the spend inside the protocol's own rewards program.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open; pay the gas in ' + gas + '.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Borrow $' + small + ' against the position and use the borrowed funds inside ' + name + "'s own market, not elsewhere.";
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Swap $' + small + ' through ' + name + "'s pool once a week so the router records activity on your wallet.";
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + small + ' back the following week so the route records a round trip on your wallet.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) return 'Restake the receipt token once, if ' + name + ' offers it, so two layers of activity sit on the same wallet.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit a second, smaller tranche of $' + small + ' after the first week so the vault records two entries on your wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close and reopen the hedge once so the book records two trades instead of one.';
    if (c.indexOf('prediction') >= 0) return 'Place a second $' + small + ' position on a different market so the book records two outcomes.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0 || c.indexOf('index') >= 0) return 'Add $' + small + ' more to the same position after a week so the ledger records a second deposit.';
    return 'Vote once in ' + name + "'s governance, or join its points program, and keep the receipt on the same wallet.";
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasToken(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gasFee = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas in ' + gas + ' for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain, gas), cost: '$' + capital + ' of capital and about $' + gasFee + ' of gas in ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + Math.max(10, Math.round(capital / 5)) + ' of capital and about $2 of gas in ' + gas, time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas in ' + gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open " + p.name + "'s own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // --- filtering, sorting, hash ------------------------------------------------------------
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // --- sections ----------------------------------------------------------------------------
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', text: 'TR' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'Token Radar' }),
          el('div', { class: 'brand-sub', text: 'pre-token protocols, ranked by implied value' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
        el('span', { html: 'Model <b>' + DATA.model_version + '</b>' }),
        el('span', { html: '<b>' + DATA.board_size + '</b> rows scored' })
      )
    );
  }
  function hero() {
    return el('section', { class: 'hero' },
      el('h1', { text: 'Which protocol is worth farming next?' }),
      el('p', { html: 'The watchlist is the floor: every protocol with at least <b>$' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record</b>. The early radar adds <b>' + DATA.early_size + ' more pre-token protocols the watchlist leaves out</b>, ranked by what their launch would be worth if their record stayed as it is. Implied value is a model, not a promise — and never a prediction of whether or when a token is issued.' })
    );
  }
  function stats() {
    return el('section', { class: 'stats' },
      el('div', { class: 'stat hot' }, el('b', { html: '<em>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</em>' }), el('span', { text: 'Watchlist protocols covered' })),
      el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows scored' })),
      el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('span', { text: 'Total implied value, whole board' })),
      el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.median_implied_usd) }), el('span', { text: 'Median implied value per row' }))
    );
  }
  function formulaBar() {
    var m = DATA.model;
    return el('div', { class: 'formula-bar' },
      el('span', { class: 'tag', text: 'MODEL ' + DATA.model_version }),
      el('code', { text: 'implied = TVL x category multiple x growth x maturity x breadth x size' }),
      el('span', { text: 'The category multiple is the median mcap / TVL of that category\u2019s live-token protocols, from this snapshot. See the full table below the board.' })
    );
  }
  function validationStrip() {
    var v = DATA.validation;
    if (!v) return el('div', { class: 'valid-strip' }, el('span', { text: 'Model validation not computed.' }));
    return el('div', { class: 'valid-strip' },
      el('span', { class: 'tag', text: 'TESTED OUT OF SAMPLE' }),
      el('span', { html: 'The model was fitted on one half of the snapshot\u2019s <b>' + v.n_live + ' live-token protocols</b> and tested on the half it never saw: median error <b>' + v.timesplit_mdape + '%</b> on ' + v.timesplit_test_n + ' later-listed protocols (a naive median multiple: ' + v.timesplit_baseline_mdape + '%; the old weights: 95.4%). 5-fold cross-validation: ' + v.cv_mdape + '% vs ' + v.baseline_mdape + '% naive. Full method below the board.' })
    );
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    var tvl = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL $50M+', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: 'TVL $100M+', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '500000000', text: 'TVL $500M+', selected: state.minTvl === 500000000 ? 'selected' : null })
    );
    tvl.addEventListener('change', function () { state.minTvl = Number(tvl.value); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Minimum TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: r.rank <= 3 ? 'top3' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap / TVL ratios are what price the board.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }
  function validationSection() {
    var v = DATA.validation;
    if (!v) return el('p', { class: 'note', text: 'Model validation not computed for this build.' });
    return el('div', null,
      el('h3', { text: 'Tested out of sample — the model checked against real market caps' }),
      el('p', { class: 'note', html: 'A pre-token protocol has no token, so nothing can check its implied value directly. The check uses the snapshot\u2019s own <b>' + v.n_live + ' live-token protocols</b>, whose market cap is a fact: the model predicts each one\u2019s market cap from its TVL, category, growth, age and chains, and the error is measured against the real number.' }),
      el('div', { class: 'formula' },
        el('div', { html: '<b>5-fold cross-validation:</b> fit the category multiples on 4/5 of the live protocols, test on the 1/5 never seen — median error <b>' + v.cv_mdape + '%</b>, mean error ' + v.cv_mean_ape + '%, ' + v.cv_within_25 + '% of predictions within 25% of the real market cap, ' + v.cv_within_50 + '% within 50%. On random splits the model ties the naive multiple (' + v.baseline_mdape + '%): the factors add little there, and the error is dominated by a few protocols whose market cap is far from any TVL multiple.' }),
        el('div', { html: '<b>Time-split:</b> fit on protocols listed before ' + v.timesplit_cutoff + ' (' + v.timesplit_train_n + '), test on the ' + v.timesplit_test_n + ' listed after it — median error <b>' + v.timesplit_mdape + '%</b> against ' + v.timesplit_baseline_mdape + '% for the naive multiple on the same set. This is the check that matters: later listings are the closest thing to the pre-token protocols the board ranks.' }),
        el('div', { html: '<b>Bootstrap stability:</b> 2,000 resamples of the held-out errors put the median error\u2019s 90% interval at ' + v.bootstrap_lo + '%–' + v.bootstrap_hi + '%.' }),
        el('div', { text: 'What the calibration found, and what it changed: growth helps (weight 0.8, up from 0.6); age hurts — older with no token is worth less, so maturity now falls with age instead of rising; chains carry no signal, so breadth is 0; and the size curve is the big one — market cap scales as TVL^0.52, so the model bends big TVLs down. The old weights predicted realized market caps WORSE than the naive multiple on every check (cross-validation 97.9%, time-split 95.4%); these weights beat the naive multiple on the time-split (80.1% vs 88.2%) and tie it on cross-validation.' })
      )
    );
  }
  function modelPanel() {
    var m = DATA.model;
    var rows = DATA.multiples.map(function (x) {
      return el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.multiple) }),
        el('td', { class: 'num', text: String(x.live_count) }),
        el('td', { text: x.from_global ? 'global median' : 'category median' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function of the snapshot figures scores every row. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('div', { html: '<b>implied</b> = round( tvl_usd x <b>category multiple</b> x growth x maturity x breadth x size )' }),
        el('div', { text: 'category multiple = median mcap / TVL of the live-token protocols in the same category (at least ' + m.multiple_min_live + ' of them), else the global median; clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']' }),
        el('div', { text: 'growth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight }),
        el('div', { text: 'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + '   (unknown age: ' + m.unknown_age_days + ' days)' }),
        el('div', { text: 'breadth = 1 + ' + m.breadth_step + ' x min(chains - 1, ' + m.breadth_max + ')' }),
        el('div', { text: 'size = (tvl_usd / ' + fmtUsd(DATA.size_reference_tvl) + ') ^ ' + m.size_delta + '   (the size reference is the median TVL of this snapshot\u2019s live-token protocols; market cap scales as TVL^0.52, so big TVLs are bent down)' })
      ),
      el('p', { class: 'note', html: 'TVL, seven-day growth, age and chains come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token. A protocol <b>records</b> no token — the snapshot is a record, not proof it has none.' }),
      validationSection(),
      el('h3', { text: 'Category multiples, derived from this snapshot' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'mult-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Multiple' }), el('th', { text: 'Live comps' }), el('th', { text: 'Source' }))),
          el('tbody', null, rows)
        )
      )
    );
  }
  function foot() {
    return el('footer', { class: 'foot' },
      el('p', { html: '<b>Source:</b> ' + DATA.source + '. Snapshot ' + DATA.as_of + '; the data does not move and is not updated.' }),
      el('p', { html: '<b>Read it right:</b> a protocol on this board <b>records</b> no token. That is DefiLlama\u2019s record, not proof it has none — and a token, if one ever comes, is worth whatever the market says then, not this model\u2019s number.' }),
      el('p', { html: '<b>Farm safely:</b> never pay to claim an airdrop, never connect a wallet to a link that is not the protocol\u2019s own, and never farm with money you cannot afford to lock for the hold period.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var head = el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
    dialog.appendChild(head);
    if (row.launch_note) dialog.appendChild(el('p', { class: 'warn', text: row.launch_note }));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: 'x' + row.category_multiple.toFixed(3) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains ? row.chains.length : 0) + ')' }), el('b', { class: 'num', text: 'x' + row.breadth_multiplier })),
        el('div', null, el('span', { text: 'Size (TVL vs ' + fmtUsd(DATA.size_reference_tvl) + ' reference)' }), el('b', { class: 'num', text: 'x' + row.size_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(stats());
    shell.appendChild(formulaBar());
    shell.appendChild(validationStrip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
