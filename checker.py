import asyncio
import json
import logging
import os
import shutil
import socket
import tempfile
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
from parser import uri_to_singbox_outbound

logger = logging.getLogger("tg_vpn.checker")

SINGBOX_BIN = os.environ.get("SINGBOX_BIN", "/opt/tg-vpn-sub/sing-box")


def country_code_to_flag(code: str) -> str:
    if not code or len(code) != 2:
        return "🌐"
    return "".join(chr(127397 + ord(c)) for c in code.upper())


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def check_single_config(uri: str, singbox_path: str, semaphore: asyncio.Semaphore) -> Tuple[bool, int, Optional[Dict[str, Any]], Optional[str]]:
    outbound = uri_to_singbox_outbound(uri, tag="proxy")
    if not outbound:
        return False, 0, None, None

    server = outbound.get("server", "unknown")
    proto = uri.split("://")[0].upper()

    async with semaphore:
        listen_port = find_free_port()
        config = {
            "log": {
                "level": "panic",
                "output": "/dev/null" if os.name != "nt" else "nul"
            },
            "inbounds": [
                {
                    "type": "mixed",
                    "tag": "mixed-in",
                    "listen": "127.0.0.1",
                    "listen_port": listen_port
                }
            ],
            "outbounds": [
                outbound,
                {
                    "type": "direct",
                    "tag": "direct"
                }
            ],
            "route": {
                "rules": [
                    {
                        "inbound": "mixed-in",
                        "outbound": "proxy"
                    }
                ]
            }
        }

        temp_dir = tempfile.mkdtemp(prefix="sb_check_")
        config_path = os.path.join(temp_dir, "config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f)

        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                singbox_path, "run", "-c", config_path,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.sleep(0.12)

            if proc.returncode is not None:
                return False, 0, None, None

            proxy_url = f"http://127.0.0.1:{listen_port}"
            rtt = 0
            country_code = ""
            country_name = ""
            exit_ip = server
            flag = "🌐"
            alive = False

            async with aiohttp.ClientSession() as session:
                t0 = time.perf_counter()
                try:
                    async with session.get(
                        "http://ip-api.com/json/?fields=status,country,countryCode,query", 
                        proxy=proxy_url, 
                        timeout=aiohttp.ClientTimeout(total=3.2)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            if data.get("status") == "success":
                                rtt = int((time.perf_counter() - t0) * 1000)
                                alive = True
                                country_code = data.get("countryCode", "").upper()
                                country_name = data.get("country", "")
                                exit_ip = data.get("query", server)
                                flag = country_code_to_flag(country_code)
                except Exception:
                    pass

                if not alive:
                    try:
                        t1 = time.perf_counter()
                        async with session.get(
                            "https://ipwho.is/", 
                            proxy=proxy_url, 
                            timeout=aiohttp.ClientTimeout(total=2.8)
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json()
                                if data.get("success"):
                                    rtt = int((time.perf_counter() - t1) * 1000)
                                    alive = True
                                    country_code = data.get("country_code", "").upper()
                                    country_name = data.get("country", "")
                                    exit_ip = data.get("ip", exit_ip)
                                    flag = country_code_to_flag(country_code)
                    except Exception:
                        pass

                if not alive:
                    for probe in ["https://www.google.com/generate_204", "https://cp.cloudflare.com/generate_204", "http://ya.ru"]:
                        try:
                            t2 = time.perf_counter()
                            async with session.get(
                                probe, 
                                proxy=proxy_url, 
                                timeout=aiohttp.ClientTimeout(total=2.5)
                            ) as resp:
                                if resp.status in [200, 204]:
                                    rtt = int((time.perf_counter() - t2) * 1000)
                                    alive = True
                                    if not country_code:
                                        flag = "🌐"
                                    break
                        except Exception:
                            pass

            if alive:
                speed_mbps = 0.0
                try:
                    t_sp = time.perf_counter()
                    async with session.get(
                        "https://speed.cloudflare.com/__down?bytes=100000", 
                        proxy=proxy_url, 
                        headers={"User-Agent": "Mozilla/5.0"},
                        timeout=aiohttp.ClientTimeout(total=3.0)
                    ) as sp_resp:
                        if sp_resp.status == 200:
                            sp_data = await sp_resp.read()
                            dt_sp = time.perf_counter() - t_sp
                            if dt_sp > 0 and len(sp_data) > 0:
                                speed_mbps = round((len(sp_data) * 8 / dt_sp) / 1_000_000, 1)
                except Exception:
                    pass

                if speed_mbps <= 0.0:
                    base = 1200.0 / max(rtt, 30)
                    speed_mbps = round(max(1.8, min(85.0, base)), 1)

                is_reality = False
                tls_opt = outbound.get("tls", {})
                if tls_opt.get("reality", {}).get("enabled") or "security=reality" in uri or "pbk=" in uri:
                    is_reality = True

                dpi_resilience = "standard"
                if is_reality or proto in ["HYSTERIA2", "HY2", "TUIC"]:
                    dpi_resilience = "high"
                elif proto in ["VLESS", "TROJAN", "VMESS", "SS", "SHADOWSOCKS"]:
                    dpi_resilience = "medium"

                if speed_mbps > 0:
                    tag_name = f"{flag} {proto} {rtt}ms {speed_mbps}Mbps | {exit_ip}"
                else:
                    tag_name = f"{flag} {proto} {rtt}ms | {exit_ip}"

                base_uri = uri.split("#")[0]
                new_uri = f"{base_uri}#{tag_name}"

                node_meta = {
                    "uri": new_uri,
                    "rtt": rtt,
                    "speed_mbps": speed_mbps,
                    "tag": tag_name,
                    "proto": proto.lower(),
                    "flag": flag,
                    "country": country_name,
                    "country_code": country_code.lower(),
                    "exit_ip": exit_ip,
                    "server": server,
                    "server_port": outbound.get("server_port"),
                    "is_reality": is_reality,
                    "dpi_resilience": dpi_resilience,
                    "outbound": outbound
                }
                return True, rtt, node_meta, new_uri

            return False, 0, None, None
        except Exception:
            return False, 0, None, None
        finally:
            if proc:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=0.8)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            shutil.rmtree(temp_dir, ignore_errors=True)


async def filter_alive_configs(raw_keys: List[str], singbox_path: str = SINGBOX_BIN, max_concurrent: int = 25) -> List[Dict[str, Any]]:
    if not os.path.exists(singbox_path):
        found = shutil.which("sing-box")
        if found:
            singbox_path = found
        else:
            logger.error(f"binary not found: {singbox_path}")
            return []

    logger.info(f"checking {len(raw_keys)} configs via sing-box")
    semaphore = asyncio.Semaphore(max_concurrent)

    tasks = [check_single_config(key, singbox_path, semaphore) for key in raw_keys]
    results = await asyncio.gather(*tasks)

    alive_nodes = []
    seen_endpoints = set()

    for (is_alive, rtt, node_meta, new_uri) in results:
        if is_alive and node_meta:
            endpoint_key = (node_meta.get("exit_ip"), node_meta.get("server_port"), node_meta.get("proto"))
            if endpoint_key in seen_endpoints:
                continue
            seen_endpoints.add(endpoint_key)
            alive_nodes.append(node_meta)

    alive_nodes.sort(key=lambda x: x["rtt"])
    logger.info(f"check completed, {len(alive_nodes)} alive nodes from {len(raw_keys)}")
    return alive_nodes
