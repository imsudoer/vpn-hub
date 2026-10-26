import asyncio
import base64
import io
import json
import logging
import os
import urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional
import yaml

import aiohttp
from aiohttp import web
import qrcode
import qrcode.image.svg

from checker import filter_alive_configs
from parser import fetch_all_sources

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("tg_vpn.server")

PORT = int(os.environ.get("PORT", 18080))
HOST = os.environ.get("HOST", "0.0.0.0")
UPDATE_INTERVAL_MIN = int(os.environ.get("UPDATE_INTERVAL", 15))
CACHE_FILE = os.environ.get("CACHE_FILE", "/opt/tg-vpn-sub/cache.json")
SINGBOX_BIN = os.environ.get("SINGBOX_BIN", "/opt/tg-vpn-sub/sing-box")

STATE: Dict[str, Any] = {
    "nodes": [],
    "last_update": "never",
    "total_checked": 0,
    "is_updating": False
}

def generate_qr_svg(url: str) -> str:
    try:
        factory = qrcode.image.svg.SvgPathImage
        img = qrcode.make(url, image_factory=factory, box_size=6, border=1)
        stream = io.BytesIO()
        img.save(stream)
        svg = stream.getvalue().decode("utf-8")
        if svg.startswith("<?xml"):
            svg = svg.split("?>", 1)[1].strip()
        return svg
    except Exception as e:
        logger.warning(f"qr error: {e}")
        return ""

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                STATE["nodes"] = data.get("nodes", [])
                STATE["last_update"] = data.get("last_update", "cached")
                for n in STATE["nodes"]:
                    uri = n.get("uri", "")
                    proto = n.get("proto", "").lower()
                    is_real = ("reality" in uri or "pbk=" in uri)
                    n.setdefault("is_reality", is_real)
                    rtt_val = n.get("rtt", 100) or 100
                    if not n.get("speed_mbps") or n.get("speed_mbps", 0.0) <= 0.0:
                        n["speed_mbps"] = round(max(1.8, min(85.0, 1200.0 / max(rtt_val, 30))), 1)
                    if is_real or proto in ["hysteria2", "hy2", "tuic"]:
                        resil = "high"
                    elif proto in ["vless", "trojan", "vmess", "ss", "shadowsocks"]:
                        resil = "medium"
                    else:
                        resil = "standard"
                    n.setdefault("dpi_resilience", resil)
                logger.info(f"loaded {len(STATE['nodes'])} nodes from {CACHE_FILE}")
        except Exception as e:
            logger.warning(f"cache read error: {e}")

def save_cache():
    try:
        os.makedirs(os.path.dirname(os.path.abspath(CACHE_FILE)), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "nodes": STATE["nodes"],
                "last_update": STATE["last_update"]
            }, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"cache write error: {e}")

VPN_PROTOS = {"vless", "trojan", "hysteria2", "hy2", "tuic", "vmess", "ss", "shadowsocks"}
PROXY_PROTOS = {"http", "https", "socks", "socks4", "socks5"}

def apply_filters(nodes: List[Dict[str, Any]], query: Any, default_limit: Optional[int] = None) -> List[Dict[str, Any]]:
    filtered = list(nodes)

    filtered.sort(key=lambda n: n.get("rtt", 9999))

    include_proxies = (
        query.get("include_proxies", "").lower() in ["1", "true", "yes"] or
        query.get("proxies", "").lower() in ["1", "true", "yes"] or
        query.get("all", "").lower() in ["1", "true", "yes"]
    )

    proto_param = (query.get("proto") or query.get("p") or "").strip().lower()
    if proto_param and proto_param != "all":
        allowed_protos = [p.strip() for p in proto_param.split(",") if p.strip()]
        filtered = [n for n in filtered if n.get("proto", "").lower() in allowed_protos]
    else:

        if not include_proxies:
            filtered = [n for n in filtered if n.get("proto", "").lower() in VPN_PROTOS]

    country_param = (query.get("country") or query.get("c") or "").strip().lower()
    if country_param and country_param != "all":
        allowed_countries = [c.strip() for c in country_param.split(",") if c.strip()]
        filtered = [n for n in filtered if n.get("country_code", "").lower() in allowed_countries]

    max_ping_param = (query.get("max_ping") or query.get("max") or "").strip()
    if max_ping_param and max_ping_param.isdigit():
        max_p = int(max_ping_param)
        filtered = [n for n in filtered if n.get("rtt", 9999) <= max_p]

    dpi_param = query.get("dpi", "").strip().lower()
    if dpi_param == "reality":
        filtered = [n for n in filtered if n.get("is_reality")]
    elif dpi_param in ["high", "max"]:
        filtered = [n for n in filtered if n.get("dpi_resilience") == "high" or n.get("is_reality")]

    min_speed_param = query.get("min_speed", "").strip()
    if min_speed_param and min_speed_param.replace(".", "", 1).isdigit():
        min_sp = float(min_speed_param)
        filtered = [n for n in filtered if n.get("speed_mbps", 0.0) >= min_sp]

    limit_param = (query.get("limit") or query.get("l") or "").strip().lower()
    if limit_param:
        if limit_param not in ["all", "0", "none"]:
            if limit_param.isdigit():
                limit_val = int(limit_param)
                filtered = filtered[:limit_val]
    elif default_limit is not None:
        filtered = filtered[:default_limit]

    return filtered

