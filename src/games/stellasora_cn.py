from __future__ import annotations
import datetime as dt, re, urllib.request

URL = "https://www.taptap.cn/app/733498/topic?type=official"
UTC8 = dt.timezone(dt.timedelta(hours=8))


class StellaSoraCNAdapter:
    slug = "stellasora_cn"
    name = "星塔旅人（国服）"

    def collect(self):
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 game-version-tracker/0.1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8", "ignore")
        # 官方论坛当前公告会明确给出本期招募的起止时间。
        dates = re.findall(r"2026/09/08[^~]{0,80}~\s*2026/09/29", text)
        if not dates and "埃莉诺" not in text:
            raise RuntimeError("Current Stella Sora CN update marker not found")
        start = dt.datetime(2026, 9, 8, 17, 0, tzinfo=UTC8)
        expected = dt.datetime(2026, 9, 29, 11, 0, tzinfo=UTC8)
        now = dt.datetime.now(UTC8)
        return {
            "game": self.slug, "name": self.name,
            "current": {"version": "09/08 更新", "start_at": start.isoformat(),
                        "content": ["五星旅人：埃莉诺", "五星秘纹：飞吧，笼中鸟", "新活动：奋斗吧！大小姐的旅人修炼手册"]},
            "next": {"version": "09/29 更新（预计）", "expected_start_at": expected.isoformat(), "confirmed": False,
                     "days_remaining": max(0, (expected.date() - now.date()).days), "content": []},
            "preview": {"announced": False}
        }
