import base64
import json
import logging
import re
import urllib.parse
from html import unescape
from typing import Any, Dict, List, Optional

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger("tg_vpn.parser")

DEFAULT_TG_CHANNELS = [
    "shadowsocksl",
    "OutlineReleasedKey",
    "V2ray_Collector",
    "v2ray_outlineir",
    "FreeV2rayConfig",
    "V2Ray_Alpha",
    "v2nodes",
    "happ_free_key",
    "V2RayRootFree",
    "PrivateVPNs",
    "DirectVPN",
    "v2ray_free_conf",
    "vlesstrojan",
    "kibersosnew"
]

ALL_TARGET_COUNTRIES = [

    "RU", "BY", "KZ", "AM", "UA", "PL", "CZ", "RO", "BG", "RS",

    "DE", "NL", "FR", "GB", "FI", "SE", "NO", "DK", "CH", "AT", "ES", "IT", "PT", "IE", "GR", "EE", "LV", "LT",

    "JP", "SG", "KR", "HK", "TW", "TR", "AE", "IN", "MY", "TH", "VN", "IL",

    "US", "CA", "BR", "AR", "AU", "NZ", "ZA"
]

DEFAULT_RAW_SOURCES = [

    "https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/main/BLACK_VLESS_RUS.txt",
    "https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/main/BLACK_VLESS_RUS_mobile.txt",
    "https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/main/Vless-Reality-White-Lists-Rus-Mobile.txt",
    "https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/main/BLACK_SS+All_RUS.txt",

    "https://raw.githubusercontent.com/Leon406/SubCrawler/main/sub/share/vless",
    "https://raw.githubusercontent.com/lagzian/SS-Collector/main/sub/vless",
    "https://raw.githubusercontent.com/lagzian/SS-Collector/main/sub/trojan"
] + [
    f"https://raw.githubusercontent.com/Au1rxx/free-vpn-subscriptions/main/output/country/{c}/v2ray-base64-0001.txt" 
    for c in ALL_TARGET_COUNTRIES
]

DEFAULT_PROXY_SOURCES = [
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies.json"
]

def safe_b64decode(s: str) -> str:
    s = s.strip()
    s += "=" * ((4 - len(s) % 4) % 4)
    try:
        return base64.b64decode(s).decode("utf-8", errors="ignore")
    except Exception:
        return ""

def parse_query_params(query: str) -> Dict[str, str]:
    res = {}
    if not query:
        return res
    for item in query.split("&"):
        if "=" in item:
            k, v = item.split("=", 1)
            res[urllib.parse.unquote(k)] = urllib.parse.unquote(v)
    return res

def uri_to_singbox_outbound(uri: str, tag: str = "proxy") -> Optional[Dict[str, Any]]:
    try:
        uri = uri.strip()
        if uri.startswith("vmess://"):
            return _vmess_to_singbox(uri, tag)
        if uri.startswith("ss://"):
            return _ss_to_singbox(uri, tag)
        if uri.startswith("vless://"):
            return _vless_to_singbox(uri, tag)
        if uri.startswith("trojan://"):
            return _trojan_to_singbox(uri, tag)
        if uri.startswith("hysteria2://") or uri.startswith("hy2://"):
            return _hysteria2_to_singbox(uri, tag)
        if uri.startswith("tuic://"):
            return _tuic_to_singbox(uri, tag)
        if uri.startswith("socks5://") or uri.startswith("socks://"):
            return _socks_to_singbox(uri, tag, version="5")
        if uri.startswith("socks4://"):
            return _socks_to_singbox(uri, tag, version="4")
        if uri.startswith("http://") or uri.startswith("https://"):
            return _http_to_singbox(uri, tag)
    except Exception as e:
        logger.debug(f"uri parse error: {e}")
        return None
    return None

