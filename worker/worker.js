const GITHUB_PAGES_BASE = 'https://imsudoer.github.io/vpn-hub';

const PROXY_PROTOCOLS = new Set(['socks5', 'socks4', 'http', 'https']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    if (['/sub', '/sub/raw', '/sub/singbox', '/sub/clash', '/sub/mihomo', '/api/nodes'].includes(path)) {
      return handleSubscriptionRequest(request, url, path);
    }

    const targetUrl = new URL(url.pathname, GITHUB_PAGES_BASE);
    const response = await fetch(targetUrl.toString(), {
      headers: request.headers,
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    return response;
  }
};

async function handleSubscriptionRequest(request, url, path) {
  const nodesUrl = `${GITHUB_PAGES_BASE}/nodes.json`;
  const nodesResp = await fetch(nodesUrl, {
    cf: { cacheTtl: 300, cacheEverything: true }
  });

  if (!nodesResp.ok) {
    return new Response('Failed to load nodes registry', { status: 502 });
  }

  const allNodes = await nodesResp.json();
  const query = url.searchParams;

  const filteredNodes = applyFilters(allNodes, query);

  if (path === '/api/nodes') {
    return new Response(JSON.stringify(filteredNodes), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  if (path === '/sub/raw') {
    const text = filteredNodes.map(n => n.uri).join('\n');
    return new Response(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  if (path === '/sub/singbox') {
    const splitRu = ['bypass_ru', 'ru', 'smart'].includes((query.get('route') || '').toLowerCase());
    const singboxConfig = generateSingboxConfig(filteredNodes, splitRu);
    return new Response(JSON.stringify(singboxConfig, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="singbox.json"'
      }
    });
  }

  if (path === '/sub/clash' || path === '/sub/mihomo') {
    const splitRu = ['bypass_ru', 'ru', 'smart'].includes((query.get('route') || '').toLowerCase());
    const clashYaml = generateClashYaml(filteredNodes, splitRu);
    return new Response(clashYaml, {
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="clash.yaml"',
        'Subscription-Userinfo': 'upload=0; download=0; total=107374182400; expire=0',
        'Profile-Update-Interval': '1800'
      }
    });
  }

  const rawText = filteredNodes.map(n => n.uri).join('\n');
  const b64 = btoa(unescape(encodeURIComponent(rawText)));
  return new Response(b64, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="subscription.txt"',
      'Subscription-Userinfo': 'upload=0; download=0; total=107374182400; expire=0',
      'Profile-Update-Interval': '1800'
    }
  });
}

function applyFilters(nodes, q) {
  let res = nodes.slice();

  const includeProxies = q.get('include_proxies') === '1' || q.get('proxies') === '1';
  const protoParam = (q.get('p') || q.get('proto') || '').toLowerCase();
  const reqProtocols = protoParam ? protoParam.split(',').map(s => s.trim()) : [];

  const explicitProxyRequested = reqProtocols.some(p => PROXY_PROTOCOLS.has(p));
  if (!includeProxies && !explicitProxyRequested) {
    res = res.filter(n => !n.is_proxy && !PROXY_PROTOCOLS.has(n.proto));
  }

  const cParam = (q.get('c') || q.get('country') || '').toLowerCase();
  if (cParam && cParam !== 'all') {
    const countries = new Set(cParam.split(',').map(s => s.trim()));
    res = res.filter(n => countries.has((n.country_code || '').toLowerCase()));
  }

  if (reqProtocols.length > 0) {
    const protos = new Set(reqProtocols);
    res = res.filter(n => protos.has(n.proto));
  }

  const maxPing = parseInt(q.get('max') || q.get('max_ping') || '0', 10);
  if (maxPing > 0) {
    res = res.filter(n => (n.rtt || 9999) <= maxPing);
  }

  const minSpeed = parseFloat(q.get('min_speed') || '0');
  if (minSpeed > 0) {
    res = res.filter(n => (n.speed_mbps || 0) >= minSpeed);
  }

  const dpi = (q.get('dpi') || '').toLowerCase();
  if (dpi === 'reality') {
    res = res.filter(n => n.is_reality);
  } else if (dpi === 'high') {
    res = res.filter(n => n.dpi_resilience === 'high');
  }

  res.sort((a, b) => (a.rtt || 9999) - (b.rtt || 9999));

  const limitParam = (q.get('l') || q.get('limit') || '100').toLowerCase();
  if (limitParam !== 'all') {
    const limit = parseInt(limitParam, 10);
    if (!isNaN(limit) && limit > 0) {
      res = res.slice(0, limit);
    }
  }

  return res;
}

function generateSingboxConfig(nodes, splitRu) {
  const outbounds = [];
  const tags = [];

  nodes.forEach((n, idx) => {
    const tag = n.tag || `Node-${idx + 1}`;
    tags.push(tag);
    outbounds.push({
      type: n.proto || 'vless',
      tag: tag,
      server: n.server,
      server_port: n.server_port
    });
  });

  const cfg = {
    outbounds: [
      {
        type: 'selector',
        tag: 'PROXY-AUTO',
        outbounds: ['AUTO-SELECT', ...tags],
        default: 'AUTO-SELECT'
      },
      {
        type: 'urltest',
        tag: 'AUTO-SELECT',
        outbounds: tags,
        url: 'https://www.google.com/generate_204',
        interval: '3m'
      },
      ...outbounds,
      { type: 'direct', tag: 'DIRECT' },
      { type: 'block', tag: 'BLOCK' }
    ]
  };

  if (splitRu) {
    cfg.route = {
      rules: [
        { protocol: 'dns', outbound: 'DIRECT' },
        {
          geosite: [
            'category-gov-ru', 'yandex', 'vk', 'mailru', 'sberbank', 'tinkoff',
            'avito', 'ozon', 'wildberries', 'rutube', 'gosuslugi'
          ],
          outbound: 'DIRECT'
        },
        { geoip: ['ru'], outbound: 'DIRECT' },
        { outbound: 'AUTO-SELECT' }
      ],
      auto_detect_interface: true,
      final: 'AUTO-SELECT'
    };
  }

  return cfg;
}

function generateClashYaml(nodes, splitRu) {
  const proxies = [];
  const proxyNames = [];

  nodes.forEach((n, idx) => {
    const cleanTag = (n.tag || `Node-${idx + 1}`).replace(/[:"']/g, '');
    proxyNames.push(cleanTag);
    proxies.push({
      name: cleanTag,
      type: n.proto || 'vless',
      server: n.server,
      port: n.server_port,
      udp: true
    });
  });

  let yaml = `port: 7890
socks-port: 7891
allow-lan: false
mode: rule
log-level: info

proxies:
`;

  proxies.forEach(p => {
    yaml += `  - name: "${p.name}"\n    type: ${p.type}\n    server: ${p.server}\n    port: ${p.port}\n    udp: true\n`;
  });

  yaml += `
proxy-groups:
  - name: PROXY-AUTO
    type: select
    proxies:
      - AUTO-SELECT
`;
  proxyNames.forEach(name => {
    yaml += `      - "${name}"\n`;
  });

  yaml += `
  - name: AUTO-SELECT
    type: url-test
    url: https:
    interval: 180
    tolerance: 50
    proxies:
`;
  proxyNames.forEach(name => {
    yaml += `      - "${name}"\n`;
  });

  yaml += `
rules:
`;
  if (splitRu) {
    yaml += `  - GEOSITE,category-gov-ru,DIRECT
  - GEOSITE,yandex,DIRECT
  - GEOSITE,vk,DIRECT
  - GEOSITE,mailru,DIRECT
  - GEOSITE,sberbank,DIRECT
  - GEOSITE,tinkoff,DIRECT
  - GEOSITE,avito,DIRECT
  - GEOSITE,ozon,DIRECT
  - GEOSITE,wildberries,DIRECT
  - GEOSITE,gosuslugi,DIRECT
  - GEOIP,RU,DIRECT
`;
  }

  yaml += `  - GEOIP,LAN,DIRECT
  - MATCH,PROXY-AUTO
`;

  return yaml;
}
