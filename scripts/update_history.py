#!/usr/bin/env python3
"""Build and grow a long SNEK candle history for the chart (assets/history/).

Free, keyless sources:
  * GeckoTerminal: on-chain SNEK/ADA candles from the main Minswap pool (public API serves the last ~180 days).
  * Gate.io spot: SNEK_USDT and ADA_USDT candles (public API serves up to 10,000 candles back per interval;
    SNEK_USDT trades there since Dec 2023). SNEK/ADA for these is SNEK_USDT / ADA_USDT.
Where both exist the on-chain candle wins. Existing files are merged, never truncated, so the history keeps
growing past each API's look-back window. Output is split into chunks of CHUNK (500) candles so the browser can lazy-load
older ones when you scroll left: assets/history/<iv>/index.json + <iv>/<n>.json. Each candle is
[time, open, high, low, close, volumeUSD, source] with source 0 = on-chain DEX, 1 = Gate.io (CEX).
"""
import json, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "history")
POOL = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c2ffadbb87144e875749122e0bbb9f535eeaa7f5660c6c4a91bcc4121e477f08d"
GT = "https://api.geckoterminal.com/api/v2/networks/cardano/pools/" + POOL + "/ohlcv/"
GATE = "https://api.gateio.ws/api/v4/spot/candlesticks"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
CHUNK = 500
# interval: (seconds, GT timeframe, GT aggregate, GT pages back (1000 each, capped at 180 days), Gate interval)
IVS = {
    "1D": (86400, "day", 1, 1, "1d"),
    "4H": (14400, "hour", 4, 2, "4h"),
    "1H": (3600, "hour", 1, 5, "1h"),
    "15m": (900, "minute", 15, 3, "15m"),
    "5m": (300, "minute", 5, 2, "5m"),
}
GT_MAX_AGE = 179 * 86400
_last_gt = [0.0]


def get(url, tries=3):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa
            err = e
            time.sleep(5 * (i + 1))
    raise err


def gt(tf, agg, before, cur):
    wait = 6.5 - (time.time() - _last_gt[0])  # stay well under GeckoTerminal's public 10-30 calls/min
    if wait > 0:
        time.sleep(wait)
    _last_gt[0] = time.time()
    u = f"{GT}{tf}?aggregate={agg}&limit=1000&currency={cur}" + (f"&before_timestamp={before}" if before else "")
    return get(u)["data"]["attributes"]["ohlcv_list"]


def gate(pair, iv, step, start, end):
    """All Gate candles for pair between start and end (unix s), 1000 per request, within the 10,000-candle window."""
    out = {}
    floor = int(time.time()) - step * 9990
    t = max(start, floor)
    while t < end:
        t2 = min(end, t + step * 999)
        try:
            rows = get(f"{GATE}?currency_pair={pair}&interval={iv}&from={t}&to={t2}")
        except Exception as e:  # noqa
            print("gate", pair, iv, e, file=sys.stderr); rows = []
        for r in rows if isinstance(rows, list) else []:
            # [t, quote_volume, close, high, low, open, base_volume, closed]
            out[int(r[0])] = (float(r[5]), float(r[3]), float(r[4]), float(r[2]), float(r[1]))
        t = t2 + step
        time.sleep(0.25)
    return out


def r6(x):
    return float(f"{x:.6g}")


def load(iv):
    d = os.path.join(OUT, iv)
    try:
        idx = json.load(open(os.path.join(d, "index.json")))
    except Exception:
        return {"usd": {}, "ada": {}}
    res = {"usd": {}, "ada": {}}
    for c in idx.get("chunks", []):
        try:
            body = json.load(open(os.path.join(d, c["file"])))
        except Exception:
            continue
        for cur in ("usd", "ada"):
            for b in body.get(cur, []):
                res[cur][b[0]] = b
    return res


