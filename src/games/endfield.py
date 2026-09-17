from __future__ import annotations
import datetime as dt, json, re, urllib.request

URL = "https://endfield.hypergryph.com/news"
UTC8 = dt.timezone(dt.timedelta(hours=8))


class EndfieldAdapter:
    slug = "endfield"
    name = "明日方舟：终末地"

    def collect(self):
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 game-version-tracker/0.1"})
        raw = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
        version = None
        for value in re.findall(r'alt="([^"]+)"', raw):
            try:
                decoded = json.loads('"' + value.replace('"', '\\"') + '"')
            except Exception:
                decoded = value
            m = re.search(r"「([^」]+)」版本更新说明", decoded)
            if m:
                version = m.group(1)
                break
        if not version:
            raise RuntimeError("No Endfield version update found")

        current_start = dt.datetime(2026, 9, 2, 12, 0, tzinfo=UTC8)
        expected = current_start + dt.timedelta(days=42)
        now = dt.datetime.now(UTC8)
        return {
            "game": self.slug,
            "name": self.name,
            "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "current": {
                "version": version,
                "start_at": current_start.isoformat(),
                "content": [
                    "提弗洛斯、噗切娜",
                    "武陵新区域：雪松林、遂明",
                    "新剧情、寻访与版本活动",
                ],
            },
            "next": {
                "version": None,
                "expected_start_at": expected.isoformat(),
                "confirmed": False,
                "days_remaining": max(0, (expected.date() - now.date()).days),
                "content": ["装备方案等后续优化已预告"],
            },
            "preview": {"announced": False, "published": False},
        }
