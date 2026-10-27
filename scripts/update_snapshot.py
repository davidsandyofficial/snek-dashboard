#!/usr/bin/env python3
"""Regenerate assets/snapshot.js + assets/snapshot.json for the SNEK dashboard.

Sources: CoinGecko (market, history, tickers), GeckoTerminal (pools, trades),
Cardanoscan public token page (holder count, tiers, concentration, top wallets).
Any section that fails keeps its previous value, so the snapshot never goes blank.
"""
import datetime as dt, html, json, os, re, sys, time, urllib.request, zoneinfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JS = os.path.join(ROOT, "assets", "snapshot.js")
OUT_JSON = os.path.join(ROOT, "assets", "snapshot.json")
POLICY = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f"
TOKEN = POLICY + "534e454b"
CG = "https://api.coingecko.com/api/v3"
GT = "https://api.geckoterminal.com/api/v2/networks/cardano"
TZ = zoneinfo.ZoneInfo("America/Chicago")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
NOW = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url, as_json=True, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json" if as_json else "text/html"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode("utf-8", "replace")
            return json.loads(body) if as_json else body
        except Exception as e:  # noqa
            last = e
            time.sleep(4 * (i + 1))
    raise last


def load_prev():
    try:
        with open(OUT_JSON) as f:
            return json.load(f)
    except Exception:
        pass
    try:
        s = open(OUT_JS).read()
        return json.loads(s[s.index("{"): s.rindex("}") + 1])
    except Exception:
        return {}


def market(prev):
    d = get(CG + "/coins/snek?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false")
    m = d["market_data"]
    u = lambda k: (m.get(k) or {}).get("usd")
    try:
        ada = get(CG + "/simple/price?ids=cardano&vs_currencies=usd")["cardano"]["usd"]
    except Exception:
        ada = (prev.get("market") or {}).get("adaUsd")
    mk = {"price": u("current_price"), "adaUsd": ada, "ch24": m.get("price_change_percentage_24h"), "ch7": m.get("price_change_percentage_7d"),
          "ch30": m.get("price_change_percentage_30d"), "ch1y": m.get("price_change_percentage_1y"), "mcap": u("market_cap"), "vol": u("total_volume"),
          "fdv": u("fully_diluted_valuation"), "high24": u("high_24h"), "low24": u("low_24h"), "ath": u("ath"), "athDate": (m.get("ath_date") or {}).get("usd"),
          "atl": u("atl"), "atlDate": (m.get("atl_date") or {}).get("usd"), "circ": m.get("circulating_supply"), "total": m.get("total_supply"),
          "max": m.get("max_supply"), "rank": m.get("market_cap_rank")}
    tick = []
    for t in d.get("tickers", []):
        tgt = t["target"] if len(t["target"]) < 10 else ("ADA" if t["target"] == "0X" else "token")
        tick.append({"market": t["market"]["name"], "pair": "SNEK/" + tgt, "vol": round((t.get("converted_volume") or {}).get("usd") or 0, 2)})
    return mk, tick, m.get("last_updated") or NOW


def ohlcv(addr):
    out = {}
    for cur in ("usd", "token"):
        r = get(f"{GT}/pools/{addr}/ohlcv/hour?aggregate=1&limit=300&currency={cur}")
        out[cur] = sorted(r["data"]["attributes"]["ohlcv_list"], key=lambda x: x[0])
        time.sleep(2)
    return {"interval": "1H", "pool": addr, "usd": out["usd"], "ada": out["token"]}


