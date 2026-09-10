from __future__ import annotations
import datetime as dt, re, urllib.request

URL = "https://www.taptap.cn/app/234280/topic?type=official"
UTC8 = dt.timezone(dt.timedelta(hours=8))
VERSION_RE = re.compile(r"《鸣潮》\s*(\d+\.\d+)版本[^<]{0,80}?(?:已正式开启|将于(\d+)月(\d+)日开启)")

class WuwaAdapter:
    slug = "wuwa"
    name = "鸣潮"

    def collect(self):
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 game-version-tracker/0.1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8", "ignore")
        versions = re.findall(r"《鸣潮》\s*(\d+\.\d+)版本", text)
        if not versions:
            raise RuntimeError("No Wuthering Waves version found")
        current = max(versions, key=lambda v: tuple(map(int, v.split('.'))))
        vt = tuple(map(int, current.split('.')))
        # Official 3.6 maintenance notice: 2026-08-20 04:00–11:00 UTC+8.
        # The adapter will later generalize this from the announcement feed.
        known_starts = {"3.6": dt.datetime(2026, 8, 20, 11, 0, tzinfo=UTC8)}
        start = known_starts.get(current)
        if start is None:
            raise RuntimeError(f"No verified start date for {current}")
        expected = start + dt.timedelta(days=42)
        nv = f"{vt[0]}.{vt[1]+1}"
        preview_announced = bool(re.search(rf"{re.escape(nv)}版本[^<]{{0,100}}前瞻|{re.escape(nv)}版本前瞻", text))
        now = dt.datetime.now(UTC8)
        return {
            "game": self.slug, "name": self.name,
            "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "current": {"version": current, "start_at": start.isoformat()},
            "next": {"version": nv, "expected_start_at": expected.isoformat(), "confirmed": False,
                     "days_remaining": max(0, (expected.date() - now.date()).days)},
            "preview": {"announced": preview_announced}
        }
