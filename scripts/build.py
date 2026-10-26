import os
import sys
import json
import base64
import shutil
import asyncio
import logging
from typing import Any, Dict, List, Optional
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parser import fetch_all_sources
from checker import filter_alive_configs

try:
    import yaml
except ImportError:
    yaml = None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("build")

SINGBOX_BIN = os.environ.get("SINGBOX_BIN", "./sing-box")
DIST_DIR = os.environ.get("DIST_DIR", "dist")
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", "frontend")
CUSTOM_DOMAIN = os.environ.get("CUSTOM_DOMAIN", "free.vpn.onlysq.me")


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

    elif proto in ["hysteria2", "hy2"]:
        return {
            "name": tag,
            "type": "hysteria2",
            "server": server,
            "port": port,
            "password": outbound.get("password", ""),
            "sni": outbound.get("tls", {}).get("server_name", server),
            "skip-cert-verify": outbound.get("tls", {}).get("insecure", False),
            "udp": True
        }

    elif proto == "trojan":
        return {
            "name": tag,
            "type": "trojan",
            "server": server,
            "port": port,
            "password": outbound.get("password", ""),
            "sni": outbound.get("tls", {}).get("server_name", server),
            "skip-cert-verify": outbound.get("tls", {}).get("insecure", False),
            "udp": True
        }

    elif proto == "ss":
        return {
            "name": tag,
            "type": "ss",
            "server": server,
            "port": port,
            "cipher": outbound.get("method", "aes-128-gcm"),
            "password": outbound.get("password", ""),
            "udp": True
        }

    elif proto == "vmess":
        return {
            "name": tag,
            "type": "vmess",
            "server": server,
            "port": port,
            "uuid": outbound.get("uuid", ""),
            "alterId": outbound.get("alter_id", 0),
            "cipher": outbound.get("security", "auto"),
            "network": outbound.get("transport", {}).get("type", "tcp"),
            "tls": outbound.get("tls", {}).get("enabled", False),
            "servername": outbound.get("tls", {}).get("server_name", server),
            "udp": True
        }

    elif proto in ["socks5", "socks4"]:
        return {
            "name": tag,
            "type": "socks5" if proto == "socks5" else "socks4",
            "server": server,
            "port": port,
            "udp": True
        }

    elif proto in ["http", "https"]:
        return {
            "name": tag,
            "type": "http",
            "server": server,
            "port": port,
            "tls": proto == "https"
        }

    return None


def build_clash_yaml(nodes: List[Dict[str, Any]], split_ru: bool = False) -> str:
    clash_proxies = []
    proxy_names = []
    seen_names = set()

    for i, n in enumerate(nodes):
        raw_tag = n.get("tag", f"Node-{i+1}").replace(":", " ").replace('"', '')
        tag = raw_tag
        c = 1
        while tag in seen_names:
            c += 1
            tag = f"{raw_tag} ({c})"
        seen_names.add(tag)

        cp = node_to_clash_proxy(n, tag)
        if cp:
            clash_proxies.append(cp)
            proxy_names.append(tag)

    if not clash_proxies:
        dummy = {
            "name": "DIRECT-FALLBACK",
            "type": "socks5",
            "server": "127.0.0.1",
            "port": 1080
        }
        clash_proxies = [dummy]
        proxy_names = ["DIRECT-FALLBACK"]

    groups = [
        {
            "name": "PROXY-AUTO",
            "type": "select",
            "proxies": ["AUTO-SELECT"] + proxy_names
        },
        {
            "name": "AUTO-SELECT",
            "type": "url-test",
            "proxies": proxy_names,
            "url": "https://www.google.com/generate_204",
            "interval": 180,
            "tolerance": 50
        }
    ]

    rules = []
    if split_ru:
        rules.extend([
            "GEOSITE,category-gov-ru,DIRECT",
            "GEOSITE,yandex,DIRECT",
            "GEOSITE,vk,DIRECT",
            "GEOSITE,mailru,DIRECT",
            "GEOSITE,sberbank,DIRECT",
            "GEOSITE,tinkoff,DIRECT",
            "GEOSITE,avito,DIRECT",
            "GEOSITE,ozon,DIRECT",
            "GEOSITE,wildberries,DIRECT",
            "GEOSITE,rutube,DIRECT",
            "GEOSITE,gosuslugi,DIRECT",
            "GEOIP,RU,DIRECT"
        ])

    rules.extend([
        "GEOIP,LAN,DIRECT",
        "MATCH,PROXY-AUTO"
    ])

    clash_cfg = {
        "port": 7890,
        "socks-port": 7891,
        "allow-lan": False,
        "mode": "rule",
        "log-level": "info",
        "proxies": clash_proxies,
        "proxy-groups": groups,
        "rules": rules
    }

    if yaml:
        return yaml.dump(clash_cfg, allow_unicode=True, sort_keys=False)
    return json.dumps(clash_cfg, indent=2)


