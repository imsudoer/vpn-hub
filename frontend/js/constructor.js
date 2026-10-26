(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SubConstructor = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FALLBACK_BASE = 'https://free.vpn.onlysq.me';
  var FALLBACK_ENDPOINTS = {
    base64: { path: '/sub' },
    raw: { path: '/sub/raw' },
    singbox: { path: '/sub/singbox' },
  };

  var FORMATS = [
    {
      id: 'base64',
      label: 'Base64',
      hint: 'Standard subscription - v2rayNG, Streisand, NekoBox, Happ, v2rayN',
    },
    {
      id: 'raw',
      label: 'Raw list',
      hint: 'Plain-text URI list - for scripts and manual imports',
    },
    {
      id: 'singbox',
      label: 'Sing-box',
      hint: 'Complete sing-box JSON config with an AUTO-SELECT urltest group',
    },
    {
      id: 'clash',
      label: 'Clash',
      hint: 'Config for Clash Verge, Mihomo, Clash.Meta, Clash for Android, Stash',
    },
  ];

  var ROUTED_FORMATS = ['singbox', 'clash'];

  var PROTOCOL_ORDER = ['vless', 'trojan', 'hysteria2', 'ss', 'vmess', 'tuic', 'socks5', 'socks4', 'http', 'https'];

  var PING_ANY = 1000; 

  function getApi() {
    var g = typeof window !== 'undefined' ? window : globalThis;
    return g.VpnApi || null;
  }

  function orderedProtocols(protocols) {
    return PROTOCOL_ORDER.filter(function (p) { return protocols.indexOf(p) !== -1; });
  }

  function buildSubscriptionUrl(filters) {
    var api = getApi();
    var base = api ? api.API_BASE : FALLBACK_BASE;
    var endpoints = api ? api.ENDPOINTS : FALLBACK_ENDPOINTS;
    var endpoint = endpoints[filters.format] || endpoints.base64;

    var qs = new URLSearchParams();

    if (filters.countries && filters.countries.length) {
      qs.set('c', filters.countries.slice().sort().join(','));
    }
    if (filters.maxPing > 0 && filters.maxPing < PING_ANY) {
      qs.set('max', String(filters.maxPing));
    }
    if (filters.protocols && filters.protocols.length) {
      qs.set('p', orderedProtocols(filters.protocols).join(','));
    }
    if (filters.limit > 0) {
      qs.set('l', String(filters.limit));
    } else if (filters.limit === -1) {
      qs.set('limit', 'all'); 
    }
    if (filters.bypassRu && ROUTED_FORMATS.indexOf(filters.format) !== -1) {
      qs.set('route', 'bypass_ru');
    }
    if (filters.dpi) {
      qs.set('dpi', filters.dpi);
    }
    if (filters.minSpeed > 0) {
      qs.set('min_speed', String(filters.minSpeed));
    }
    if (filters.proxies) {
      qs.set('proxies', '1');
    }

    var query = qs.toString().replace(/%2C/g, ','); 
    return base + endpoint.path + (query ? '?' + query : '');
  }

  function filtersToHash(filters) {
    var qs = new URLSearchParams();
    if (filters.protocols && filters.protocols.length) {
      qs.set('p', orderedProtocols(filters.protocols).join(','));
    }
    if (filters.countries && filters.countries.length) {
      qs.set('c', filters.countries.slice().sort().join(','));
    }
    if (filters.maxPing > 0 && filters.maxPing < PING_ANY) {
      qs.set('max', String(filters.maxPing));
    }
    if (filters.limit > 0) {
      qs.set('l', String(filters.limit));
    } else if (filters.limit === -1) {
      qs.set('l', 'all');
    }
    if (filters.format && filters.format !== 'base64') {
      qs.set('fmt', filters.format);
    }
    if (filters.proxies) qs.set('px', '1');
    if (filters.bypassRu) qs.set('rt', '1');
    if (filters.dpi) qs.set('dpi', filters.dpi);
    if (filters.minSpeed > 0) qs.set('ms', String(filters.minSpeed));
    if (filters.search && filters.search.trim()) {
      qs.set('q', filters.search.trim());
    }
    var sortKey = filters.sortKey || 'rtt';
    var sortDir = filters.sortDir || 'asc';
    if (sortKey !== 'rtt' || sortDir !== 'asc') {
      qs.set('sort', sortKey + (sortDir === 'desc' ? ':desc' : ''));
    }
    var query = qs.toString().replace(/%2C/g, ',');
    return query ? '#' + query : '';
  }

  function filtersFromHash(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (!raw) return null;

    var qs;
    try {
      qs = new URLSearchParams(raw);
    } catch (e) {
      return null;
    }

    var patch = {};
    var has = false;

    function list(key) {
      var value = qs.get(key);
      if (value == null) return [];
      return value.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    }

    if (qs.has('p')) { patch.protocols = list('p'); has = true; }
    if (qs.has('c')) { patch.countries = list('c'); has = true; }
    if (qs.has('max')) { patch.maxPing = Number(qs.get('max')); has = true; }
    if (qs.has('l')) { patch.limit = qs.get('l') === 'all' ? -1 : Number(qs.get('l')); has = true; }
    if (qs.has('fmt')) { patch.format = String(qs.get('fmt')).toLowerCase(); has = true; }
    if (qs.has('px')) { patch.proxies = qs.get('px') === '1'; has = true; }
    if (qs.has('rt')) { patch.bypassRu = qs.get('rt') === '1'; has = true; }
    if (qs.has('dpi')) { patch.dpi = String(qs.get('dpi')).toLowerCase(); has = true; }
    if (qs.has('ms')) { patch.minSpeed = Number(qs.get('ms')); has = true; }
    if (qs.has('q')) { patch.search = String(qs.get('q')); has = true; }
    if (qs.has('sort')) {
      var parts = String(qs.get('sort')).split(':');
      patch.sortKey = parts[0];
      patch.sortDir = parts[1] === 'desc' ? 'desc' : 'asc';
      has = true;
    }
    return has ? patch : null;
  }

  return {
    FORMATS: FORMATS,
    PROTOCOL_ORDER: PROTOCOL_ORDER,
    ROUTED_FORMATS: ROUTED_FORMATS,
    PING_ANY: PING_ANY,
    buildSubscriptionUrl: buildSubscriptionUrl,
    filtersToHash: filtersToHash,
    filtersFromHash: filtersFromHash,
  };
});
