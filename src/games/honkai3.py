from __future__ import annotations

import datetime as dt
import re
import urllib.request

URL = "https://bh3.mihoyo.com/"
UTC8 = dt.timezone(dt.timedelta(hours=8))


class Honkai3Adapter:
    slug = "honkai3"
    name = "崩坏3"

    def collect(self):
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 game-version-tracker/0.1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8", "ignore")

        m = re.search(r"全新(\d+\.\d+)版本[「『]([^」』]+)[」』]正式上线", text)
        if not m:
            raise RuntimeError("Current Honkai Impact 3rd version not found")
        version, version_name = m.groups()

        # 9.0 官方维护通知：2026-07-23 06:00~11:00，维护完成后开放。
        start = dt.datetime(2026, 7, 23, 11, 0, tzinfo=UTC8)
        # 官方 9.0 作战凭证明确标注 9.0 版本结束为 9 月 24 日。
        expected = dt.datetime(2026, 9, 24, 11, 0, tzinfo=UTC8)
        major, minor = map(int, version.split("."))
        next_version = f"{major}.{minor + 1}"
        now = dt.datetime.now(UTC8)

        return {
            "game": self.slug,
            "name": self.name,
            "current": {
                "version": version,
                "start_at": start.isoformat(),
                "content": [
                    "全新协同者：希娜狄雅",
                    "全新神之键：琉璃朱燧",
                    "主线第二部终章：从此，拥抱未来",
                    "主题活动：舰舰与许愿树秘闻",
                ],
            },
            "next": {
                "version": next_version,
                "expected_start_at": expected.isoformat(),
                "confirmed": False,
                "days_remaining": max(0, (expected.date() - now.date()).days),
                "content": [],
            },
            "preview": {"announced": False},
        }