def series():
    cfg = {"1D": (1, 48), "7D": (7, 56), "30D": (30, 60), "90D": (90, 90), "1Y": (365, 73)}
    out = {}
    for k, (days, n) in cfg.items():
        s = get(f"{CG}/coins/snek/market_chart?vs_currency=usd&days={days}")["prices"]
        time.sleep(3)
        a = get(f"{CG}/coins/cardano/market_chart?vs_currency=usd&days={days}")["prices"]
        time.sleep(3)
        step = max(1, len(s) // n)
        pts = s[::step]
        if pts[-1] != s[-1]:
            pts.append(s[-1])
        arr, j = [], 0
        for t, p in pts:
            while j + 1 < len(a) and abs(a[j + 1][0] - t) <= abs(a[j][0] - t):
                j += 1
            d = dt.datetime.fromtimestamp(t / 1000, TZ)
            lab = d.strftime("%-I %p") if days == 1 else d.strftime("%b %-d") if days < 365 else d.strftime("%b '%y")
            arr.append([lab, round(p, 8), round(p / a[j][1], 6)])
        out[k] = arr
    return out


def pools_trades():
    pools = get(f"{GT}/tokens/{TOKEN}/pools?page=1")["data"]
    ada = sorted([p for p in pools if "SNEK / ADA" in p["attributes"]["name"]], key=lambda p: -float(p["attributes"]["reserve_in_usd"] or 0))
    addr = ada[0]["attributes"]["address"] if ada else pools[0]["attributes"]["address"]
    trades = get(f"{GT}/pools/{addr}/trades")["data"]
    return pools, trades, addr


def num(s):
    return float(s.replace(",", ""))


def short(a):
    return a if len(a) <= 16 else a[:9] + "…" + a[-4:]


def holders():
    raw = get("https://cardanoscan.io/token/" + TOKEN, as_json=False)
    hrefs = list(dict.fromkeys(re.findall(r'href="/address/([A-Za-z0-9]+)"', raw)))
    t = re.sub(r"<script.*?</script>", "", raw, flags=re.S)
    t = re.sub(r"<[^>]+>", " | ", t)
    t = html.unescape(re.sub(r"(\s*\|\s*)+", " | ", t))
    count = re.search(r"\| Holders \| ([\d,]+) \| Top 100 hold", t) or re.search(r"\| ([\d,]+) \| Holders \|", t)
    if not count:
        raise RuntimeError("holder count not found")
    tiers = [[name, int(num(h)), float(p)] for name, h, p in re.findall(r"\| (Whale|Shark|Fish|Crab|Shrimp) \| ([\d,]+) \| ([\d.]+)% \|", t)]
    ranks = [[lab, float(p)] for lab, p in re.findall(r"\| (Top 10|11–20|21–50|51–100|101\+) \| ([\d.]+)% \| [\d.]+[kmb]? SNEK", t)]
    top = []
    seg = t[t.find("| Rank | Holder |"):]
    for m in re.finditer(r"\| (\d{1,2}) \| ([A-Za-z0-9]+) \| ([A-Za-z0-9]+) \| ([\d,]{5,}) \| ([\d.]+)%(?= \|)", seg):
        sh = short(m.group(2) + m.group(3)); pre, suf = sh.split("…") if "…" in sh else (sh, "")
        full = next((a for a in hrefs if a.startswith(pre) and a.endswith(suf)), None)
        top.append([sh, int(num(m.group(4))), float(m.group(5)), full])
        if len(top) == 10:
            break
    top100 = re.search(r"Top 100 hold ([\d.]+)%", t)
    txs = re.search(r"\| Transactions \| ([\d,]+) \|", t)
    out = {"source": "Cardanoscan", "asOf": NOW, "count": int(num(count.group(1))), "tiers": tiers, "ranks": ranks, "top": top,
           "top100": float(top100.group(1)) if top100 else None, "transactions": int(num(txs.group(1))) if txs else None}
    if len(tiers) < 5 or len(top) < 10:
        raise RuntimeError(f"partial holder parse tiers={len(tiers)} top={len(top)}")
    return out


KOIOS = "https://api.koios.rest/api/v1"
HANDLE_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"


def kpost(path, body, timeout=60):
    req = urllib.request.Request(KOIOS + path, data=json.dumps(body).encode(), headers={"User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def handle_name(hexname):
    h = hexname[8:] if hexname.startswith("000de140") else hexname
    try:
        return bytes.fromhex(h).decode("utf-8")
    except Exception:
        return None


def wallets(top):
    """Enrich the top holders with public on-chain facts from Koios (keyless): stake key, ADA, staking status, ADA Handles, 24h activity."""
    tip = json.loads(urllib.request.urlopen(urllib.request.Request(KOIOS + "/tip", headers={"User-Agent": UA}), timeout=30).read())
    after = tip[0]["block_height"] - 4320  # ~24 h of blocks
    labels = {l["address"]: l for l in json.load(open(os.path.join(ROOT, "assets", "labels.json")))["labels"]}
    out = []
    for rank, row in enumerate(top, 1):
        addr = row[3] if len(row) > 3 else None
        w = {"rank": rank, "address": addr, "short": row[0], "snek": row[1], "pct": row[2]}
        if not addr:
            out.append(w); continue
        if addr in labels:
            w["label"] = labels[addr]["label"]; w["labelKind"] = labels[addr].get("kind"); w["labelSource"] = labels[addr].get("source")
            if w["labelKind"] in ("dex", "contract"):
                w["script"] = True; out.append(w); continue  # huge contract UTxO sets time out on the free API
        try:
            ai = kpost("/address_info", {"_addresses": [addr]})
            ai = ai[0] if ai else {}
            w["script"] = bool(ai.get("script_address")); w["byron"] = addr.startswith(("Ae2", "Ddz"))
            stake = ai.get("stake_address"); w["stake"] = stake
            if stake:
                ac = kpost("/account_info", {"_stake_addresses": [stake]})[0]
                w["ada"] = int(ac["total_balance"]) / 1e6; w["stakeStatus"] = ac["status"]; w["pool"] = ac.get("delegated_pool")
                if w["pool"]:
                    try:
                        pi = kpost("/pool_info", {"_pool_bech32_ids": [w["pool"]]})[0]
                        w["poolTicker"] = (pi.get("meta_json") or {}).get("ticker")
                    except Exception:
                        pass
                try:  # Handle.me public API (keyless): handle count + default handle
                    hd = get("https://api.handle.me/holders/" + stake, tries=2)
                    names = hd.get("handles") or []
                    w["handles"] = int(hd.get("total_handles") or len(names)); w["handleSample"] = names[:8]
                    if hd.get("manually_set") and hd.get("default_handle"):
                        w["defaultHandle"] = hd["default_handle"]
                except Exception:
                    hs = kpost(f"/account_assets?policy_id=eq.{HANDLE_POLICY}&select=asset_name", {"_stake_addresses": [stake]}, timeout=90)
                    names = sorted(n for n in (handle_name(x["asset_name"]) for x in hs) if n)
                    w["handles"] = len(names); w["handleSample"] = names[:8]
                tx = kpost("/account_txs", {"_stake_address": stake, "_after_block_height": after})
                w["tx24"] = len(tx); w["tx24Capped"] = len(tx) >= 1000
            else:
                w["ada"] = int(ai.get("balance") or 0) / 1e6; w["handles"] = 0
                if not w["script"]:
                    tx = kpost("/address_txs", {"_addresses": [addr], "_after_block_height": after})
                    w["tx24"] = len(tx); w["tx24Capped"] = len(tx) >= 1000
        except Exception as e:  # noqa
            w["error"] = type(e).__name__
        out.append(w)
        time.sleep(1)
    return out


def main():
    prev = load_prev()
    snap = dict(prev)
    status = {}
    pool_addr = None
    for name, fn in [("market", None), ("pools", None), ("ohlcv", None), ("holders", holders)]:
        try:
            if name == "market":
                snap["market"], snap["tickers"], snap["asOf"] = market(prev)
            elif name == "pools":
                snap["pools"], snap["trades"], pool_addr = pools_trades()
            elif name == "ohlcv":
                snap["ohlcv"] = ohlcv(pool_addr or "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c2ffadbb87144e875749122e0bbb9f535eeaa7f5660c6c4a91bcc4121e477f08d")
            else:
                snap[name] = fn()
                if name == "holders":
                    try:
                        snap["holders"]["wallets"] = wallets(snap["holders"]["top"])
                        status["wallets"] = "ok"
                    except Exception as e:  # noqa
                        old = (prev.get("holders") or {}).get("wallets")
                        if old:
                            snap["holders"]["wallets"] = old
                        status["wallets"] = f"kept previous ({type(e).__name__}: {e})"
            status[name] = "ok"
        except Exception as e:
            status[name] = f"kept previous ({type(e).__name__}: {e})"
    snap.pop("series", None)
    snap["generatedAt"] = NOW
    snap["updateStatus"] = status
    print(json.dumps(status, indent=1))
    body = json.dumps(snap, separators=(",", ":"))
    open(OUT_JSON, "w").write(body + "\n")
    open(OUT_JS, "w").write("window.SNEK_SNAPSHOT = " + body + ";\n")
    if status.get("market") != "ok" and status.get("holders") != "ok":
        sys.exit(1)


if __name__ == "__main__":
    main()
