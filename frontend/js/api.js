(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VpnApi = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var API_BASE = (function () {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      if (window.location.hostname === 'free.vpn.onlysq.me') {
        return window.location.origin;
      }
      if (window.location.hostname.endsWith('github.io')) {
        return window.location.origin + window.location.pathname.replace(/\/$/, '');
      }
    }
    return 'https://free.vpn.onlysq.me';
  })();

  var ENDPOINTS = {
    base64: { path: '/sub', label: 'Base64 subscription' },
    raw: { path: '/sub/raw', label: 'Raw URI list' },
    singbox: { path: '/sub/singbox', label: 'Sing-box JSON config' },
    clash: { path: '/sub/clash', label: 'Clash / Mihomo YAML config' },
  };

  var PROTO_ALIASES = {
    vless: 'vless',
    trojan: 'trojan',
    hysteria2: 'hysteria2',
    hy2: 'hysteria2',
    hysteria: 'hysteria2',
    ss: 'ss',
    shadowsocks: 'ss',
    vmess: 'vmess',
    tuic: 'tuic',
    socks5: 'socks5',
    socks4: 'socks4',
    socks: 'socks5',
    http: 'http',
    https: 'https',
  };

  var PROXY_PROTOCOLS = ['socks5', 'socks4', 'http', 'https'];

  function ApiError(message, kind, status) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.kind = kind; 
    err.status = status || 0;
    return err;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function flagFromCode(code) {
    if (!/^[a-z]{2}$/i.test(code || '')) return '\u{1F310}'; 
    return String(code).toUpperCase().replace(/[A-Z]/g, function (ch) {
      return String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65);
    });
  }

  function guessProtoFromUri(uri) {
    var m = /^([a-z0-9+.-]+):\/\//i.exec(uri);
    var scheme = m ? m[1].toLowerCase() : '';
    return PROTO_ALIASES[scheme] || scheme || 'unknown';
  }

  function parseUriAuthority(uri) {
    var m = /^[a-z0-9+.-]+:\/\/(?:[^@/?#]*@)?([^/?#:]+)(?::(\d+))?/i.exec(uri);
    return m ? { host: m[1], port: m[2] ? Number(m[2]) : null } : { host: '', port: null };
  }

  function normalizeNode(raw) {
    if (!raw || typeof raw.uri !== 'string' || !raw.uri.trim()) return null;

    var uri = raw.uri.trim();
    var fallback = parseUriAuthority(uri);
    var countryCode = String(raw.country_code || '').toLowerCase().trim();
    if (countryCode && !/^[a-z]{2}$/.test(countryCode)) countryCode = '';

    var proto = PROTO_ALIASES[String(raw.proto || '').toLowerCase().trim()] || guessProtoFromUri(uri);
    var server = String(raw.server || fallback.host || '').trim();
    var port = Number(raw.server_port) > 0 ? Number(raw.server_port) : (fallback.port || null);
    var rtt = Number.isFinite(Number(raw.rtt)) && Number(raw.rtt) >= 0 ? Math.round(Number(raw.rtt)) : null;
    var flag = typeof raw.flag === 'string' && raw.flag.trim() ? raw.flag.trim() : flagFromCode(countryCode);
    var country = typeof raw.country === 'string' ? raw.country.trim() : '';
    var exitIp = String(raw.exit_ip || server || '').trim();

    var label = proto === 'ss' ? 'SS' : String(proto).toUpperCase();
    var tag = String(raw.tag || '').trim();
    if (!tag) {
      tag = flag + ' ' + label + (rtt != null ? ' ' + rtt + 'ms' : '') + (server ? ' | ' + server : '');
    }

    return {
      uri: uri,
      rtt: rtt,
      tag: tag,
      proto: proto,
      flag: flag,
      country: country,
      countryCode: countryCode,
      exitIp: exitIp,
      server: server,
      port: port,
      isProxy: Boolean(raw.is_proxy) || PROXY_PROTOCOLS.indexOf(proto) !== -1,
      isReality: Boolean(raw.is_reality),
      dpi: typeof raw.dpi_resilience === 'string' ? raw.dpi_resilience : '',
      speed: Number(raw.speed_mbps) > 0 ? Math.round(Number(raw.speed_mbps) * 10) / 10 : null,
    };
  }

  function classifyFetchError(err) {
    if (err && err.name === 'ApiError') return err;
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      return ApiError('The registry took too long to respond', 'timeout');
    }
    return ApiError('Network request failed - the registry could not be reached', 'network');
  }

  function isClientError(err) {
    return err && err.name === 'ApiError' && err.status >= 400 && err.status < 500;
  }

  async function fetchWithRetry(url, options) {
    var opts = options || {};
    var retries = opts.retries != null ? opts.retries : 2;
    var timeout = opts.timeout || 15000;
    var baseDelay = opts.baseDelay || 700;
    var lastErr = null;

    for (var attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(baseDelay * Math.pow(2, attempt - 1));

      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeout);
      try {
        var res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json, text/plain;q=0.8' },
          cache: 'no-store',
        });
        if (!res.ok) {
          var httpErr = ApiError('The registry returned HTTP ' + res.status, 'http', res.status);
          if (isClientError(httpErr)) throw httpErr; 
          lastErr = httpErr; 
          continue;
        }
        return res;
      } catch (err) {
        if (isClientError(err)) throw err;
        lastErr = classifyFetchError(err);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || ApiError('Request failed', 'network');
  }

  async function fetchNodes(options) {
    var startedAt = Date.now();
    var res;

    try {
      res = await fetchWithRetry(API_BASE + '/api/nodes?include_proxies=1', options);
    } catch (apiErr) {

      try {
        var staticPath = (typeof window !== 'undefined' && window.location && window.location.pathname)
          ? window.location.pathname.replace(/\/[^/]*$/, '/') + 'nodes.json'
          : 'nodes.json';
        res = await fetchWithRetry(staticPath, options);
      } catch (staticErr) {
        throw apiErr;
      }
    }

    var payload;
    try {
      payload = await res.json();
    } catch (e) {
      throw ApiError('The registry returned malformed JSON', 'parse');
    }
    if (!Array.isArray(payload)) {
      throw ApiError('The registry returned an unexpected payload shape', 'parse');
    }

    var nodes = [];
    var seen = new Set();
    for (var i = 0; i < payload.length; i++) {
      var node = normalizeNode(payload[i]);
      if (node && !seen.has(node.uri)) {
        seen.add(node.uri);
        nodes.push(node);
      }
    }
    if (!nodes.length) {
      throw ApiError('The registry returned no usable nodes', 'empty');
    }
    return { nodes: nodes, fetchedAt: Date.now(), total: payload.length, durationMs: Date.now() - startedAt };
  }

  return {
    API_BASE: API_BASE,
    ENDPOINTS: ENDPOINTS,
    PROTO_ALIASES: PROTO_ALIASES,
    PROXY_PROTOCOLS: PROXY_PROTOCOLS,
    fetchNodes: fetchNodes,
    fetchWithRetry: fetchWithRetry,
    normalizeNode: normalizeNode,
    flagFromCode: flagFromCode,
    ApiError: ApiError,
  };
});