def save(iv, data, sources):
    d = os.path.join(OUT, iv)
    os.makedirs(d, exist_ok=True)
    times = sorted(set(data["usd"]) | set(data["ada"]))
    chunks = []
    for n, i in enumerate(range(0, len(times), CHUNK)):
        ts = times[i:i + CHUNK]
        body = {cur: [data[cur][t] for t in ts if t in data[cur]] for cur in ("usd", "ada")}
        f = f"{n}.json"
        s = json.dumps(body, separators=(",", ":"))
        p = os.path.join(d, f)
        if not os.path.exists(p) or open(p).read() != s:
            open(p, "w").write(s)
        chunks.append({"file": f, "from": ts[0], "to": ts[-1], "count": len(ts)})
    for f in os.listdir(d):  # drop stale chunk files
        if f.endswith(".json") and f != "index.json" and f not in {c["file"] for c in chunks}:
            os.remove(os.path.join(d, f))
    idx = {"interval": iv, "chunkSize": CHUNK, "first": times[0] if times else None, "last": times[-1] if times else None,
           "count": len(times), "chunks": chunks, "sources": sources,
           "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    json.dump(idx, open(os.path.join(d, "index.json"), "w"), separators=(",", ":"))
    return idx


def build(iv, full):
    step, tf, agg, pages, giv = IVS[iv]
    data = load(iv)
    now = int(time.time())
    have = max(data["usd"]) if data["usd"] else 0
    # --- Gate (CEX) first; on-chain overwrites overlaps ---
    start = 0 if full or not have else have - step * 3
    snek = gate("SNEK_USDT", giv, step, start, now)
    ada = gate("ADA_USDT", giv, step, start, now)
    for t, (o, h, l, c, vq) in snek.items():
        if t in data["usd"] and data["usd"][t][6] == 0:
            continue  # keep on-chain
        data["usd"][t] = [t, r6(o), r6(h), r6(l), r6(c), round(vq), 1]
        a = ada.get(t)
        if a and a[0] > 0 and a[3] > 0:
            ao, ac = a[0], a[3]
            oo, cc = o / ao, c / ac
            hh, ll = max(h / ac, oo, cc), min(l / ac, oo, cc)
            data["ada"][t] = [t, r6(oo), r6(hh), r6(ll), r6(cc), round(vq / ac), 1]
    # --- GeckoTerminal on-chain (last ~180 days) ---
    for cur in ("usd", "token"):
        key = "usd" if cur == "usd" else "ada"
        before = None
        n = pages if (full or not have) else 1
        for _ in range(n):
            try:
                rows = gt(tf, agg, before, cur)
            except Exception as e:  # noqa
                print("gt", iv, cur, e, file=sys.stderr); break
            if not rows:
                break
            for r in rows:
                t = int(r[0])
                vusd = r[5] if cur == "usd" else None
                if cur == "token":
                    u = data["usd"].get(t)
                    vusd = (u[5] if u and u[6] == 0 else r[5])  # GT volume is reported in USD
                data[key][t] = [t, r6(r[1]), r6(r[2]), r6(r[3]), r6(r[4]), round(float(vusd or 0)), 0]
            oldest = min(int(r[0]) for r in rows)
            if now - oldest > GT_MAX_AGE or len(rows) < 1000:
                break
            before = oldest
    sources = [
        {"id": 0, "name": "On-chain DEX (Minswap SNEK/ADA via GeckoTerminal)", "url": "https://www.geckoterminal.com/cardano/pools/" + POOL},
        {"id": 1, "name": "Gate.io SNEK/USDT (CEX; ADA view = SNEK/USDT ÷ ADA/USDT)", "url": "https://www.gate.io/trade/SNEK_USDT"},
    ]
    return save(iv, data, sources)


def main():
    full = "--full" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for iv in only or IVS:
        try:
            idx = build(iv, full)
            print(iv, idx["count"], "candles from", time.strftime("%Y-%m-%d %H:%M", time.gmtime(idx["first"] or 0)), "UTC")
        except Exception as e:  # noqa
            print("history", iv, "failed:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