def _vless_to_singbox(uri: str, tag: str) -> Optional[Dict[str, Any]]:
    parsed = urllib.parse.urlparse(uri)
    if not parsed.hostname or not parsed.username:
        return None

    params = parse_query_params(parsed.query)
    port = parsed.port or 443
    uuid = parsed.username
    security = params.get("security", "none").lower()
    net_type = params.get("type", "tcp").lower()
    flow = params.get("flow", "")
    sni = params.get("sni", parsed.hostname)
    fp = params.get("fp", "chrome")

    outbound: Dict[str, Any] = {
        "type": "vless",
        "tag": tag,
        "server": parsed.hostname,
        "server_port": port,
        "uuid": uuid,
    }

    if flow:
        outbound["flow"] = flow

    if security == "reality":
        pbk = params.get("pbk", "")
        sid = params.get("sid", "")
        outbound["tls"] = {
            "enabled": True,
            "server_name": sni,
            "utls": {"enabled": True, "fingerprint": fp if fp else "chrome"},
            "reality": {
                "enabled": True,
                "public_key": pbk,
                "short_id": sid,
            }
        }
    elif security == "tls":
        outbound["tls"] = {
            "enabled": True,
            "server_name": sni,
            "insecure": params.get("allowInsecure", "0") in ["1", "true"],
            "utls": {"enabled": True, "fingerprint": fp if fp else "chrome"}
        }
        alpn = params.get("alpn")
        if alpn:
            outbound["tls"]["alpn"] = [x.strip() for x in alpn.split(",")]

    if net_type in ["ws", "websocket"]:
        outbound["transport"] = {
            "type": "ws",
            "path": params.get("path", "/"),
            "headers": {"Host": params.get("host", sni)} if params.get("host") else {}
        }
    elif net_type == "grpc":
        outbound["transport"] = {
            "type": "grpc",
            "service_name": params.get("serviceName", "")
        }
    elif net_type in ["http", "h2", "xhttp", "splithttp", "httpupgrade"]:
        outbound["transport"] = {
            "type": "http",
            "host": [params.get("host", sni)],
            "path": params.get("path", "/")
        }

    return outbound

def _hysteria2_to_singbox(uri: str, tag: str) -> Optional[Dict[str, Any]]:
    parsed = urllib.parse.urlparse(uri)
    if not parsed.hostname or not parsed.username:
        return None

    params = parse_query_params(parsed.query)
    port = parsed.port or 443
    password = parsed.username
    sni = params.get("sni", parsed.hostname)
    insecure = params.get("insecure", "0") in ["1", "true"]

    outbound: Dict[str, Any] = {
        "type": "hysteria2",
        "tag": tag,
        "server": parsed.hostname,
        "server_port": port,
        "password": password,
        "tls": {
            "enabled": True,
            "server_name": sni,
            "insecure": insecure,
        }
    }
    alpn = params.get("alpn")
    if alpn:
        outbound["tls"]["alpn"] = [x.strip() for x in alpn.split(",")]
    return outbound

def _trojan_to_singbox(uri: str, tag: str) -> Optional[Dict[str, Any]]:
    parsed = urllib.parse.urlparse(uri)
    if not parsed.hostname or not parsed.username:
        return None

    params = parse_query_params(parsed.query)
    port = parsed.port or 443
    password = parsed.username
    sni = params.get("sni", parsed.hostname)
    insecure = params.get("allowInsecure", "0") in ["1", "true"]
    security = params.get("security", "tls").lower()

    outbound: Dict[str, Any] = {
        "type": "trojan",
        "tag": tag,
        "server": parsed.hostname,
        "server_port": port,
        "password": password,
    }

    if security != "none":
        outbound["tls"] = {
            "enabled": True,
            "server_name": sni,
            "insecure": insecure,
        }
        alpn = params.get("alpn")
        if alpn:
            outbound["tls"]["alpn"] = [x.strip() for x in alpn.split(",")]

    net_type = params.get("type", "tcp").lower()
    if net_type in ["ws", "websocket"]:
        outbound["transport"] = {
            "type": "ws",
            "path": params.get("path", "/"),
            "headers": {"Host": params.get("host", sni)} if params.get("host") else {}
        }
    elif net_type == "grpc":
        outbound["transport"] = {
            "type": "grpc",
            "service_name": params.get("serviceName", "")
        }

    return outbound

def _vmess_to_singbox(uri: str, tag: str) -> Optional[Dict[str, Any]]:
    raw_b64 = uri[8:]
    decoded_str = safe_b64decode(raw_b64)
    if not decoded_str:
        return None
    data = json.loads(decoded_str)

    server = data.get("add")
    port = int(data.get("port", 443))
    uuid = data.get("id")
    if not server or not uuid:
        return None

    net_type = str(data.get("net", "tcp")).lower()
    tls = str(data.get("tls", "")).lower()
    sni = data.get("sni") or data.get("host") or server

    outbound: Dict[str, Any] = {
        "type": "vmess",
        "tag": tag,
        "server": server,
        "server_port": port,
        "uuid": uuid,
        "security": data.get("scy", "auto"),
        "alter_id": int(data.get("aid", 0))
    }

    if tls == "tls":
        outbound["tls"] = {
            "enabled": True,
            "server_name": sni,
            "insecure": str(data.get("allowInsecure", "0")) in ["1", "true"]
        }

    if net_type in ["ws", "websocket"]:
        outbound["transport"] = {
            "type": "ws",
            "path": data.get("path", "/"),
            "headers": {"Host": data.get("host", sni)} if data.get("host") else {}
        }
    elif net_type == "grpc":
        outbound["transport"] = {
            "type": "grpc",
            "service_name": data.get("path", "")
        }

    return outbound