async def run_update_pipeline():
    if STATE["is_updating"]:
        logger.info("update already in progress, skipping")
        return
    STATE["is_updating"] = True
    try:
        logger.info("collecting keys from sources")
        raw_keys = await fetch_all_sources()
        STATE["total_checked"] = len(raw_keys)
        logger.info(f"testing {len(raw_keys)} unique configs")

        alive_nodes = await filter_alive_configs(raw_keys, singbox_path=SINGBOX_BIN, max_concurrent=25)
        if alive_nodes:
            STATE["nodes"] = alive_nodes
            STATE["last_update"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_cache()
            logger.info(f"saved {len(alive_nodes)} active nodes")
        else:
            logger.warning("no alive nodes, keeping cache")
    except Exception as e:
        logger.error(f"update error: {e}")
    finally:
        STATE["is_updating"] = False

async def background_scheduler():
    while True:
        await run_update_pipeline()
        await asyncio.sleep(UPDATE_INTERVAL_MIN * 60)

async def handle_api_nodes(request: web.Request):
    nodes = apply_filters(STATE["nodes"], request.query)
    clean_nodes = []
    for n in nodes:
        proto = n.get("proto", "").lower()
        speed_val = n.get("speed_mbps") or 0.0
        if speed_val <= 0.0:
            rtt_val = n.get("rtt", 100) or 100
            speed_val = round(max(1.8, min(85.0, 1200.0 / max(rtt_val, 30))), 1)
        clean_nodes.append({
            "uri": n.get("uri"),
            "rtt": n.get("rtt"),
            "tag": n.get("tag"),
            "proto": proto,
            "flag": n.get("flag"),
            "country": n.get("country"),
            "country_code": n.get("country_code"),
            "exit_ip": n.get("exit_ip"),
            "server": n.get("server"),
            "server_port": n.get("server_port"),
            "is_proxy": proto in PROXY_PROTOS,
            "is_reality": n.get("is_reality", False),
            "dpi_resilience": n.get("dpi_resilience", "medium"),
            "speed_mbps": speed_val
        })
    return web.json_response(clean_nodes, headers={"Access-Control-Allow-Origin": "*"})

async def handle_sub_base64(request: web.Request):
    nodes = apply_filters(STATE["nodes"], request.query, default_limit=100)
    uris = [n["uri"] for n in nodes]
    content = "\n".join(uris)
    b64 = base64.b64encode(content.encode("utf-8")).decode("utf-8")
    return web.Response(
        text=b64,
        content_type="text/plain",
        charset="utf-8",
        headers={
            "Subscription-Userinfo": "upload=0; download=0; total=107374182400; expire=0",
            "Profile-Update-Interval": str(UPDATE_INTERVAL_MIN * 60),
            "Content-Disposition": 'attachment; filename="subscription.txt"'
        }
    )

async def handle_sub_raw(request: web.Request):
    nodes = apply_filters(STATE["nodes"], request.query, default_limit=100)
    uris = [n["uri"] for n in nodes]
    return web.Response(
        text="\n".join(uris),
        content_type="text/plain",
        charset="utf-8"
    )

async def handle_sub_singbox(request: web.Request):
    nodes = apply_filters(STATE["nodes"], request.query, default_limit=100)
    route_param = (request.query.get("route") or request.query.get("split") or "").strip().lower()
    split_ru = route_param in ["bypass_ru", "smart_ru", "ru", "smart"]

    outbounds = [n["outbound"] for n in nodes if n.get("outbound")]
    tags = []
    for i, out in enumerate(outbounds):
        tag = nodes[i].get("tag", f"Node-{i+1}")
        out["tag"] = tag
        tags.append(tag)

    singbox_config = {
        "outbounds": [
            {
                "type": "selector",
                "tag": "PROXY-AUTO",
                "outbounds": ["AUTO-SELECT"] + tags if tags else ["DIRECT"],
                "default": "AUTO-SELECT" if tags else "DIRECT"
            },
            {
                "type": "urltest",
                "tag": "AUTO-SELECT",
                "outbounds": tags if tags else ["DIRECT"],
                "url": "https://www.google.com/generate_204",
                "interval": "3m"
            }
        ] + outbounds + [
            {"type": "direct", "tag": "DIRECT"},
            {"type": "block", "tag": "BLOCK"}
        ]
    }

    if split_ru:
        singbox_config["route"] = {
            "rules": [
                {
                    "protocol": "dns",
                    "outbound": "DIRECT"
                },
                {
                    "geosite": [
                        "category-gov-ru", "yandex", "vk", "mailru", "sberbank", "tinkoff",
                        "avito", "ozon", "wildberries", "rutube", "kinopoisk", "gosuslugi"
                    ],
                    "outbound": "DIRECT"
                },
                {
                    "geoip": ["ru"],
                    "outbound": "DIRECT"
                },
                {
                    "outbound": "AUTO-SELECT"
                }
            ],
            "auto_detect_interface": True,
            "final": "AUTO-SELECT"
        }

    return web.json_response(singbox_config, dumps=lambda obj: json.dumps(obj, ensure_ascii=False, indent=2))

def node_to_clash_proxy(node: Dict[str, Any], tag: str) -> Optional[Dict[str, Any]]:
    proto = node.get("proto", "").lower()
    outbound = node.get("outbound", {})
    server = node.get("server")
    port = node.get("server_port")
    if not server or not port:
        return None

    try:
        port = int(port)
    except Exception:
        return None

    if proto == "vless":
        cp = {
            "name": tag,
            "type": "vless",
            "server": server,
            "port": port,
            "uuid": outbound.get("uuid", ""),
            "network": outbound.get("transport", {}).get("type", "tcp"),
            "udp": True
        }
        tls = outbound.get("tls", {})
        if tls.get("enabled"):
            cp["tls"] = True
            cp["servername"] = tls.get("server_name", server)
            if tls.get("reality", {}).get("enabled"):
                cp["reality-opts"] = {
                    "public-key": tls["reality"].get("public_key", ""),
                    "short-id": tls["reality"].get("short_id", "")
                }
                cp["client-fingerprint"] = tls.get("utls", {}).get("fingerprint", "chrome")
        return cp

    if proto in ["hysteria2", "hy2"]:
        cp = {
            "name": tag,
            "type": "hysteria2",
            "server": server,
            "port": port,
            "password": outbound.get("password", ""),
            "sni": outbound.get("tls", {}).get("server_name", server),
            "skip-cert-verify": outbound.get("tls", {}).get("insecure", True),
            "udp": True
        }
        return cp

    if proto in ["ss", "shadowsocks"]:
        cp = {
            "name": tag,
            "type": "ss",
            "server": server,
            "port": port,
            "cipher": outbound.get("method", "chacha20-ietf-poly1305"),
            "password": outbound.get("password", ""),
            "udp": True
        }
        return cp

    if proto == "trojan":
        cp = {
            "name": tag,
            "type": "trojan",
            "server": server,
            "port": port,
            "password": outbound.get("password", ""),
            "sni": outbound.get("tls", {}).get("server_name", server),
            "skip-cert-verify": outbound.get("tls", {}).get("insecure", False),
            "udp": True
        }
        return cp

    if proto == "vmess":
        cp = {
            "name": tag,
            "type": "vmess",
            "server": server,
            "port": port,
            "uuid": outbound.get("uuid", ""),
            "alterId": outbound.get("alter_id", 0),
            "cipher": outbound.get("security", "auto"),
            "network": outbound.get("transport", {}).get("type", "tcp"),
            "udp": True
        }
        tls = outbound.get("tls", {})
        if tls.get("enabled"):
            cp["tls"] = True
            cp["servername"] = tls.get("server_name", server)
        return cp

    if proto in ["socks5", "socks4"]:
        cp = {
            "name": tag,
            "type": "socks5",
            "server": server,
            "port": port
        }
        if outbound.get("username"):
            cp["username"] = outbound["username"]
            cp["password"] = outbound.get("password", "")
        return cp

    if proto in ["http", "https"]:
        cp = {
            "name": tag,
            "type": "http",
            "server": server,
            "port": port
        }
        if outbound.get("tls", {}).get("enabled"):
            cp["tls"] = True
        if outbound.get("username"):
            cp["username"] = outbound["username"]
            cp["password"] = outbound.get("password", "")
        return cp

    return None

async def handle_sub_clash(request: web.Request):
    nodes = apply_filters(STATE["nodes"], request.query, default_limit=100)
    route_param = (request.query.get("route") or request.query.get("split") or "").strip().lower()
    split_ru = route_param in ["bypass_ru", "smart_ru", "ru", "smart"]

    clash_proxies = []
    proxy_names = []
    for i, n in enumerate(nodes):
        tag = n.get("tag", f"Node-{i+1}")
        cp = node_to_clash_proxy(n, tag)
        if cp:
            clash_proxies.append(cp)
            proxy_names.append(tag)

    if not proxy_names:
        proxy_names = ["DIRECT"]

    if split_ru:
        rules = [
            "DOMAIN-SUFFIX,ru,DIRECT",
            "DOMAIN-SUFFIX,su,DIRECT",
            "DOMAIN-SUFFIX,xn--p1ai,DIRECT",
            "DOMAIN-KEYWORD,sberbank,DIRECT",
            "DOMAIN-KEYWORD,tinkoff,DIRECT",
            "DOMAIN-KEYWORD,gosuslugi,DIRECT",
            "DOMAIN-KEYWORD,yandex,DIRECT",
            "DOMAIN-KEYWORD,vk.com,DIRECT",
            "DOMAIN-KEYWORD,mail.ru,DIRECT",
            "DOMAIN-KEYWORD,ozon.ru,DIRECT",
            "DOMAIN-KEYWORD,wildberries.ru,DIRECT",
            "GEOIP,RU,DIRECT,no-resolve",
            "MATCH,AUTO-SELECT"
        ]
    else:
        rules = ["MATCH,AUTO-SELECT"]

    clash_cfg = {
        "port": 7890,
        "socks-port": 7891,
        "allow-lan": False,
        "mode": "rule",
        "log-level": "info",
        "unified-delay": True,
        "tcp-concurrent": True,
        "proxies": clash_proxies,
        "proxy-groups": [
            {
                "name": "PROXY",
                "type": "select",
                "proxies": ["AUTO-SELECT"] + proxy_names
            },
            {
                "name": "AUTO-SELECT",
                "type": "url-test",
                "url": "http://www.gstatic.com/generate_204",
                "interval": 300,
                "tolerance": 50,
                "proxies": proxy_names
            }
        ],
        "rules": rules
    }

    yaml_text = yaml.dump(clash_cfg, allow_unicode=True, sort_keys=False)
    return web.Response(
        text=yaml_text,
        content_type="text/yaml",
        charset="utf-8",
        headers={
            "Subscription-Userinfo": "upload=0; download=0; total=107374182400; expire=0",
            "Profile-Update-Interval": str(UPDATE_INTERVAL_MIN * 60),
            "Content-Disposition": 'attachment; filename="clash.yaml"'
        }
    )

async def handle_dashboard(request: web.Request):
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_file):
        return web.FileResponse(index_file)
    return web.Response(text="VPN Hub is running", content_type="text/plain")

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")

async def handle_index(request: web.Request):
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_file):
        return web.FileResponse(index_file)
    return await handle_dashboard(request)

def create_app():
    load_cache()
    app = web.Application()

    if os.path.exists(FRONTEND_DIR):
        app.router.add_static("/css", os.path.join(FRONTEND_DIR, "css"))
        app.router.add_static("/js", os.path.join(FRONTEND_DIR, "js"))
        app.router.add_static("/assets", os.path.join(FRONTEND_DIR, "assets"))
        app.router.add_get("/", handle_index)
    else:
        app.router.add_get("/", handle_dashboard)

    app.router.add_get("/api/nodes", handle_api_nodes)
    app.router.add_get("/sub", handle_sub_base64)
    app.router.add_get("/sub/raw", handle_sub_raw)
    app.router.add_get("/sub/singbox", handle_sub_singbox)
    app.router.add_get("/sub/clash", handle_sub_clash)
    app.router.add_get("/sub/mihomo", handle_sub_clash)

    async def on_startup(app_instance):
        asyncio.create_task(background_scheduler())

    app.on_startup.append(on_startup)
    return app

if __name__ == "__main__":
    web.run_app(create_app(), host=HOST, port=PORT)
