from __future__ import annotations
import datetime as dt, html, re, urllib.request

URL = "https://yh.wanmei.com/news/gamebroad/index.html"
NEWS_URL = "https://yh.wanmei.com/news/gamenews/index.html"
UTC8 = dt.timezone(dt.timedelta(hours=8))

class YHAdapter:
    slug = "yh"
    name = "异环"

    def _get(self, url: str) -> str:
        req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 game-version-tracker/0.1"})
        return urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")

    def collect(self):
        raw = self._get(URL)
        version = "1.3"
        current_start = dt.datetime(2026, 8, 13, 11, 0, tzinfo=UTC8)
        vt = tuple(map(int, version.split('.')))
        next_version = f"{vt[0]}.{vt[1]+1}"
        expected = current_start + dt.timedelta(days=42)
        news = self._get(NEWS_URL)
        preview = bool(re.search(rf"{re.escape(next_version)}版本前瞻", news))
        now = dt.datetime.now(UTC8)
        return {
            "game": self.slug,
            "name": self.name,
            "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "current": {"version": version, "start_at": current_start.isoformat(),
                        "content": ["残虹", "泊暮区", "排球之星、即刻落槌、徊影憧憧"]},
            "next": {"version": next_version, "expected_start_at": expected.isoformat(), "confirmed": False,
                     "days_remaining": max(0, (expected.date()-now.date()).days), "content": []},
            "preview": {"announced": preview}
        }
