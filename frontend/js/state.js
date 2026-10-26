(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Store = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KNOWN_PROTOCOLS = ['vless', 'trojan', 'hysteria2', 'ss', 'vmess', 'tuic', 'socks5', 'socks4', 'http', 'https'];
  var KNOWN_FORMATS = ['base64', 'raw', 'singbox', 'clash'];
  var KNOWN_SORT_KEYS = ['rtt', 'country', 'proto', 'server', 'exitIp', 'speed'];
  var PROXY_PROTOCOLS = ['socks5', 'socks4', 'http', 'https'];
  var DPI_LEVELS = ['', 'reality', 'high'];
  var DEFAULT_LIMIT_CAP = 100; 

  var PING_MIN = 50;
  var PING_MAX = 1000; 
  var LIMIT_MAX = 5000; 

  var state = {
    status: 'idle', 
    refreshing: false, 
    error: null, 
    nodes: [], 
    totalReported: 0,
    lastUpdated: null, 
    lastFetchMs: null, 

    filters: {
      protocols: [], 
      countries: [], 
      maxPing: PING_MAX, 
      limit: 0, 
      search: '',
      format: 'base64',
      sortKey: 'rtt',
      sortDir: 'asc',
      proxies: false, 
      bypassRu: false, 
      dpi: '', 
      minSpeed: 0, 
    },

    ui: {
      qrOpen: false,
    },
  };

  var listeners = Object.create(null);

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
    return function off() {
      listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; });
    };
  }

  function emit(event, detail) {
    var fns = listeners[event];
    if (fns) {
      fns.slice().forEach(function (fn) {
        try { fn(detail, state); } catch (err) { console.error('[store:' + event + ']', err); }
      });
    }
    if (listeners['*']) {
      listeners['*'].slice().forEach(function (fn) {
        try { fn(event, state); } catch (err) { console.error('[store:*]', err); }
      });
    }
  }

  function uniq(values) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (!seen[v]) { seen[v] = true; out.push(v); }
    }
    return out;
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function sanitizeFilters(patch) {
    var out = {};
    if (!patch || typeof patch !== 'object') return out;

    if (patch.protocols !== undefined) {
      out.protocols = uniq(
        (Array.isArray(patch.protocols) ? patch.protocols : [])
          .map(function (p) { return String(p).toLowerCase().trim(); })
          .filter(function (p) { return KNOWN_PROTOCOLS.indexOf(p) !== -1; })
      );
    }
    if (patch.countries !== undefined) {
      out.countries = uniq(
        (Array.isArray(patch.countries) ? patch.countries : [])
          .map(function (c) { return String(c).toLowerCase().trim(); })
          .filter(function (c) { return /^[a-z]{2}$/.test(c); })
      );
    }
    if (patch.maxPing !== undefined) {
      var ping = Number(patch.maxPing);
      out.maxPing = Number.isFinite(ping) ? clamp(Math.round(ping), PING_MIN, PING_MAX) : PING_MAX;
    }
    if (patch.limit !== undefined) {
      var limit = Number(patch.limit);
      if (!Number.isFinite(limit) || limit === 0) out.limit = 0;
      else if (limit < 0 || String(patch.limit).toLowerCase() === 'all') out.limit = -1;
      else out.limit = clamp(Math.round(limit), 1, LIMIT_MAX);
    }
    if (patch.search !== undefined) {
      out.search = String(patch.search == null ? '' : patch.search).slice(0, 120);
    }
    if (patch.format !== undefined) {
      out.format = KNOWN_FORMATS.indexOf(patch.format) !== -1 ? patch.format : 'base64';
    }
    if (patch.sortKey !== undefined && KNOWN_SORT_KEYS.indexOf(patch.sortKey) !== -1) {
      out.sortKey = patch.sortKey;
    }
    if (patch.sortDir !== undefined) {
      out.sortDir = patch.sortDir === 'desc' ? 'desc' : 'asc';
    }
    if (patch.proxies !== undefined) out.proxies = Boolean(patch.proxies);
    if (patch.bypassRu !== undefined) out.bypassRu = Boolean(patch.bypassRu);
    if (patch.dpi !== undefined) {
      out.dpi = DPI_LEVELS.indexOf(patch.dpi) !== -1 ? patch.dpi : '';
    }
    if (patch.minSpeed !== undefined) {
      var ms = Number(patch.minSpeed);
      out.minSpeed = Number.isFinite(ms) && ms > 0 ? clamp(Math.round(ms), 1, 2000) : 0;
    }
    return out;
  }

  function isProxyProto(proto) {
    return PROXY_PROTOCOLS.indexOf(proto) !== -1;
  }

  function proxiesVisible() {
    var f = state.filters;
    if (f.proxies) return true;
    return f.protocols.some(isProxyProto);
  }

  function getPreviewNodes() {
    if (proxiesVisible()) return state.nodes;
    return state.nodes.filter(function (n) { return !n.isProxy; });
  }

  function getEffectiveMaxPing() {
    return state.filters.maxPing >= PING_MAX ? Infinity : state.filters.maxPing;
  }

  function getCountryStats() {
    var map = new Map();
    getPreviewNodes().forEach(function (n) {
      if (!n.countryCode) return; 
      var entry = map.get(n.countryCode);
      if (!entry) {
        entry = {
          code: n.countryCode,
          name: n.country || n.countryCode.toUpperCase(),
          flag: n.flag || '\u{1F310}',
          count: 0,
        };
        map.set(n.countryCode, entry);
      }
      entry.count++;
      if ((!entry.name || entry.name === entry.code.toUpperCase()) && n.country) entry.name = n.country;
      if (entry.flag === '\u{1F310}' && n.flag && n.flag !== '\u{1F310}') entry.flag = n.flag;
    });
    return Array.from(map.values()).sort(function (a, b) {
      return b.count - a.count || a.name.localeCompare(b.name, 'en');
    });
  }

  function getProtocolStats() {
    var counts = Object.create(null);
    state.nodes.forEach(function (n) { counts[n.proto] = (counts[n.proto] || 0) + 1; });
    return counts;
  }

  function getUnknownCountryCount() {
    return getPreviewNodes().filter(function (n) { return !n.countryCode; }).length;
  }

  function nodeMatchesSearch(node, query) {
    if (!query) return true;
    var hay = [
      node.server, node.exitIp, node.country, node.countryCode,
      node.proto, node.tag,
    ].join(' ').toLowerCase();
    return query.split(/\s+/).every(function (token) {
      return hay.indexOf(token) !== -1;
    });
  }

  function compareBy(key, dir) {
    var sign = dir === 'desc' ? -1 : 1;
    return function (a, b) {
      var result;
      if (key === 'rtt') {
        var ra = a.rtt == null ? Infinity : a.rtt;
        var rb = b.rtt == null ? Infinity : b.rtt;
        result = ra - rb;
      } else if (key === 'country') {
        var ca = a.country || '\uffff'; 
        var cb = b.country || '\uffff';
        result = ca.localeCompare(cb, 'en');
      } else if (key === 'server') {
        result = String(a.server || '\uffff').localeCompare(String(b.server || '\uffff'), 'en');
      } else if (key === 'exitIp') {
        result = compareExitKeys(a.exitIp, b.exitIp);
      } else if (key === 'speed') {
        var sa = a.speed == null ? -1 : a.speed;
        var sb = b.speed == null ? -1 : b.speed;
        result = sa - sb;
      } else {
        result = String(a.proto).localeCompare(String(b.proto), 'en');
      }
      if (result === 0) {

        result = (a.rtt == null ? Infinity : a.rtt) - (b.rtt == null ? Infinity : b.rtt);
        if (result === 0) result = String(a.server).localeCompare(String(b.server), 'en');
      }
      return result * sign;
    };
  }

  function compareExitKeys(x, y) {
    var px = parseIpv4(x), py = parseIpv4(y);
    if (px && py) {
      for (var i = 0; i < 4; i++) {
        if (px[i] !== py[i]) return px[i] - py[i];
      }
      return 0;
    }
    if (px && !py) return -1; 
    if (!px && py) return 1;
    return String(x || '\uffff').localeCompare(String(y || '\uffff'), 'en');
  }

  function parseIpv4(value) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(value || ''));
    if (!m) return null;
    var parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    return parts.every(function (p) { return p <= 255; }) ? parts : null;
  }

  function getMatchingNodes() {
    var f = state.filters;
    var maxPing = getEffectiveMaxPing();
    var query = f.search.trim().toLowerCase();

    var list = getPreviewNodes().filter(function (n) {
      if (f.protocols.length && f.protocols.indexOf(n.proto) === -1) return false;
      if (f.countries.length && (!n.countryCode || f.countries.indexOf(n.countryCode) === -1)) return false;
      if (maxPing !== Infinity && (n.rtt == null || n.rtt > maxPing)) return false;
      if (f.dpi === 'reality' && !n.isReality) return false;
      if (f.dpi === 'high' && n.dpi !== 'high') return false;
      if (f.minSpeed > 0 && (n.speed == null || n.speed < f.minSpeed)) return false;
      if (!nodeMatchesSearch(n, query)) return false;
      return true;
    });

    list.sort(compareBy(f.sortKey, f.sortDir));
    return list;
  }

  function getHistogramNodes() {
    var f = state.filters;
    var query = f.search.trim().toLowerCase();
    return getPreviewNodes().filter(function (n) {
      if (f.protocols.length && f.protocols.indexOf(n.proto) === -1) return false;
      if (f.countries.length && (!n.countryCode || f.countries.indexOf(n.countryCode) === -1)) return false;
      if (!nodeMatchesSearch(n, query)) return false;
      return true;
    });
  }

  function getVisibleNodes() {
    var matching = getMatchingNodes();
    var limit = state.filters.limit;
    var cap = limit === 0 ? DEFAULT_LIMIT_CAP : limit === -1 ? Infinity : limit;
    return matching.slice(0, cap);
  }

  function setFilters(patch) {
    var clean = sanitizeFilters(patch);
    if (!Object.keys(clean).length) return;
    Object.assign(state.filters, clean);
    emit('filters', clean);
  }

  function toggleProtocol(proto) {
    var p = String(proto).toLowerCase();
    if (KNOWN_PROTOCOLS.indexOf(p) === -1) return;
    var list = state.filters.protocols.slice();
    var idx = list.indexOf(p);
    if (idx === -1) list.push(p); else list.splice(idx, 1);
    setFilters({ protocols: list });
  }

  function toggleCountry(code) {
    var c = String(code).toLowerCase();
    if (!/^[a-z]{2}$/.test(c)) return;
    var list = state.filters.countries.slice();
    var idx = list.indexOf(c);
    if (idx === -1) list.push(c); else list.splice(idx, 1);
    setFilters({ countries: list });
  }

  function resetFilters() {
    setFilters({
      protocols: [], countries: [], maxPing: PING_MAX, limit: 0, search: '',
      proxies: false, bypassRu: false, dpi: '', minSpeed: 0,
    });
  }

  function setSort(key) {
    if (KNOWN_SORT_KEYS.indexOf(key) === -1) return;
    if (state.filters.sortKey === key) {
      setFilters({ sortDir: state.filters.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {

      setFilters({ sortKey: key, sortDir: key === 'speed' ? 'desc' : 'asc' });
    }
  }

  function beginLoad(silent) {
    state.refreshing = !!silent;
    if (!silent) {
      state.status = 'loading';
      state.error = null;
    }
    emit('status');
  }

  function setNodes(nodes, fetchedAt, total, durationMs) {
    state.nodes = nodes;
    state.totalReported = total || nodes.length;
    state.lastUpdated = fetchedAt || Date.now();
    state.lastFetchMs = durationMs || null;
    state.status = 'ready';
    state.refreshing = false;
    state.error = null;
    emit('nodes');
    emit('status');
  }

  function setError(err) {
    state.error = err || new Error('Unknown error');
    state.status = 'error';
    state.refreshing = false;
    emit('status');
  }

  function endRefresh() {
    state.refreshing = false;
    emit('status');
  }

  function setUi(patch) {
    Object.assign(state.ui, patch || {});
    emit('ui', patch);
  }

  return {

    PING_MIN: PING_MIN,
    PING_MAX: PING_MAX,
    LIMIT_MAX: LIMIT_MAX,
    DEFAULT_LIMIT_CAP: DEFAULT_LIMIT_CAP,
    KNOWN_PROTOCOLS: KNOWN_PROTOCOLS,
    KNOWN_FORMATS: KNOWN_FORMATS,
    KNOWN_SORT_KEYS: KNOWN_SORT_KEYS,
    PROXY_PROTOCOLS: PROXY_PROTOCOLS,
    DPI_LEVELS: DPI_LEVELS,

    state: state,

    on: on,

    setFilters: setFilters,
    toggleProtocol: toggleProtocol,
    toggleCountry: toggleCountry,
    resetFilters: resetFilters,
    setSort: setSort,
    beginLoad: beginLoad,
    setNodes: setNodes,
    setError: setError,
    endRefresh: endRefresh,
    setUi: setUi,

    getEffectiveMaxPing: getEffectiveMaxPing,
    getCountryStats: getCountryStats,
    getProtocolStats: getProtocolStats,
    getUnknownCountryCount: getUnknownCountryCount,
    getMatchingNodes: getMatchingNodes,
    getVisibleNodes: getVisibleNodes,
    getHistogramNodes: getHistogramNodes,
    getPreviewNodes: getPreviewNodes,
    proxiesVisible: proxiesVisible,
    isProxyProto: isProxyProto,
  };
});
