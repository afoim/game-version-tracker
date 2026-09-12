from __future__ import annotations

import datetime as dt
import re
from html.parser import HTMLParser
from games.http import get_text

URL = "https://www.taptap.cn/app/234280/topic?type=official"
UTC8 = dt.timezone(dt.timedelta(hours=8))
VERSION = r"《鸣潮》\s*(\d+\.\d+)版本"
TITLE = r"\s*(?:[「『][^」』\n]{1,80}[」』])?\s*"
LIVE_RE = re.compile(VERSION + TITLE + r"(?:已正式开启|正式开启|正式上线)")
DATED_RE = re.compile(VERSION + TITLE + r"将于(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?:正式)?(?:开启|上线)")
PREVIEW_RE = re.compile(VERSION + r"前瞻(?:通讯|直播|特别节目)将于(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?:正式)?播出")
# Historical official maintenance end, valid only for this exact release.
# New releases require their own timestamp; never reuse an older release's date.
VERIFIED_STARTS = {"3.6": dt.datetime(2026, 8, 20, 11, tzinfo=UTC8)}


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("br", "p", "div", "a", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        if tag in ("p", "div", "a", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def version_key(version):
    return tuple(map(int, version.split(".")))


def parse_page(page: str, now: dt.datetime) -> dict:
    parser = VisibleText()
    parser.feed(page)
    text = "".join(parser.parts)
    starts = dict(VERIFIED_STARTS)
    dated = {}
    for match in DATED_RE.finditer(text):
        version, *parts = match.groups()
        dated[version] = dt.datetime(*map(int, parts), tzinfo=UTC8)
    starts.update(dated)
    live = set(LIVE_RE.findall(text))
    live.update(version for version, start in dated.items() if start <= now)
    if not live:
        raise RuntimeError("No explicitly launched Wuthering Waves version found")
    current = max(live, key=version_key)
    start = starts.get(current)
    if start is None or start > now:
        raise RuntimeError(f"No verified start date for launched version {current}")
    previews = {}
    for match in PREVIEW_RE.finditer(text):
        version, *parts = match.groups()
        previews[version] = dt.datetime(*map(int, parts), tzinfo=UTC8)
    future = {v for v in dated.keys() | previews.keys() if version_key(v) > version_key(current)}
    next_version = min(future, key=version_key) if future else None
    expected = dated.get(next_version) or start + dt.timedelta(days=42)
    preview_at = previews.get(next_version)
    return {
        "game": "wuwa", "name": "鸣潮",
        "current": {"version": current, "start_at": start.isoformat()},
        "next": {"version": next_version, "expected_start_at": expected.isoformat(),
                 "confirmed": next_version in dated,
                 "days_remaining": max(0, (expected.date() - now.date()).days)},
        # A past scheduled broadcast alone does not prove publication.
        "preview": {"announced": preview_at is not None, "published": False,
                    "scheduled_at": preview_at.isoformat() if preview_at else None},
    }


class WuwaAdapter:
    slug = "wuwa"
    name = "鸣潮"

    def collect(self):
        return parse_page(get_text(URL), dt.datetime.now(UTC8))
