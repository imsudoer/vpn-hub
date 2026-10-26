(function () {
  'use strict';

  var VpnApi = window.VpnApi;
  var Store = window.Store;
  var Sub = window.SubConstructor;
  var Qr = window.QrRenderer;

  var AUTO_REFRESH_MS = 120000;
  var nextAutoAt = Date.now() + AUTO_REFRESH_MS;
  var PROTOCOL_LABELS = {
    vless: 'VLESS',
    trojan: 'Trojan',
    hysteria2: 'Hysteria 2',
    ss: 'Shadowsocks',
    vmess: 'VMess',
    tuic: 'TUIC',
    socks5: 'SOCKS5',
    socks4: 'SOCKS4',
    http: 'HTTP',
    https: 'HTTPS',
  };
  var PROTOCOL_SHORT = {
    vless: 'VLESS',
    trojan: 'TROJAN',
    hysteria2: 'HY2',
    ss: 'SS',
    vmess: 'VMESS',
    tuic: 'TUIC',
    socks5: 'SOCKS5',
    socks4: 'SOCKS4',
    http: 'HTTP',
    https: 'HTTPS',
  };
  var VPN_PROTOCOLS = ['vless', 'trojan', 'hysteria2', 'ss', 'vmess', 'tuic'];

  function $(selector, ctx) { return (ctx || document).querySelector(selector); }
  function $$(selector, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(selector));
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }
  function icon(name) {
    return '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
  }
  function clockTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }
  function latencyTone(rtt) {
    if (rtt == null) return '';
    if (rtt < 150) return 'is-low';
    if (rtt < 350) return 'is-mid';
    return 'is-high';
  }

  var dom = {};
  function cacheDom() {
    dom = {
      statusLine: $('#statusLine'),
      lastUpdated: $('#lastUpdated'),
      refreshBtn: $('#refreshBtn'),
      formatGroup: $('#formatGroup'),
      formatHint: $('#formatHint'),
      protoChips: $('#protoChips'),
      countryChips: $('#countryChips'),
      countriesLabel: $('#countriesCount'),
      pingSlider: $('#pingSlider'),
      pingInput: $('#pingInput'),
      pingHistogram: $('#pingHistogram'),
      pingHistogramCaption: $('#pingHistogramCaption'),
      proxyChips: $('#proxyChips'),
      proxiesToggle: $('#proxiesToggle'),
      dpiChips: $('#dpiChips'),
      bypassToggle: $('#bypassToggle'),
      routeRow: $('#routeRow'),
      routeHint: $('#routeHint'),
      speedSlider: $('#speedSlider'),
      speedInput: $('#speedInput'),
      speedCaption: $('#speedCaption'),
      activeFilters: $('#activeFilters'),
      limitChips: $('#limitChips'),
      limitInput: $('#limitInput'),
      formatBadge: $('#formatBadge'),
      outputCount: $('#outputCount'),
      urlBox: $('.url-box'),
      urlField: $('#urlField'),
      copyUrlBtn: $('#copyUrlBtn'),
      copyLinkBtn: $('#copyLinkBtn'),
      qrToggleBtn: $('#qrToggleBtn'),
      qrToggleLabel: $('#qrToggleLabel'),
      openLinkBtn: $('#openLinkBtn'),
      qrPanel: $('#qrPanel'),
      qrFrame: $('#qrFrame'),
      qrSummary: $('#qrSummary'),
      qrCaption: $('#qrCaption'),
      qrDownloadBtn: $('#qrDownloadBtn'),
      searchInput: $('#searchInput'),
      searchClear: $('#searchClear'),
      searchField: $('#searchField'),
      explorerStats: $('#explorerStats'),
      tableWrap: $('#tableWrap'),
      nodesBody: $('#nodesBody'),
      tableFooter: $('#tableFooter'),
      tableFooterText: $('#tableFooterText'),
      loadingState: $('#loadingState'),
      errorState: $('#errorState'),
      errorText: $('#errorText'),
      retryBtn: $('#retryBtn'),
      emptyState: $('#emptyState'),
      emptyTitle: $('#emptyTitle'),
      clearFiltersBtn: $('#clearFiltersBtn'),
      snackbarHost: $('#snackbarHost'),
      appBar: $('.app-bar'),
      toTopFab: $('#toTopFab'),
      statNodes: $('#statNodes'),
      statCountries: $('#statCountries'),
      statAvg: $('#statAvg'),
      statBest: $('#statBest'),
      statApi: $('#statApi'),
      autoRefreshToggle: $('#autoRefreshToggle'),
      autoRefreshCount: $('#autoRefreshCount'),
      densityBtn: $('#densityBtn'),
      exportBtn: $('#exportBtn'),
      exportMenu: $('#exportMenu'),
      bulkBar: $('#bulkBar'),
      bulkCount: $('#bulkCount'),
      bulkCopyUris: $('#bulkCopyUris'),
      bulkCopyB64: $('#bulkCopyB64'),
      bulkDownload: $('#bulkDownload'),
      bulkClear: $('#bulkClear'),
      showMoreWrap: $('#showMoreWrap'),
      showMoreBtn: $('#showMoreBtn'),
      selectAllCb: $('#selectAllCb'),
      nodesTable: $('#nodesTable'),
      dialogScrim: $('#dialogScrim'),
      dialogQrFrame: $('#dialogQrFrame'),
      dialogUri: $('#dialogUri'),
      dialogMeta: $('#dialogMeta'),
      dialogCopyBtn: $('#dialogCopyBtn'),
      dialogCloseBtn: $('#dialogCloseBtn'),
    };
  }

  var snackTimer = null;
  function showSnackbar(message, iconName) {
    clearTimeout(snackTimer);
    dom.snackbarHost.innerHTML = '';

    var el = document.createElement('div');
    el.className = 'snackbar';
    el.setAttribute('role', 'status');
    el.innerHTML = icon(iconName || 'check') + '<span class="snackbar__text">' + esc(message) + '</span>';
    dom.snackbarHost.appendChild(el);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('is-visible'); });
    });

    snackTimer = setTimeout(function () {
      el.classList.remove('is-visible');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 3200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function flashCopied(button) {
    if (button.dataset.busy) return;
    button.dataset.busy = '1';
    var original = button.innerHTML;
    button.innerHTML = icon('check');
    button.classList.add('is-copied');
    setTimeout(function () {
      button.innerHTML = original;
      button.classList.remove('is-copied');
      delete button.dataset.busy;
    }, 1400);
  }

  function renderProtocolChips() {
    var stats = Store.getProtocolStats();
    var loaded = Store.state.nodes.length > 0;
    var selected = Store.state.filters.protocols;

    var html =
      '<button type="button" class="chip chip--filter' + (selected.length === 0 ? ' is-selected' : '') + '"' +
      ' data-proto="__all__" aria-pressed="' + (selected.length === 0 ? 'true' : 'false') + '">' +
      '<span class="chip__check" aria-hidden="true">' + icon('check') + '</span>' +
      '<span class="chip__label">All</span>' +
      '</button>';

    Sub.PROTOCOL_ORDER.filter(function (p) { return VPN_PROTOCOLS.indexOf(p) !== -1; }).forEach(function (proto) {
      var count = stats[proto] || 0;
      var isSel = selected.indexOf(proto) !== -1;
      var disabled = loaded && count === 0;
      html +=
        '<button type="button" class="chip chip--filter' + (isSel ? ' is-selected' : '') + '"' +
        ' data-proto="' + proto + '" aria-pressed="' + (isSel ? 'true' : 'false') + '"' +
        (disabled ? ' disabled title="Not present in the live dataset"' : '') + '>' +
        '<span class="chip__check" aria-hidden="true">' + icon('check') + '</span>' +
        '<span class="chip__label">' + PROTOCOL_LABELS[proto] + '</span>' +
        (loaded ? '<span class="chip__count">' + count + '</span>' : '') +
        '</button>';
    });

    dom.protoChips.innerHTML = html;
    renderProxyChips();
  }

  function renderProxyChips() {
    var stats = Store.getProtocolStats();
    var loaded = Store.state.nodes.length > 0;
    var selected = Store.state.filters.protocols;

    dom.proxyChips.innerHTML = Store.PROXY_PROTOCOLS.map(function (proto) {
      var count = stats[proto] || 0;
      var isSel = selected.indexOf(proto) !== -1;
      var disabled = loaded && count === 0;
      return (
        '<button type="button" class="chip chip--filter' + (isSel ? ' is-selected' : '') + '"' +
        ' data-proto="' + proto + '" aria-pressed="' + (isSel ? 'true' : 'false') + '"' +
        (disabled ? ' disabled title="Not present in the live dataset"' : '') + '>' +
        '<span class="chip__check" aria-hidden="true">' + icon('check') + '</span>' +
        '<span class="chip__label">' + PROTOCOL_LABELS[proto] + '</span>' +
        (loaded ? '<span class="chip__count">' + count + '</span>' : '') +
        '</button>'
      );
    }).join('');
  }

  function renderCountryChips() {
    var stats = Store.getCountryStats();
    var selected = Store.state.filters.countries;

    if (dom.countriesLabel) {
      dom.countriesLabel.textContent = stats.length
        ? stats.length + ' countries in the live set'
        : '';
    }

    if (!stats.length) {
      dom.countryChips.innerHTML =
        '<p class="chipset__empty">' +
        (Store.state.nodes.length ? 'No countries reported.' : 'Countries appear once the registry is loaded.') +
        '</p>';
      return;
    }

    var html = stats.map(function (c) {
      var isSel = selected.indexOf(c.code) !== -1;
      var tip = c.name + ' · ' + c.code.toUpperCase() + ' · ' + c.count + (c.count === 1 ? ' node' : ' nodes');
      return (
        '<button type="button" class="chip chip--filter chip--country' + (isSel ? ' is-selected' : '') + '"' +
        ' data-country="' + esc(c.code) + '" aria-pressed="' + (isSel ? 'true' : 'false') + '"' +
        ' aria-label="' + esc(tip) + '" title="' + esc(tip) + '">' +
        '<span class="chip__check" aria-hidden="true">' + icon('check') + '</span>' +
        '<span class="chip__flag" aria-hidden="true">' + esc(c.flag) + '</span>' +
        '<span class="chip__count">' + c.count + '</span>' +
        '</button>'
      );
    }).join('');

    var unknown = Store.getUnknownCountryCount();
    if (unknown > 0) {
      html +=
        '<span class="chip-note" title="Nodes whose exit country could not be resolved">' +
        '<span aria-hidden="true">\u{1F310}</span> ' + unknown + ' unrouted' +
        '</span>';
    }

    dom.countryChips.innerHTML = html;
  }

  function syncFormatButtons() {
    var fmt = Store.state.filters.format;
    $$('.segmented__btn', dom.formatGroup).forEach(function (btn) {
      var isSel = btn.dataset.format === fmt;
      btn.classList.toggle('is-selected', isSel);
      btn.setAttribute('aria-pressed', String(isSel));
    });
    var meta = null;
    for (var i = 0; i < Sub.FORMATS.length; i++) {
      if (Sub.FORMATS[i].id === fmt) meta = Sub.FORMATS[i];
    }
    if (meta && dom.formatHint) dom.formatHint.textContent = meta.hint;
    if (dom.formatBadge) {
      var path = (VpnApi.ENDPOINTS[fmt] || VpnApi.ENDPOINTS.base64).path;
      if (dom.formatBadge.textContent !== path) {
        dom.formatBadge.textContent = path;
        retrigger(dom.formatBadge, 'is-swap');
      }
    }
    requestAnimationFrame(positionGlider);
  }

  function positionGlider() {
    var glider = dom.formatGroup && dom.formatGroup.querySelector('.segmented__glider');
    var selected = dom.formatGroup && dom.formatGroup.querySelector('.segmented__btn.is-selected');
    if (!glider || !selected) return;
    glider.style.width = Math.max(0, selected.offsetWidth - 6) + 'px';
    glider.style.transform = 'translateX(' + (selected.offsetLeft + 3) + 'px)';
  }

  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  var DENSITY_STORAGE_KEY = 'vpnhub.density';

  function applyDensity(compact) {
    dom.nodesTable.classList.toggle('data-table--compact', compact);
    dom.densityBtn.setAttribute('aria-pressed', String(compact));
    dom.densityBtn.innerHTML = icon(compact ? 'rows-wide' : 'rows');
    dom.densityBtn.dataset.tip = compact ? 'Comfortable rows' : 'Compact rows';
    try { localStorage.setItem(DENSITY_STORAGE_KEY, compact ? '1' : '0'); } catch (e) {  }
  }

  function restoreDensityPref() {
    try {
      return localStorage.getItem(DENSITY_STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function syncPingControl() {
    var maxPing = Store.state.filters.maxPing;
    var isAny = maxPing >= Store.PING_MAX;

    dom.pingSlider.value = String(maxPing);
    var pct = ((maxPing - Number(dom.pingSlider.min)) / (Number(dom.pingSlider.max) - Number(dom.pingSlider.min))) * 100;
    dom.pingSlider.style.setProperty('--fill', pct.toFixed(2) + '%');
    dom.pingSlider.setAttribute('aria-valuetext', isAny ? 'Any latency' : maxPing + ' milliseconds');

    if (document.activeElement !== dom.pingInput) {
      dom.pingInput.value = isAny ? 'Any' : String(maxPing);
    }
    dom.pingInput.setAttribute('aria-label', 'Maximum ping in milliseconds - currently ' + (isAny ? 'any' : maxPing + ' ms'));
  }

  var HIST_BOUNDS = [75, 150, 250, 350, 500, 750, 1000, Infinity];

  function bucketTone(lo, hi) {
    if (hi !== Infinity && hi <= 150) return 'low';
    if (lo >= 350) return 'high';
    return 'mid';
  }

  function renderHistogram() {
    if (!dom.pingHistogram) return;
    var nodes = Store.getHistogramNodes();
    var total = nodes.length;

    if (!dom.pingHistogram.children.length) {
      dom.pingHistogram.innerHTML = HIST_BOUNDS.map(function (hi, i) {
        var lo = i === 0 ? 0 : HIST_BOUNDS[i - 1];
        return (
          '<span class="ping-histogram__seg tone-' + bucketTone(lo, hi) + '"' +
          ' data-lo="' + lo + '" data-hi="' + (hi === Infinity ? '' : hi) + '"' +
          ' style="width:0%;display:none"></span>'
        );
      }).join('');
    }

    var counts = new Array(HIST_BOUNDS.length).fill(0);
    nodes.forEach(function (n) {
      var r = n.rtt == null ? Infinity : n.rtt;
      for (var i = 0; i < HIST_BOUNDS.length; i++) {
        if (r < HIST_BOUNDS[i]) { counts[i]++; break; }
      }
    });

    var cutoff = Store.state.filters.maxPing;
    var isAny = cutoff >= Store.PING_MAX;
    var segs = dom.pingHistogram.children;
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s];
      var lo = Number(seg.dataset.lo);
      var hi = seg.dataset.hi === '' ? Infinity : Number(seg.dataset.hi);
      var count = counts[s];
      seg.style.display = count ? '' : 'none';
      seg.style.width = total ? (count / total * 100).toFixed(2) + '%' : '0%';
      seg.classList.toggle('is-dim', !isAny && lo >= cutoff);
      seg.title = (hi === Infinity ? lo + '+ ms' : lo + '\u2013' + hi + ' ms') +
        ' \u00b7 ' + count + (count === 1 ? ' node' : ' nodes');
    }

    if (!total) {
      dom.pingHistogramCaption.textContent = '';
    } else if (isAny) {
      dom.pingHistogramCaption.textContent = total + ' nodes in view \u00b7 no ping limit';
    } else {
      var passing = nodes.filter(function (n) { return n.rtt != null && n.rtt <= cutoff; }).length;
      dom.pingHistogramCaption.textContent = passing + ' of ' + total + ' nodes within ' + cutoff + ' ms';
    }
  }

  function renderActiveFilters() {
    var f = Store.state.filters;
    var countryInfo = {};
    Store.getCountryStats().forEach(function (c) { countryInfo[c.code] = c; });

    var items = [];
    f.protocols.forEach(function (p) {
      items.push(
        '<button type="button" class="achip" data-af="proto:' + esc(p) + '" title="Remove protocol filter">' +
        esc(PROTOCOL_LABELS[p] || p) + icon('close') + '</button>'
      );
    });
    f.countries.forEach(function (code) {
      var info = countryInfo[code];
      items.push(
        '<button type="button" class="achip" data-af="country:' + esc(code) + '" title="Remove country filter">' +
        '<span class="achip__flag" aria-hidden="true">' + esc(info ? info.flag : VpnApi.flagFromCode(code)) + '</span>' +
        esc(info ? info.name : code.toUpperCase()) + icon('close') + '</button>'
      );
    });
    if (f.maxPing < Store.PING_MAX) {
      items.push(
        '<button type="button" class="achip" data-af="ping" title="Remove ping limit">' +
        '\u2264 ' + f.maxPing + ' ms' + icon('close') + '</button>'
      );
    }
    if (f.minSpeed > 0) {
      items.push(
        '<button type="button" class="achip" data-af="speed" title="Remove speed floor">' +
        '\u2265 ' + f.minSpeed + ' Mbps' + icon('close') + '</button>'
      );
    }
    if (f.dpi) {
      items.push(
        '<button type="button" class="achip" data-af="dpi" title="Remove DPI filter">' +
        (f.dpi === 'reality' ? 'Reality only' : 'Max protection') + icon('close') + '</button>'
      );
    }
    if (f.proxies) {
      items.push(
        '<button type="button" class="achip" data-af="proxies" title="Exclude open proxies">' +
        'Proxies on' + icon('close') + '</button>'
      );
    }
    if (f.bypassRu && Sub.ROUTED_FORMATS.indexOf(f.format) !== -1) {
      items.push(
        '<button type="button" class="achip" data-af="bypass" title="Disable RU split-tunneling">' +
        'RU bypass' + icon('close') + '</button>'
      );
    }
    if (f.limit > 0) {
      items.push(
        '<button type="button" class="achip" data-af="limit" title="Remove node limit">' +
        'First ' + f.limit + icon('close') + '</button>'
      );
    } else if (f.limit === -1) {
      items.push(
        '<button type="button" class="achip" data-af="limit" title="Back to the backend default cap">' +
        'No limit' + icon('close') + '</button>'
      );
    }
    if (f.search.trim()) {
      items.push(
        '<button type="button" class="achip" data-af="search" title="Clear search">' +
        '\u201c' + esc(f.search.trim()) + '\u201d' + icon('close') + '</button>'
      );
    }

    if (!items.length) {
      dom.activeFilters.hidden = true;
      dom.activeFilters.innerHTML = '';
      return;
    }
    dom.activeFilters.hidden = false;
    dom.activeFilters.innerHTML =
      '<span class="active-filters__label">Active:</span>' + items.join('') +
      '<button type="button" class="btn btn--text" data-af="all">Clear all</button>';
  }

  function syncLimitControls() {
    var limit = Store.state.filters.limit;
    $$('[data-limit]', dom.limitChips).forEach(function (chip) {
      var isSel = Number(chip.dataset.limit) === limit;
      chip.classList.toggle('is-selected', isSel);
      chip.setAttribute('aria-pressed', String(isSel));
    });
    if (document.activeElement !== dom.limitInput) {
      dom.limitInput.value = limit > 0 ? String(limit) : (limit === -1 ? 'all' : '');
    }
  }

  function syncSearchField() {
    var value = Store.state.filters.search;
    if (document.activeElement !== dom.searchInput && dom.searchInput.value !== value) {
      dom.searchInput.value = value;
    }
    dom.searchField.classList.toggle('has-value', Boolean(dom.searchInput.value));
  }

  function syncSortIndicators() {
    var f = Store.state.filters;
    $$('[data-sort]').forEach(function (btn) {
      var th = btn.closest('th');
      if (!th) return;
      var active = btn.dataset.sort === f.sortKey;
      th.setAttribute('aria-sort', active ? (f.sortDir === 'desc' ? 'descending' : 'ascending') : 'none');
      btn.classList.toggle('is-sorted', active);
    });
  }

  function syncChipSelection() {
    var selP = Store.state.filters.protocols;
    $$('[data-proto]', dom.protoChips).concat($$('[data-proto]', dom.proxyChips)).forEach(function (chip) {
      var proto = chip.dataset.proto;
      var isSel = proto === '__all__' ? selP.length === 0 : selP.indexOf(proto) !== -1;
      chip.classList.toggle('is-selected', isSel);
      chip.setAttribute('aria-pressed', String(isSel));
    });

    var selC = Store.state.filters.countries;
    $$('[data-country]', dom.countryChips).forEach(function (chip) {
      var isSel = selC.indexOf(chip.dataset.country) !== -1;
      chip.classList.toggle('is-selected', isSel);
      chip.setAttribute('aria-pressed', String(isSel));
    });

    var dpi = Store.state.filters.dpi;
    $$('[data-dpi]', dom.dpiChips).forEach(function (chip) {
      var isSel = chip.dataset.dpi === dpi;
      chip.classList.toggle('is-selected', isSel);
      chip.setAttribute('aria-pressed', String(isSel));
    });
  }

  function syncExtraControls() {
    var f = Store.state.filters;

    dom.proxiesToggle.checked = f.proxies;

    var routed = Sub.ROUTED_FORMATS.indexOf(f.format) !== -1;
    dom.bypassToggle.checked = f.bypassRu;
    dom.routeRow.classList.toggle('is-disabled', !routed);
    dom.routeHint.textContent = routed
      ? 'Active: Russian destinations bypass the tunnel (route=bypass_ru)'
      : 'Adds route=bypass_ru - available for Sing-box and Clash formats';

    var isOff = f.minSpeed <= 0;
    dom.speedSlider.value = String(isOff ? 0 : f.minSpeed);
    var pct = (Number(dom.speedSlider.value) / Number(dom.speedSlider.max)) * 100;
    dom.speedSlider.style.setProperty('--fill', pct.toFixed(2) + '%');
    dom.speedSlider.setAttribute('aria-valuetext', isOff ? 'No minimum speed' : f.minSpeed + ' Mbps');
    if (document.activeElement !== dom.speedInput) {
      dom.speedInput.value = isOff ? 'Any' : String(f.minSpeed);
    }
    var withSpeed = Store.getPreviewNodes().filter(function (n) { return n.speed != null; }).length;
    dom.speedCaption.textContent = withSpeed
      ? (isOff ? withSpeed + ' nodes report measured speed' : '')
      : 'The registry has no speed measurements yet';
  }

  function syncControls() {
    syncFormatButtons();
    syncChipSelection();
    syncPingControl();
    syncExtraControls();
    syncLimitControls();
    syncSearchField();
    syncSortIndicators();
  }

  function summarizeSelection(visibleCount) {
    var f = Store.state.filters;
    var parts = [];
    parts.push(visibleCount + (visibleCount === 1 ? ' node' : ' nodes'));
    parts.push(f.protocols.length ? f.protocols.map(function (p) { return PROTOCOL_LABELS[p] || p; }).join(' + ') : 'all protocols');
    parts.push(f.countries.length ? f.countries.length + (f.countries.length === 1 ? ' country' : ' countries') : 'all countries');
    parts.push('ping ' + (f.maxPing >= Store.PING_MAX ? 'unlimited' : '\u2264 ' + f.maxPing + ' ms'));
    if (f.minSpeed > 0) parts.push('\u2265 ' + f.minSpeed + ' Mbps');
    if (f.dpi) parts.push(f.dpi === 'reality' ? 'Reality only' : 'max DPI protection');
    if (f.proxies) parts.push('proxies on');
    if (f.bypassRu && Sub.ROUTED_FORMATS.indexOf(f.format) !== -1) parts.push('RU bypass');
    if (f.limit > 0) parts.push('capped at ' + f.limit);
    else if (f.limit === -1) parts.push('no limit');
    return parts.join(' \u00b7 ');
  }

  function renderQr(url) {
    try {
      var svg = Qr.toSvg(url, {
        ecl: 'M',
        border: 4,
        dark: '#191c1e',
        light: '#f7f8fa',
        title: 'QR code of the generated subscription URL',
      });
      dom.qrFrame.innerHTML = svg;
      var svgEl = dom.qrFrame.firstElementChild;
      if (svgEl) {
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
      }
      dom.qrFrame.classList.remove('has-error');
      var info = Qr._getLastRender && Qr._getLastRender();
      if (info && dom.qrCaption) {
        dom.qrCaption.textContent =
          'QR version ' + info.version + ' \u00b7 mask ' + info.mask + ' \u00b7 ECC M \u00b7 ' +
          info.size + '\u00d7' + info.size + ' modules';
      }
    } catch (err) {
      dom.qrFrame.classList.add('has-error');
      dom.qrFrame.innerHTML = '<p class="qr-frame__error">QR generation failed: ' + esc(err.message) + '</p>';
    }
  }

  var renderQrDebounced = debounce(function (url) {
    if (Store.state.ui.qrOpen) renderQr(url);
  }, 120);

  var lastRenderedUrl = null;

  function renderOutput() {
    var url = Sub.buildSubscriptionUrl(Store.state.filters);

    if (lastRenderedUrl !== null && lastRenderedUrl !== url && dom.urlBox) {
      retrigger(dom.urlBox, 'is-flash');
    }
    lastRenderedUrl = url;

    dom.urlField.value = url;
    dom.openLinkBtn.href = url;

    var visibleCount = Store.getVisibleNodes().length;
    dom.outputCount.textContent = visibleCount + (visibleCount === 1 ? ' node' : ' nodes');
    dom.qrSummary.textContent = summarizeSelection(visibleCount);

    if (Store.state.ui.qrOpen) renderQrDebounced(url);
  }

  function downloadQrSvg() {
    var svgEl = dom.qrFrame.querySelector('svg');
    if (!svgEl) {
      showSnackbar('Nothing to download yet', 'error');
      return;
    }
    var clone = svgEl.cloneNode(true);
    clone.setAttribute('width', '512');
    clone.setAttribute('height', '512');
    var source = new XMLSerializer().serializeToString(clone);
    var blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + source], { type: 'image/svg+xml;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'vpn-subscription-qr.svg';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 400);
    showSnackbar('QR code saved as SVG', 'check');
  }

  var renderedRows = [];
  var lastRowsHtml = '';
  var lastStatusSig = '';
  var PAGE_SIZE = 60;
  var shownCount = PAGE_SIZE;
  var expandedUri = null;
  var selection = new Set();
  var dialogNode = null;

  function showOnly(panel) {
    dom.tableWrap.hidden = panel !== 'table';
    dom.loadingState.hidden = panel !== 'loading';
    dom.errorState.hidden = panel !== 'error';
    dom.emptyState.hidden = panel !== 'empty';
    dom.tableFooter.hidden = panel !== 'table';
  }

  function errorMessage(err) {
    if (!err) return 'Something went wrong while contacting the node registry.';
    switch (err.kind) {
      case 'timeout':
        return 'The registry at free.vpn.onlysq.me took too long to respond. It may be under heavy load - try again in a moment.';
      case 'http':
        return 'The registry returned an error (HTTP ' + (err.status || '?') + '). Try again shortly.';
      case 'parse':
      case 'empty':
        return 'The registry responded, but its payload was not usable. The service may be mid-update - try again shortly.';
      default:
        return 'Could not reach free.vpn.onlysq.me. Check your internet connection (or an active proxy) and retry.';
    }
  }

  function renderTable(animMode) {
    var st = Store.state;

    if (st.status === 'error' && !st.nodes.length) {
      dom.errorText.textContent = errorMessage(st.error);
      dom.explorerStats.textContent = 'Registry unavailable';
      showOnly('error');
      return;
    }
    if ((st.status === 'loading' || st.status === 'idle') && !st.nodes.length) {
      dom.explorerStats.textContent = 'Fetching live registry…';
      showOnly('loading');
      return;
    }

    var matching = Store.getMatchingNodes();
    var visible = Store.getVisibleNodes();
    renderedRows = visible;

    var baseTotal = Store.getPreviewNodes().length;
    var avg = matching.length
      ? Math.round(matching.reduce(function (sum, n) { return sum + (n.rtt || 0); }, 0) / matching.length)
      : 0;
    var statsText = matching.length + ' of ' + baseTotal + ' nodes match';
    if (visible.length && visible.length < matching.length) {
      statsText = 'Showing ' + visible.length + ' of ' + matching.length + ' matching nodes (' + baseTotal + ' total)';
    }
    dom.explorerStats.textContent = matching.length ? statsText + ' \u00b7 avg ping ' + avg + ' ms' : '0 of ' + baseTotal + ' nodes match';

    if (!visible.length) {
      var hasSearch = Boolean(st.filters.search.trim());
      dom.emptyTitle.textContent = hasSearch ? 'No nodes match your search' : 'No nodes match your filters';
      showOnly('empty');
      return;
    }

    showOnly('table');
    var slice = visible.slice(0, shownCount);
    var rowsHtml = slice.map(function (n, i) {
      var tone = latencyTone(n.rtt);
      var barPct = n.rtt == null ? 0 : Math.max(3, Math.min(100, Math.round(n.rtt / 10)));
      var countryName = n.country || '';
      var cc = n.countryCode ? n.countryCode.toUpperCase() : '';
      var tip = countryName ? esc(countryName + (cc ? ' \u00b7 ' + cc : '')) : 'Country not resolved';
      var a11y = countryName ? esc(countryName + (cc ? ' (' + cc + ')' : '')) : 'Unknown location';
      var protoShort = PROTOCOL_SHORT[n.proto] || esc(n.proto);
      var uriKey = esc(n.uri);
      var isSel = selection.has(n.uri);
      var isExp = expandedUri === n.uri;

      var row =
        '<tr style="--d:' + (Math.min(i, 24) * 14) + 'ms" data-row-uri="' + uriKey + '"' +
        ' class="is-selectable' + (isSel ? ' is-selected' : '') + (isExp ? ' is-expanded' : '') + '">' +
        '<td data-label="Country">' +
          '<label class="checkbox" title="Select node">' +
            '<input type="checkbox" data-select-uri="' + uriKey + '"' + (isSel ? ' checked' : '') +
              ' aria-label="Select node ' + a11y + '">' +
            '<span class="checkbox__box" aria-hidden="true">' +
              '<svg class="icon checkbox__check"><use href="#i-check"></use></svg>' +
              '<svg class="icon checkbox__dash"><use href="#i-dash"></use></svg>' +
            '</span>' +
          '</label>' +
          '<span class="flag-cell" data-tip="' + tip + '" tabindex="0" role="img" aria-label="' + a11y + '">' +
            '<span class="flag-cell__glyph" aria-hidden="true">' + esc(n.flag) + '</span>' +
          '</span>' +
        '</td>' +
        '<td data-label="Protocol">' +
          '<span class="badge badge--' + esc(n.proto) + '">' + protoShort + '</span>' +
          (n.isProxy ? '<span class="badge badge--proxytag">PROXY</span>' : '') +
          (n.isReality ? '<span class="badge badge--reality">REALITY</span>'
            : (n.dpi === 'high' ? '<span class="badge badge--dpi">DPI SAFE</span>' : '')) +
        '</td>' +
        '<td data-label="Ping">' +
          '<span class="ping ' + tone + '">' +
            '<span class="ping__value">' + (n.rtt == null ? '-' : n.rtt) + '<span class="ping__unit"> ms</span></span>' +
            '<span class="ping__bar" aria-hidden="true"><span class="ping__fill" style="width:' + barPct + '%"></span></span>' +
          '</span>' +
        '</td>' +
        '<td data-label="Speed">' +
          (n.speed == null
            ? '<span class="speed speed--none">\u2014</span>'
            : '<span class="speed" title="Measured download speed through the tunnel">' +
              icon('bolt') +
              '<span class="speed__value">' + n.speed + '</span>' +
              '<span class="speed__unit">Mbps</span></span>') +
        '</td>' +
        '<td data-label="Server"><span class="cell-host">' + esc(n.server || '-') +
          (n.port ? '<span class="cell-port">:' + n.port + '</span>' : '') + '</span></td>' +
        '<td data-label="Exit IP"><span class="cell-mono">' + esc(n.exitIp || '-') + '</span></td>' +
        '<td class="cell-actions" data-label="Actions">' +
          '<button type="button" class="icon-button icon-button--small expand-chev-btn" data-expand-uri="' + uriKey + '"' +
          ' aria-label="Toggle node details" aria-expanded="' + isExp + '" data-tip="Details">' +
          '<svg class="icon expand-chev" aria-hidden="true"><use href="#i-expand"></use></svg></button>' +
          '<button type="button" class="icon-button icon-button--small" data-qr-uri="' + i + '"' +
          ' aria-label="Show node QR code" data-tip="Node QR">' + icon('qr') + '</button>' +
          '<button type="button" class="icon-button icon-button--small" data-copy-node="' + i + '"' +
          ' aria-label="Copy node URI" data-tip="Copy node URI">' + icon('copy') + '</button>' +
        '</td>' +
        '</tr>';

      return row + (isExp ? detailRowHtml(n, i) : '');
    }).join('');

    var remaining = visible.length - slice.length;
    if (remaining > 0) {
      dom.showMoreWrap.hidden = false;
      dom.showMoreBtn.textContent =
        'Show ' + Math.min(PAGE_SIZE, remaining) + ' more \u00b7 ' + remaining + ' remaining';
    } else {
      dom.showMoreWrap.hidden = true;
    }
    updateSelectAllState(visible);

    if (animMode !== 'keep' || rowsHtml !== lastRowsHtml) {
      dom.nodesBody.innerHTML = rowsHtml;
      lastRowsHtml = rowsHtml;
    }
    if (animMode !== 'keep') {
      dom.nodesBody.className =
        animMode === 'stagger' ? 'anim-stagger' : animMode === 'fade' ? 'anim-fade' : '';
    }

    var f = st.filters;
    var sortLabel = { rtt: 'ping', country: 'country', proto: 'protocol', server: 'server', exitIp: 'exit IP', speed: 'speed' }[f.sortKey] || 'ping';
    dom.tableFooterText.textContent =
      visible.length + ' row' + (visible.length === 1 ? '' : 's') +
      ' \u00b7 sorted by ' + sortLabel + (f.sortDir === 'desc' ? ' (highest first)' : ' (lowest first)');
  }

  function metaHtml(label, value) {
    return (
      '<div><span class="row-detail__label">' + esc(label) + '</span>' +
      '<span class="row-detail__value">' + esc(value) + '</span></div>'
    );
  }

  function detailRowHtml(n, idx) {
    return (
      '<tr class="row-detail"><td colspan="7"><div class="row-detail__inner">' +
        '<div class="row-detail__grid">' +
          metaHtml('Tag', n.tag) +
          metaHtml('Server', (n.server || '\u2014') + (n.port ? ':' + n.port : '')) +
          metaHtml('Exit IP', n.exitIp || '\u2014') +
          metaHtml('Ping', n.rtt == null ? '\u2014' : n.rtt + ' ms') +
          metaHtml('Speed', n.speed == null ? 'not measured' : n.speed + ' Mbps') +
          metaHtml('DPI', n.isReality ? 'Reality (XTLS)' : (n.dpi || 'standard')) +
        '</div>' +
        '<div class="row-detail__uri"><code>' + esc(n.uri) + '</code>' +
          '<button type="button" class="icon-button icon-button--small" data-copy-text="' + esc(n.uri) + '"' +
          ' aria-label="Copy node URI" data-tip="Copy URI">' + icon('copy') + '</button>' +
        '</div>' +
        '<div class="row-detail__actions">' +
          '<button type="button" class="btn btn--tonal" data-qr-uri="' + idx + '">' +
            icon('qr') + '<span>Show QR code</span>' +
          '</button>' +
        '</div>' +
      '</div></td></tr>'
    );
  }

  function updateSelectAllState(visible) {
    if (!dom.selectAllCb) return;
    var list = visible || Store.getVisibleNodes();
    var inView = 0;
    for (var i = 0; i < list.length; i++) {
      if (selection.has(list[i].uri)) inView++;
    }
    dom.selectAllCb.checked = list.length > 0 && inView === list.length;
    dom.selectAllCb.indeterminate = inView > 0 && inView < list.length;
  }

  function updateBulkBar() {
    var n = selection.size;
    dom.bulkBar.hidden = n === 0;
    dom.bulkCount.textContent = n + ' selected';
  }

  function toggleExpand(uri) {
    expandedUri = expandedUri === uri ? null : uri;
    renderTable('none');
  }

  function orderedSelected() {
    var inView = Store.getVisibleNodes().filter(function (n) { return selection.has(n.uri); });
    if (inView.length === selection.size) return inView;
    var seen = {};
    inView.forEach(function (n) { seen[n.uri] = 1; });
    var rest = Store.state.nodes.filter(function (n) {
      return selection.has(n.uri) && !seen[n.uri];
    });
    return inView.concat(rest);
  }

  function utf8Base64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function downloadBlob(content, type, filename) {
    var blob = new Blob([content], { type: type });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 400);
  }

  function exportJson(rows) {
    return JSON.stringify(rows.map(function (n) {
      return {
        tag: n.tag, proto: n.proto, country: n.country, country_code: n.countryCode,
        rtt: n.rtt, speed_mbps: n.speed || 0, is_proxy: !!n.isProxy,
        is_reality: !!n.isReality, dpi_resilience: n.dpi || 'standard',
        server: n.server, server_port: n.port, exit_ip: n.exitIp, uri: n.uri,
      };
    }), null, 2);
  }

  function exportCsv(rows) {
    var quote = function (v) {
      v = String(v == null ? '' : v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var head = 'tag,proto,country,country_code,rtt,speed_mbps,is_proxy,is_reality,dpi_resilience,server,server_port,exit_ip,uri';
    return head + '\n' + rows.map(function (n) {
      return [n.tag, n.proto, n.country, n.countryCode, n.rtt, n.speed || 0, n.isProxy ? 1 : 0,
        n.isReality ? 1 : 0, n.dpi || 'standard', n.server, n.port, n.exitIp, n.uri]
        .map(quote).join(',');
    }).join('\n');
  }

  function openNodeDialog(idx) {
    var n = renderedRows[idx];
    if (!n) return;
    dialogNode = n;
    try {
      dom.dialogQrFrame.innerHTML = Qr.toSvg(n.uri, {
        ecl: 'M', border: 4, dark: '#191c1e', light: '#f7f8fa', title: 'QR code of the node URI',
      });
      var svgEl = dom.dialogQrFrame.firstElementChild;
      if (svgEl) { svgEl.removeAttribute('width'); svgEl.removeAttribute('height'); }
    } catch (err) {
      dom.dialogQrFrame.innerHTML = '<p class="qr-frame__error">QR generation failed: ' + esc(err.message) + '</p>';
    }
    dom.dialogMeta.textContent =
      n.flag + ' ' + (n.country || 'Unknown location') + ' \u00b7 ' +
      (PROTOCOL_LABELS[n.proto] || n.proto) + ' \u00b7 ' + (n.rtt == null ? '\u2014' : n.rtt + ' ms') +
      (n.speed != null ? ' \u00b7 ' + n.speed + ' Mbps' : '') +
      (n.isReality ? ' \u00b7 Reality' : '');
    dom.dialogUri.textContent = n.uri;
    dom.dialogScrim.hidden = false;
    requestAnimationFrame(function () { dom.dialogScrim.classList.add('is-open'); });
    dom.dialogCloseBtn.focus();
  }

  function closeNodeDialog() {
    dom.dialogScrim.classList.remove('is-open');
    setTimeout(function () { dom.dialogScrim.hidden = true; }, 220);
    dialogNode = null;
  }

  function fmtCountdown(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function renderStatusLine() {
    var st = Store.state;
    var busy = st.status === 'loading' || st.refreshing;

    if (st.status === 'error' && !st.nodes.length) {
      dom.statusLine.textContent = 'Registry unreachable';
    } else if ((st.status === 'loading' || st.status === 'idle') && !st.nodes.length) {
      dom.statusLine.textContent = 'Connecting to the node registry…';
    } else {
      var preview = Store.getPreviewNodes();
      var baseCount = preview.length;
      var countries = Store.getCountryStats().length;
      var protoSet = {};
      preview.forEach(function (n) { protoSet[n.proto] = 1; });
      dom.statusLine.textContent = baseCount + ' live nodes \u00b7 ' + countries + ' countries \u00b7 ' + Object.keys(protoSet).length + ' protocols';
    }

    if (st.nodes.length) {
      var rtts = [];
      for (var i = 0; i < preview.length; i++) {
        if (preview[i].rtt != null) rtts.push(preview[i].rtt);
      }
      var avg = rtts.length ? Math.round(rtts.reduce(function (a, b) { return a + b; }, 0) / rtts.length) : null;
      var best = rtts.length ? Math.min.apply(null, rtts) : null;
      dom.statNodes.textContent = String(preview.length);
      dom.statCountries.textContent = String(Store.getCountryStats().length);
      dom.statAvg.textContent = avg == null ? '\u2014' : avg + ' ms';
      dom.statBest.textContent = best == null ? '\u2014' : best + ' ms';
      dom.statApi.textContent = st.lastFetchMs == null ? '\u2014'
        : (st.lastFetchMs < 1000 ? st.lastFetchMs + ' ms' : (st.lastFetchMs / 1000).toFixed(1) + ' s');
    } else {
      dom.statNodes.textContent = '\u2014';
      dom.statCountries.textContent = '\u2014';
      dom.statAvg.textContent = '\u2014';
      dom.statBest.textContent = '\u2014';
      dom.statApi.textContent = '\u2014';
    }

    dom.lastUpdated.textContent = st.lastUpdated ? 'Updated ' + clockTime(st.lastUpdated) : '';
    dom.refreshBtn.classList.toggle('is-busy', busy);
    dom.refreshBtn.setAttribute('aria-label', busy ? 'Refreshing nodes…' : 'Refresh nodes');
  }

  var applyingHash = false;

  function pushHash() {
    var hash = Sub.filtersToHash(Store.state.filters);
    if (window.location.hash === hash) return;
    applyingHash = true;
    try {
      var target = hash || window.location.pathname + window.location.search;
      history.replaceState(null, '', target);
    } catch (e) {
      console.warn('[app] hash sync unavailable:', e.message);
    }
    applyingHash = false;
  }

  function applyHashFromLocation() {
    if (applyingHash) return;
    var patch = Sub.filtersFromHash(window.location.hash);
    if (!patch) return;
    Store.setFilters(patch);
  }

  var loadInFlight = false;

  function loadNodes(options) {
    var opts = options || {};
    if (loadInFlight) return Promise.resolve();
    loadInFlight = true;
    var hadNodes = Store.state.nodes.length > 0;
    Store.beginLoad(opts.silent);

    return VpnApi.fetchNodes()
      .then(function (result) {
        Store.setNodes(result.nodes, result.fetchedAt, result.total, result.durationMs);
        nextAutoAt = Date.now() + AUTO_REFRESH_MS;
        if (!opts.silent && hadNodes) {
          showSnackbar('Registry refreshed \u00b7 ' + result.nodes.length + ' live nodes', 'check');
        }
      })
      .catch(function (err) {
        if (opts.silent && Store.state.nodes.length) {
          Store.endRefresh();
          showSnackbar('Auto-refresh failed - showing previous data', 'error');
        } else {
          Store.setError(err);
        }
      })
      .then(function () { loadInFlight = false; });
  }

  function pruneFiltersToData() {
    var f = Store.state.filters;
    if (!f.protocols.length && !f.countries.length) return;
    var protoStats = Store.getProtocolStats();
    var countryCodes = {};
    Store.getCountryStats().forEach(function (c) { countryCodes[c.code] = true; });

    var protos = f.protocols.filter(function (p) { return protoStats[p]; });
    var countries = f.countries.filter(function (c) { return countryCodes[c]; });

    if (protos.length !== f.protocols.length || countries.length !== f.countries.length) {
      Store.setFilters({ protocols: protos, countries: countries });
    }
  }

  function onFiltersChanged(detail) {
    syncControls();
    var keys = Object.keys(detail || {});
    var silentForRows = keys.length === 1 && (keys[0] === 'search' || keys[0] === 'format');
    shownCount = PAGE_SIZE;
    renderTable(silentForRows ? 'none' : 'fade');
    renderHistogram();
    renderActiveFilters();
    renderOutput();
    renderStatusLine();
    pushHash();
    if (detail && detail.format) saveFormatPref(Store.state.filters.format);
  }

  function onNodesChanged() {
    pruneFiltersToData();

    var alive = {};
    Store.state.nodes.forEach(function (n) { alive[n.uri] = true; });
    selection.forEach(function (uri) { if (!alive[uri]) selection.delete(uri); });
    updateBulkBar();
    shownCount = PAGE_SIZE;
    renderProtocolChips();
    renderCountryChips();
    renderTable('stagger');
    renderHistogram();
    renderActiveFilters();
    renderOutput();
  }

  function onStatusChanged() {
    renderStatusLine();
    var st = Store.state;
    var sig = st.status + '|' + st.nodes.length + '|' + (st.error ? st.error.kind : '');
    if (sig !== lastStatusSig) {
      lastStatusSig = sig;
      renderTable('keep');
    }
  }

  function onUiChanged() {
    var open = Store.state.ui.qrOpen;
    dom.qrPanel.hidden = !open;
    dom.qrToggleBtn.setAttribute('aria-expanded', String(open));
    dom.qrToggleBtn.classList.toggle('is-active', open);
    dom.qrToggleLabel.textContent = open ? 'Hide QR code' : 'QR code';
    if (open) {
      renderQr(dom.urlField.value);
      dom.qrPanel.classList.remove('is-open');
      void dom.qrPanel.offsetWidth; 
      dom.qrPanel.classList.add('is-open');
    }
  }

  var FORMAT_STORAGE_KEY = 'vpnhub.format';

  function saveFormatPref(fmt) {
    try { localStorage.setItem(FORMAT_STORAGE_KEY, fmt); } catch (e) {  }
  }

  function restoreFormatPref() {
    try {
      var saved = localStorage.getItem(FORMAT_STORAGE_KEY);
      if (saved && Store.KNOWN_FORMATS.indexOf(saved) !== -1) Store.setFilters({ format: saved });
    } catch (e) {  }
  }

  function onScroll() {
    var y = window.scrollY || window.pageYOffset || 0;
    dom.appBar.classList.toggle('is-scrolled', y > 8);
    var showFab = y > 600;
    dom.toTopFab.classList.toggle('is-visible', showFab);
    dom.toTopFab.tabIndex = showFab ? 0 : -1;
  }

  function bindEvents() {

    dom.protoChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-proto]');
      if (!chip || chip.disabled) return;
      if (chip.dataset.proto === '__all__') {
        Store.setFilters({ protocols: [] });
      } else {
        Store.toggleProtocol(chip.dataset.proto);
      }
    });

    dom.countryChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-country]');
      if (!chip) return;
      Store.toggleCountry(chip.dataset.country);
    });

    dom.proxyChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-proto]');
      if (!chip || chip.disabled) return;
      Store.toggleProtocol(chip.dataset.proto);
    });

    dom.dpiChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-dpi]');
      if (!chip) return;
      var value = chip.dataset.dpi;
      Store.setFilters({ dpi: value === Store.state.filters.dpi ? '' : value });
    });

    dom.proxiesToggle.addEventListener('change', function () {
      Store.setFilters({ proxies: this.checked });
    });
    dom.bypassToggle.addEventListener('change', function () {

      var routed = Sub.ROUTED_FORMATS.indexOf(Store.state.filters.format) !== -1;
      Store.setFilters({ bypassRu: routed && this.checked });
    });

    dom.speedSlider.addEventListener('input', function () {
      Store.setFilters({ minSpeed: Number(dom.speedSlider.value) });
    });
    dom.speedInput.addEventListener('change', commitSpeedInput);
    dom.speedInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitSpeedInput(); dom.speedInput.blur(); }
    });
    dom.speedInput.addEventListener('focus', function () {
      if (Store.state.filters.minSpeed <= 0) dom.speedInput.value = '';
      else dom.speedInput.select();
    });

    dom.limitChips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-limit]');
      if (!chip) return;
      Store.setFilters({ limit: Number(chip.dataset.limit) || 0 });
    });

    dom.limitInput.addEventListener('change', function () {
      commitLimitInput();
    });
    dom.limitInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitLimitInput(); dom.limitInput.blur(); }
    });

    dom.pingSlider.addEventListener('input', function () {
      Store.setFilters({ maxPing: Number(dom.pingSlider.value) });
    });
    dom.pingInput.addEventListener('change', commitPingInput);
    dom.pingInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitPingInput(); dom.pingInput.blur(); }
    });
    dom.pingInput.addEventListener('focus', function () {
      if (Store.state.filters.maxPing >= Store.PING_MAX) dom.pingInput.value = '';
      else dom.pingInput.select();
    });

    dom.formatGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-format]');
      if (!btn) return;
      Store.setFilters({ format: btn.dataset.format });
    });

    dom.copyLinkBtn.addEventListener('click', copySubscriptionLink);
    dom.copyUrlBtn.addEventListener('click', copySubscriptionLink);
    dom.urlField.addEventListener('focus', function () { dom.urlField.select(); });
    dom.qrToggleBtn.addEventListener('click', function () {
      Store.setUi({ qrOpen: !Store.state.ui.qrOpen });
    });
    dom.qrDownloadBtn.addEventListener('click', downloadQrSvg);

    var onSearchInput = debounce(function () {
      Store.setFilters({ search: dom.searchInput.value });
      dom.searchField.classList.toggle('has-value', Boolean(dom.searchInput.value));
    }, 160);
    dom.searchInput.addEventListener('input', onSearchInput);
    dom.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dom.searchInput.value) {
        dom.searchInput.value = '';
        Store.setFilters({ search: '' });
      }
    });
    dom.searchClear.addEventListener('click', function () {
      dom.searchInput.value = '';
      Store.setFilters({ search: '' });
      dom.searchInput.focus();
    });

    dom.nodesBody.addEventListener('click', function (e) {
      var copyBtn = e.target.closest('[data-copy-node]');
      if (copyBtn) {
        var node = renderedRows[Number(copyBtn.dataset.copyNode)];
        if (!node) return;
        copyText(node.uri).then(function (ok) {
          if (ok) {
            showSnackbar('Node URI copied \u00b7 ' + (PROTOCOL_LABELS[node.proto] || node.proto), 'check');
            flashCopied(copyBtn);
          } else {
            showSnackbar('Copy failed - your browser blocked clipboard access', 'error');
          }
        });
        return;
      }

      var textBtn = e.target.closest('[data-copy-text]');
      if (textBtn) {
        copyText(textBtn.dataset.copyText).then(function (ok) {
          showSnackbar(ok ? 'Node URI copied' : 'Copy failed - your browser blocked clipboard access', ok ? 'check' : 'error');
          if (ok) flashCopied(textBtn);
        });
        return;
      }

      var qrBtn = e.target.closest('[data-qr-uri]');
      if (qrBtn) {
        openNodeDialog(Number(qrBtn.dataset.qrUri));
        return;
      }

      if (e.target.closest('.checkbox')) return; 

      var row = e.target.closest('tr[data-row-uri]');
      if (row) toggleExpand(row.dataset.rowUri);
    });

    dom.nodesBody.addEventListener('change', function (e) {
      var cb = e.target.closest('[data-select-uri]');
      if (!cb) return;
      var uri = cb.dataset.selectUri;
      if (cb.checked) selection.add(uri); else selection.delete(uri);
      var row = cb.closest('tr');
      if (row) row.classList.toggle('is-selected', cb.checked);
      updateBulkBar();
      updateSelectAllState();
    });

    dom.selectAllCb.addEventListener('change', function () {
      var visible = Store.getVisibleNodes();
      if (this.checked) visible.forEach(function (n) { selection.add(n.uri); });
      else visible.forEach(function (n) { selection.delete(n.uri); });
      renderTable('none');
      updateBulkBar();
    });

    dom.bulkCopyUris.addEventListener('click', function () {
      var list = orderedSelected();
      if (!list.length) return;
      copyText(list.map(function (n) { return n.uri; }).join('\n')).then(function (ok) {
        showSnackbar(ok ? list.length + ' URIs copied to clipboard' : 'Copy failed', ok ? 'check' : 'error');
      });
    });
    dom.bulkCopyB64.addEventListener('click', function () {
      var list = orderedSelected();
      if (!list.length) return;
      var b64 = utf8Base64(list.map(function (n) { return n.uri; }).join('\n'));
      copyText(b64).then(function (ok) {
        showSnackbar(ok ? 'Base64 subscription copied (' + list.length + ' nodes)' : 'Copy failed', ok ? 'check' : 'error');
      });
    });
    dom.bulkDownload.addEventListener('click', function () {
      var list = orderedSelected();
      if (!list.length) return;
      downloadBlob(list.map(function (n) { return n.uri; }).join('\n') + '\n', 'text/plain;charset=utf-8', 'vpn-selection.txt');
      showSnackbar('Selection saved as vpn-selection.txt', 'check');
    });
    dom.bulkClear.addEventListener('click', function () {
      selection.clear();
      renderTable('none');
      updateBulkBar();
    });

    dom.showMoreBtn.addEventListener('click', function () {
      shownCount += PAGE_SIZE;
      renderTable('fade');
    });

    dom.densityBtn.addEventListener('click', function () {
      applyDensity(!dom.nodesTable.classList.contains('data-table--compact'));
    });

    dom.exportBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = dom.exportMenu.hidden;
      dom.exportMenu.hidden = !open;
      dom.exportBtn.setAttribute('aria-expanded', String(open));
    });
    dom.exportMenu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-export]');
      if (!item) return;
      var rows = Store.getVisibleNodes();
      if (!rows.length) {
        showSnackbar('Nothing to export in the current view', 'error');
      } else if (item.dataset.export === 'json') {
        copyText(exportJson(rows)).then(function (ok) {
          showSnackbar(ok ? 'JSON copied (' + rows.length + ' nodes)' : 'Copy failed', ok ? 'check' : 'error');
        });
      } else if (item.dataset.export === 'csv') {
        copyText(exportCsv(rows)).then(function (ok) {
          showSnackbar(ok ? 'CSV copied (' + rows.length + ' rows)' : 'Copy failed', ok ? 'check' : 'error');
        });
      } else {
        downloadBlob(exportCsv(rows) + '\n', 'text/csv;charset=utf-8', 'vpn-nodes.csv');
        showSnackbar('CSV saved as vpn-nodes.csv', 'check');
      }
      dom.exportMenu.hidden = true;
      dom.exportBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', function (e) {
      if (!dom.exportMenu.hidden && !e.target.closest('.menu-anchor')) {
        dom.exportMenu.hidden = true;
        dom.exportBtn.setAttribute('aria-expanded', 'false');
      }
    });

    dom.dialogCloseBtn.addEventListener('click', closeNodeDialog);
    dom.dialogScrim.addEventListener('click', function (e) {
      if (e.target === dom.dialogScrim) closeNodeDialog();
    });
    dom.dialogCopyBtn.addEventListener('click', function () {
      if (!dialogNode) return;
      copyText(dialogNode.uri).then(function (ok) {
        showSnackbar(ok ? 'Node URI copied' : 'Copy failed', ok ? 'check' : 'error');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!dom.dialogScrim.hidden) closeNodeDialog();
        if (!dom.exportMenu.hidden) {
          dom.exportMenu.hidden = true;
          dom.exportBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });

    $$('[data-sort]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Store.setSort(btn.dataset.sort);
      });
    });

    dom.activeFilters.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-af]');
      if (!chip) return;
      var value = chip.dataset.af;
      if (value === 'all') {
        Store.resetFilters();
        dom.searchInput.value = '';
        dom.searchField.classList.remove('has-value');
        return;
      }
      var sep = value.indexOf(':');
      var kind = sep === -1 ? value : value.slice(0, sep);
      var arg = sep === -1 ? '' : value.slice(sep + 1);
      if (kind === 'proto') Store.toggleProtocol(arg);
      else if (kind === 'country') Store.toggleCountry(arg);
      else if (kind === 'ping') Store.setFilters({ maxPing: Store.PING_MAX });
      else if (kind === 'speed') Store.setFilters({ minSpeed: 0 });
      else if (kind === 'dpi') Store.setFilters({ dpi: '' });
      else if (kind === 'proxies') Store.setFilters({ proxies: false });
      else if (kind === 'bypass') Store.setFilters({ bypassRu: false });
      else if (kind === 'limit') Store.setFilters({ limit: 0 });
      else if (kind === 'search') {
        Store.setFilters({ search: '' });
        dom.searchInput.value = '';
        dom.searchField.classList.remove('has-value');
      }
    });

    dom.toTopFab.addEventListener('click', function () {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });

    window.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      dom.searchInput.focus();
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { positionGlider(); });

    dom.refreshBtn.addEventListener('click', function () { loadNodes({ silent: false }); });
    dom.retryBtn.addEventListener('click', function () { loadNodes({ silent: false }); });
    dom.clearFiltersBtn.addEventListener('click', function () {
      Store.resetFilters();
      dom.searchInput.value = '';
      dom.searchField.classList.remove('has-value');
      showSnackbar('All filters cleared', 'check');
    });

    Store.on('filters', onFiltersChanged);
    Store.on('nodes', onNodesChanged);
    Store.on('status', onStatusChanged);
    Store.on('ui', onUiChanged);

    window.addEventListener('hashchange', applyHashFromLocation);

    dom.autoRefreshToggle.addEventListener('change', function () {
      nextAutoAt = Date.now() + AUTO_REFRESH_MS;
      dom.autoRefreshCount.textContent = this.checked ? fmtCountdown(AUTO_REFRESH_MS) : 'off';
    });
    setInterval(function () {
      if (!dom.autoRefreshToggle.checked) {
        dom.autoRefreshCount.textContent = 'off';
        return;
      }
      var remain = nextAutoAt - Date.now();
      dom.autoRefreshCount.textContent = fmtCountdown(remain);
      if (remain <= 0 && document.visibilityState === 'visible' && !loadInFlight) {
        nextAutoAt = Date.now() + AUTO_REFRESH_MS;
        loadNodes({ silent: true });
      }
    }, 1000);
  }

  function copySubscriptionLink() {
    var url = Sub.buildSubscriptionUrl(Store.state.filters);
    copyText(url).then(function (ok) {
      if (ok) {
        showSnackbar('Subscription link copied to clipboard', 'check');
        flashCopied(dom.copyUrlBtn);
      } else {
        showSnackbar('Copy failed - select the URL manually', 'error');
      }
    });
  }

  function commitPingInput() {
    var raw = dom.pingInput.value.trim();
    if (raw === '' || /^(any|all|\u221e|inf(inite)?)$/i.test(raw)) {
      Store.setFilters({ maxPing: Store.PING_MAX });
    } else {
      var num = parseInt(raw.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(num)) {
        if (num >= Store.PING_MAX) Store.setFilters({ maxPing: Store.PING_MAX });
        else Store.setFilters({ maxPing: Math.max(Store.PING_MIN, num) });
      }
    }
    syncPingControl();
  }

  function commitLimitInput() {
    var raw = dom.limitInput.value.trim().toLowerCase();
    if (raw === '' || raw === 'default') {
      Store.setFilters({ limit: 0 });
    } else if (raw === 'all' || raw === 'any' || raw === '\u221e') {
      Store.setFilters({ limit: -1 });
    } else {
      var num = parseInt(raw.replace(/[^\d]/g, ''), 10);
      Store.setFilters({ limit: Number.isFinite(num) && num > 0 ? num : 0 });
    }
    syncLimitControls();
  }

  function commitSpeedInput() {
    var raw = dom.speedInput.value.trim();
    if (raw === '' || /^(any|all|off|0|\u221e)$/i.test(raw)) {
      Store.setFilters({ minSpeed: 0 });
    } else {
      var num = parseInt(raw.replace(/[^\d]/g, ''), 10);
      Store.setFilters({ minSpeed: Number.isFinite(num) && num > 0 ? num : 0 });
    }
    syncExtraControls();
  }

  function init() {
    cacheDom();

    renderProtocolChips();
    renderCountryChips();

    var restored = Sub.filtersFromHash(window.location.hash);
    if (restored) Store.setFilters(restored);
    else restoreFormatPref();

    syncControls();
    renderHistogram();
    renderActiveFilters();
    renderOutput();
    renderTable();
    renderStatusLine();
    applyDensity(restoreDensityPref());
    bindEvents();
    onScroll();

    window.addEventListener('load', positionGlider);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(positionGlider);
    }

    loadNodes({ silent: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
