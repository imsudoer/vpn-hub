# vpn-hub

Automated VPN subscription aggregator and health-checker. Collects public xray and v2ray configs from Telegram channels and GitHub sources, tests latency and throughput with sing-box, resolves GeoIP exits, and exports clean subscriptions for Clash, Sing-box, and standard v2ray clients.

Runs serverless via GitHub Actions and GitHub Pages.

## Subscription Endpoints

Static subscription links served from GitHub Pages:

| Format | Client | URL |
|---|---|---|
| Base64 | v2rayNG, Streisand, NekoBox, Happ | `https://imsudoer.github.io/vpn-hub/sub.txt` |
| Raw URIs | Generic / manual import | `https://imsudoer.github.io/vpn-hub/raw.txt` |
| Clash Meta | Clash Verge Rev, Mihomo Party, Clash for Android | `https://imsudoer.github.io/vpn-hub/clash.yaml` |
| Sing-box | Sing-box, Karing, GUI.for.SingBox | `https://imsudoer.github.io/vpn-hub/singbox.json` |
| Clash (Bypass RU) | Clash with direct rules for Russian services | `https://imsudoer.github.io/vpn-hub/clash-bypass-ru.yaml` |
| Sing-box (Bypass RU) | Sing-box with direct rules for Russian services | `https://imsudoer.github.io/vpn-hub/singbox-bypass-ru.json` |
| Reality only | VLESS Reality nodes | `https://imsudoer.github.io/vpn-hub/dpi/reality.txt` |
| Country shards | Sharded by ISO-2 country code | `https://imsudoer.github.io/vpn-hub/country/{code}.txt` |

Country codes available: ru, de, nl, us, gb, fr, sg, jp, kr, and others detected in the registry.

## Filter Query Parameters

When using Cloudflare Worker (worker/worker.js) or the local backend server, dynamic query parameters are supported:

- c: country filter, comma-separated (e.g. c=de,nl or c=ru).
- p: protocol filter (e.g. p=vless,hy2).
- max: max latency in ms (e.g. max=150).
- min_speed: minimum bandwidth in Mbps (e.g. min_speed=10).
- dpi: censorship filter (dpi=reality or dpi=high).
- l: node limit (default 100, l=all for no limit).
- route: split tunneling mode (route=bypass_ru).
- proxies: include open http/socks proxies (proxies=1, off by default).

Example:
https://free.vpn.onlysq.me/sub?c=de,nl&max=150&p=vless&l=30&route=bypass_ru

## How It Works

1. parser.py scrapes configs from 14 Telegram channels and 40+ country subscription shards.
2. checker.py launches concurrent sing-box test instances, verifies HTTPS connectivity to Cloudflare and Google, tests actual download throughput, and tags exit country via GeoIP.
3. scripts/build.py outputs filtered static files, country shards, routing rules, and frontend files into dist/.
4. GitHub Actions runs hourly via cron, downloads sing-box, executes the build, and deploys dist/ directly to GitHub Pages.

## Project Structure

```
.github/
  workflows/
    update.yml
frontend/
  assets/
  css/
  js/
  index.html
scripts/
  build.py
worker/
  worker.js
checker.py
parser.py
server.py
requirements.txt
```

## Running Locally

Requirements: Python 3.10+, sing-box binary in PATH or working directory.

```bash
pip install -r requirements.txt

# Run scraping, testing and static build
python scripts/build.py

# Or start the local server on port 18080
python server.py
```
