from __future__ import annotations
import datetime as dt, html, json, re, urllib.request

API = "https://api-web.bluearchive.jp/api/news"
JST = dt.timezone(dt.timedelta(hours=9))


def _json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 game-version-tracker/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def _text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value)))


class BlueArchiveJPAdapter:
    slug = "bluearchive_jp"
    name = "蔚蓝档案（日服）"

    def collect(self):
        rows = _json(f"{API}/list?typeId=3&pageNum=20&pageIndex=1")["data"]["rows"]
        maintenance = None
        body = ""
        start = None
        for row in rows:
            detail = _json(f"{API}/detail?id={row['id']}")["data"]["news"]
            text = _text(detail.get("content", ""))
            m = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日\([^)]*\)\s*11:00\s*[～~]\s*(?:20\d{2}年\d{1,2}月\d{1,2}日\([^)]*\)\s*)?(\d{1,2}):(\d{2})", text)
            if m:
                y, mo, d, hh, mm = map(int, m.groups())
                start = dt.datetime(y, mo, d, hh, mm, tzinfo=JST)
                maintenance, body = row, text
                break
        if not maintenance or not start:
            raise RuntimeError("No Blue Archive JP maintenance found")
        content = []
        if "メインストーリー" in body:
            content.append("主线剧情更新")
        names = re.findall(r"★3「([^」]+)」", body)
        if names:
            unique = list(dict.fromkeys(names))[:5]
            content.append("学生：" + "、".join(unique))
        if "イベント" in body:
            content.append("活动内容更新")
        expected = start + dt.timedelta(days=14)
        now = dt.datetime.now(JST)
        return {
            "game": self.slug, "name": self.name,
            "current": {"version": start.strftime("%Y/%m/%d 更新"), "start_at": start.isoformat(), "content": content},
            "next": {"version": expected.strftime("%Y/%m/%d 更新（预计）"), "expected_start_at": expected.isoformat(), "confirmed": False,
                     "days_remaining": max(0, (expected.date() - now.date()).days), "content": []},
            "preview": {"announced": False}
        }