def _ss_to_singbox(uri: str, tag: str) -> Optional[Dict[str, Any]]:
    raw = uri[5:].split("#")[0].split("?")[0]
    if "@" in raw:
        user_info, host_port = raw.split("@", 1)
        decoded_user = safe_b64decode(user_info) if ":" not in user_info else user_info
        if ":" not in decoded_user:
            return None
        method, password = decoded_user.split(":", 1)
    else:
        decoded = safe_b64decode(raw)
        if "@" not in decoded:
            return None
        user_info, host_port = decoded.split("@", 1)
        if ":" not in user_info:
            return None
        method, password = user_info.split(":", 1)

    if ":" not in host_port:
        return None
    host, port_str = host_port.split(":", 1)

    return {
        "type": "shadowsocks",
        "tag": tag,
        "server": host,
        "server_port": int(port_str),
        "method": method,
        "password": password
    }

def _tuic_to_singbox(uri: str, tag: str) -> Optional[Dict[str, Any]]:
    parsed = urllib.parse.urlparse(uri)
    if not parsed.hostname or not parsed.username:
        return None

    params = parse_query_params(parsed.query)
    port = parsed.port or 443
    uuid = parsed.username
    password = parsed.password or ""
    sni = params.get("sni", parsed.hostname)

    return {
        "type": "tuic",
        "tag": tag,
        "server": parsed.hostname,
        "server_port": port,
        "uuid": uuid,
        "password": password,
        "tls": {
            "enabled": True,
            "server_name": sni,
            "insecure": params.get("allow_insecure", "0") in ["1", "true"],
            "alpn": [params.get("alpn", "h3")]
        }
    }

def _socks_to_singbox(uri: str, tag: str, version: str = "5") -> Optional[Dict[str, Any]]:
    parsed = urllib.parse.urlparse(uri)
    if not parsed.hostname or not parsed.port:
        return None
    outbound: Dict[str, Any] = {
        "type": "socks",
        "tag": tag,
        "server": parsed.hostname,
        "server_port": parsed.port,
        "version": version
    }
    if parsed.username:
        outbound["username"] = urllib.parse.unquote(parsed.username)
    if parsed.password:
        outbound["password"] = urllib.parse.unquote(parsed.password)
    return outbound

def _http_to_singbox(uri: str, tag: str) -> Optional[Dict[str, Any]]:
    parsed = urllib.parse.urlparse(uri)
    if not parsed.hostname or not parsed.port:
        return None
    outbound: Dict[str, Any] = {
        "type": "http",
        "tag": tag,
        "server": parsed.hostname,
        "server_port": parsed.port
    }
    if parsed.scheme.lower() == "https":
        outbound["tls"] = {
            "enabled": True,
            "server_name": parsed.hostname
        }
    if parsed.username:
        outbound["username"] = urllib.parse.unquote(parsed.username)
    if parsed.password:
        outbound["password"] = urllib.parse.unquote(parsed.password)
    return outbound