def build_singbox_json(nodes: List[Dict[str, Any]], split_ru: bool = False) -> str:
    outbounds = [n["outbound"] for n in nodes if n.get("outbound")]
    tags = []
    for i, out in enumerate(outbounds):
        tag = nodes[i].get("tag", f"Node-{i+1}")
        out["tag"] = tag
        tags.append(tag)

    cfg = {
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
        cfg["route"] = {
            "rules": [
                {"protocol": "dns", "outbound": "DIRECT"},
                {
                    "geosite": [
                        "category-gov-ru", "yandex", "vk", "mailru", "sberbank", "tinkoff",
                        "avito", "ozon", "wildberries", "rutube", "kinopoisk", "gosuslugi"
                    ],
                    "outbound": "DIRECT"
                },
                {"geoip": ["ru"], "outbound": "DIRECT"},
                {"outbound": "AUTO-SELECT"}
            ],
            "auto_detect_interface": True,
            "final": "AUTO-SELECT"
        }

    return json.dumps(cfg, ensure_ascii=False, indent=2)


def build_base64_sub(nodes: List[Dict[str, Any]]) -> str:
    uris = [n["uri"] for n in nodes]
    raw = "\n".join(uris)
    return base64.b64encode(raw.encode("utf-8")).decode("utf-8")


def build_raw_sub(nodes: List[Dict[str, Any]]) -> str:
    uris = [n["uri"] for n in nodes]
    return "\n".join(uris)


async def main():
    logger.info("starting build")

    candidates = await fetch_all_sources()
    logger.info(f"collected {len(candidates)} candidates")

    singbox_bin = SINGBOX_BIN
    if not os.path.exists(singbox_bin):
        found = shutil.which("sing-box")
        if found:
            singbox_bin = found
        else:
            logger.error(f"binary not found: {singbox_bin}")
            sys.exit(1)

    alive_nodes = await filter_alive_configs(candidates, singbox_path=singbox_bin, max_concurrent=35)
    logger.info(f"active nodes: {len(alive_nodes)}")

    if not alive_nodes:
        logger.warning("no alive nodes found")
        sys.exit(1)

    countries = Counter(n.get("country_code", "??").upper() for n in alive_nodes)
    protocols = Counter(n.get("proto", "??").upper() for n in alive_nodes)
    speeds = [n.get("speed_mbps", 0) for n in alive_nodes if n.get("speed_mbps", 0) > 0]

    logger.info(f"countries: {len(countries)}")
    logger.info(f"protocols: {dict(protocols)}")
    if speeds:
        logger.info(f"speed: min={min(speeds):.1f}, avg={sum(speeds)/len(speeds):.1f}, max={max(speeds):.1f}")

    os.makedirs(DIST_DIR, exist_ok=True)
    os.makedirs(os.path.join(DIST_DIR, "country"), exist_ok=True)
    os.makedirs(os.path.join(DIST_DIR, "dpi"), exist_ok=True)

    if os.path.exists(FRONTEND_DIR):
        for item in os.listdir(FRONTEND_DIR):
            s = os.path.join(FRONTEND_DIR, item)
            d = os.path.join(DIST_DIR, item)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)

    with open(os.path.join(DIST_DIR, ".nojekyll"), "w") as f:
        f.write("")

    if CUSTOM_DOMAIN:
        with open(os.path.join(DIST_DIR, "CNAME"), "w", encoding="utf-8") as f:
            f.write(CUSTOM_DOMAIN.strip() + "\n")

    frontend_nodes = []
    for n in alive_nodes:
        frontend_nodes.append({
            "uri": n.get("uri"),
            "rtt": n.get("rtt"),
            "speed_mbps": n.get("speed_mbps", 0.0),
            "tag": n.get("tag"),
            "proto": n.get("proto"),
            "flag": n.get("flag"),
            "country": n.get("country"),
            "country_code": n.get("country_code"),
            "exit_ip": n.get("exit_ip"),
            "server": n.get("server"),
            "server_port": n.get("server_port"),
            "is_reality": n.get("is_reality", False),
            "dpi_resilience": n.get("dpi_resilience", "standard"),
            "is_proxy": n.get("proto") in ["socks5", "socks4", "http", "https"]
        })

    with open(os.path.join(DIST_DIR, "nodes.json"), "w", encoding="utf-8") as f:
        json.dump(frontend_nodes, f, ensure_ascii=False, indent=2)

    vpn_nodes = [n for n in alive_nodes if n.get("proto") not in ["socks5", "socks4", "http", "https"]]
    top100_vpn = vpn_nodes[:100]

    with open(os.path.join(DIST_DIR, "sub.txt"), "w", encoding="utf-8") as f:
        f.write(build_base64_sub(top100_vpn))

    with open(os.path.join(DIST_DIR, "raw.txt"), "w", encoding="utf-8") as f:
        f.write(build_raw_sub(top100_vpn))

    with open(os.path.join(DIST_DIR, "clash.yaml"), "w", encoding="utf-8") as f:
        f.write(build_clash_yaml(top100_vpn, split_ru=False))

    with open(os.path.join(DIST_DIR, "singbox.json"), "w", encoding="utf-8") as f:
        f.write(build_singbox_json(top100_vpn, split_ru=False))

    with open(os.path.join(DIST_DIR, "clash-bypass-ru.yaml"), "w", encoding="utf-8") as f:
        f.write(build_clash_yaml(top100_vpn, split_ru=True))

    with open(os.path.join(DIST_DIR, "singbox-bypass-ru.json"), "w", encoding="utf-8") as f:
        f.write(build_singbox_json(top100_vpn, split_ru=True))

    reality_nodes = [n for n in alive_nodes if n.get("is_reality")][:100]
    if reality_nodes:
        with open(os.path.join(DIST_DIR, "dpi", "reality.txt"), "w", encoding="utf-8") as f:
            f.write(build_base64_sub(reality_nodes))
        with open(os.path.join(DIST_DIR, "dpi", "reality.yaml"), "w", encoding="utf-8") as f:
            f.write(build_clash_yaml(reality_nodes, split_ru=False))

    high_dpi = [n for n in alive_nodes if n.get("dpi_resilience") == "high"][:100]
    if high_dpi:
        with open(os.path.join(DIST_DIR, "dpi", "high.txt"), "w", encoding="utf-8") as f:
            f.write(build_base64_sub(high_dpi))
        with open(os.path.join(DIST_DIR, "dpi", "high.yaml"), "w", encoding="utf-8") as f:
            f.write(build_clash_yaml(high_dpi, split_ru=False))

    for cc, count in countries.items():
        if not cc or cc == "??":
            continue
        c_nodes = [n for n in alive_nodes if n.get("country_code", "").upper() == cc][:100]
        if not c_nodes:
            continue
        cc_lower = cc.lower()
        with open(os.path.join(DIST_DIR, "country", f"{cc_lower}.txt"), "w", encoding="utf-8") as f:
            f.write(build_base64_sub(c_nodes))
        with open(os.path.join(DIST_DIR, "country", f"{cc_lower}.yaml"), "w", encoding="utf-8") as f:
            f.write(build_clash_yaml(c_nodes, split_ru=False))
        with open(os.path.join(DIST_DIR, "country", f"{cc_lower}.json"), "w", encoding="utf-8") as f:
            f.write(build_singbox_json(c_nodes, split_ru=False))

    logger.info("build completed")


if __name__ == "__main__":
    asyncio.run(main())