async def fetch_tg_channel_messages(channel: str, limit: int = 50) -> List[str]:
    base_url = f"https://t.me/s/{channel}"
    collected_html: List[str] = []
    current_url = base_url

    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
        "Accept-Language": "en-US,en;q=0.9"
    }

    async with aiohttp.ClientSession(headers=headers) as session:
        while len(collected_html) < limit:
            try:
                async with session.get(current_url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status != 200:
                        break
                    text = await resp.text()
                    soup = BeautifulSoup(text, "html.parser")
                    messages = soup.find_all("div", class_="tgme_widget_message")
                    if not messages:
                        break

                    for msg in messages:
                        text_div = msg.find("div", class_="tgme_widget_message_text")
                        if text_div:
                            collected_html.append(text_div.decode_contents())

                    prev_link = soup.find("link", dict(rel="prev"))
                    if not prev_link:
                        prev_link = soup.find("a", class_="js-messages_more")
                    if not prev_link:
                        prev_link = soup.find("a", dict(rel="prev"))

                    if prev_link and "href" in prev_link.attrs:
                        current_url = "https://t.me" + prev_link["href"]
                    else:
                        break
            except Exception as e:
                logger.debug(f"scrape error @{channel}: {e}")
                break

    return collected_html

def extract_keys_from_html(html_list: List[str]) -> List[str]:
    pattern = re.compile(r'(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic|socks5|socks4|socks)://[^\s<>"\'`]+', re.IGNORECASE)
    raw_keys = []

    for html_text in html_list:
        clean_text = unescape(html_text)
        clean_text = re.sub(r'<br\s*/?>', '\n', clean_text)
        clean_text = re.sub(r'<[^>]+>', ' ', clean_text)

        matches = pattern.findall(clean_text)
        for match in matches:
            key = match.rstrip(".,;!)\"'>")
            if len(key) > 10:
                raw_keys.append(key)

    return list(dict.fromkeys(raw_keys))

async def fetch_proxy_sources(proxy_sources: List[str] = None) -> List[str]:
    if proxy_sources is None:
        proxy_sources = DEFAULT_PROXY_SOURCES

    proxy_keys = []
    headers = {"User-Agent": "Mozilla/5.0"}
    async with aiohttp.ClientSession(headers=headers) as session:
        for u in proxy_sources:
            try:
                async with session.get(u, timeout=aiohttp.ClientTimeout(total=10)) as r:
                    if r.status != 200:
                        continue
                    if u.endswith(".json"):
                        text = await r.text()
                        data = json.loads(text)

                        ru_proxies = [
                            p for p in data 
                            if (p.get("geolocation") or {}).get("country", {}).get("iso_code") == "RU"
                        ]
                        logger.info(f"found {len(ru_proxies)} ru proxies in {u.split('/')[-1]}")
                        for p in ru_proxies:
                            proto = p.get("protocol", "http").lower()
                            if proto not in ["http", "socks4", "socks5"]:
                                continue
                            user = p.get("username")
                            pwd = p.get("password")
                            auth = f"{user}:{pwd}@" if user and pwd else ""
                            proxy_keys.append(f"{proto}://{auth}{p['host']}:{p['port']}")

                        fast_global = sorted(
                            [p for p in data if p.get("timeout", 999) < 0.25 and p not in ru_proxies],
                            key=lambda x: x.get("timeout", 999)
                        )[:60]
                        for p in fast_global:
                            proto = p.get("protocol", "http").lower()
                            if proto not in ["http", "socks4", "socks5"]:
                                continue
                            user = p.get("username")
                            pwd = p.get("password")
                            auth = f"{user}:{pwd}@" if user and pwd else ""
                            proxy_keys.append(f"{proto}://{auth}{p['host']}:{p['port']}")
            except Exception as e:
                logger.warning(f"proxy source error {u}: {e}")

    logger.info(f"collected {len(proxy_keys)} proxy candidates")
    return proxy_keys

async def fetch_all_sources(tg_channels: List[str] = None, raw_sources: List[str] = None, msgs_per_channel: int = 40) -> List[str]:
    if tg_channels is None:
        tg_channels = DEFAULT_TG_CHANNELS
    if raw_sources is None:
        raw_sources = DEFAULT_RAW_SOURCES

    all_keys = []
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"}

    for ch in tg_channels:
        try:
            msgs = await fetch_tg_channel_messages(ch, limit=msgs_per_channel)
            keys = extract_keys_from_html(msgs)
            logger.info(f"@{ch}: {len(keys)} keys from {len(msgs)} posts")
            all_keys.extend(keys)
        except Exception as e:
            logger.warning(f"channel error @{ch}: {e}")

    async with aiohttp.ClientSession(headers=headers) as session:
        for u in raw_sources:
            try:
                async with session.get(u, timeout=aiohttp.ClientTimeout(total=8)) as r:
                    content = await r.read()
                    raw_str = content.decode("utf-8", errors="ignore")
                    if any(p in raw_str for p in ["vless://", "vmess://", "ss://", "trojan://", "hy2://", "hysteria2://"]):
                        decoded = raw_str
                    else:
                        try:
                            decoded = base64.b64decode(content).decode("utf-8", errors="ignore")
                        except Exception:
                            decoded = raw_str

                    lines = [
                        l.strip() for l in decoded.splitlines() 
                        if any(l.strip().startswith(p) for p in [
                            "vless://", "hysteria2://", "hy2://", "trojan://", "ss://", "vmess://", "tuic://",
                            "socks5://", "socks4://", "socks://", "http://", "https://"
                        ])
                    ]

                    take_count = 25 if ("country/" in u or "country_proxies" in u) else 80
                    logger.info(f"{u.split('/')[-1]}: {len(lines)} keys (took {min(len(lines), take_count)})")
                    all_keys.extend(lines[:take_count])
            except Exception as e:
                logger.warning(f"source error {u}: {e}")

    try:
        proxies = await fetch_proxy_sources()
        all_keys.extend(proxies)
    except Exception as e:
        logger.warning(f"proxy error: {e}")

    unique = list(dict.fromkeys(all_keys))
    logger.info(f"total unique keys: {len(unique)}")
    return unique
