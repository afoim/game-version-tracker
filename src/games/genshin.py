from __future__ import annotations
import datetime as dt
import html
import json
import re
import urllib.parse
import urllib.request
from typing import Any

API = "https://bbs-api-os.hoyolab.com/community/post/wapi"
GAME_ID = 2
UTC8 = dt.timezone(dt.timedelta(hours=8))
VERSION_RE = re.compile(r"(?:Version|V)\s*(\d+\.\d+)", re.I)
MAINT_RE = re.compile(r"maintenance (?:on|begins)\s*(\d{4}/\d{2}/\d{2})\s+(\d{2}:\d{2})\s*\(UTC\+8\)", re.I)
DURATION_RE = re.compile(r"estimated to take\s*(\d+)\s*hours", re.I)
PREVIEW_RE = re.compile(r"on\s*(\d{2}/\d{2}/\d{4})\s+at\s+(\d{2}:\d{2})\s+(AM|PM)\s*\(UTC-4\)", re.I)

def _get_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 game-version-tracker/0.1"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)

def _strip_html(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value)

def _iso(ts: dt.datetime) -> str:
    return ts.isoformat(timespec="seconds")

class GenshinAdapter:
    slug = "genshin"
    name = "原神"

    def _news(self, news_type: int, page_size: int = 50) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"gids": GAME_ID, "type": news_type, "page_size": page_size})
        payload = _get_json(f"{API}/getNewsList?{query}")
        if payload.get("retcode") != 0:
            raise RuntimeError(payload)
        return payload["data"]["list"]

    def _post(self, post_id: str) -> dict[str, Any]:
        payload = _get_json(f"{API}/getPostFull?post_id={post_id}")
        if payload.get("retcode") != 0:
            raise RuntimeError(payload)
        return payload["data"]["post"]["post"]

    def collect(self) -> dict[str, Any]:
        announcements = self._news(1)
        info = self._news(3)
        update_candidates = []
        for item in announcements:
            post = item.get("post", {})
            subject = post.get("subject", "")
            m = VERSION_RE.search(subject)
            if m and "Update" in subject and ("Maintenance" in subject or "Update Details" in subject):
                update_candidates.append((tuple(map(int, m.group(1).split("."))), post))
        if not update_candidates:
            raise RuntimeError("No version update announcement found")
        current_version_tuple, current_post_meta = max(update_candidates, key=lambda x: x[0])
        current_version = ".".join(map(str, current_version_tuple))
        same_version = [p for v, p in update_candidates if v == current_version_tuple]
        maintenance_meta = next((p for p in same_version if "Maintenance" in p.get("subject", "")), current_post_meta)
        maintenance_post = self._post(str(maintenance_meta["post_id"]))
        maintenance_text = _strip_html(maintenance_post.get("content", ""))
        mm = MAINT_RE.search(maintenance_text)
        if not mm:
            raise RuntimeError("Could not parse maintenance start")
        maintenance_start = dt.datetime.strptime(" ".join(mm.groups()), "%Y/%m/%d %H:%M").replace(tzinfo=UTC8)
        dm = DURATION_RE.search(maintenance_text)
        estimated_hours = int(dm.group(1)) if dm else 5
        current_start = maintenance_start + dt.timedelta(hours=estimated_hours)
        next_preview = None
        for item in info:
            post = item.get("post", {})
            subject = post.get("subject", "")
            if "Special Program" not in subject:
                continue
            m = VERSION_RE.search(subject)
            if not m:
                continue
            version_tuple = tuple(map(int, m.group(1).split(".")))
            if version_tuple > current_version_tuple and (next_preview is None or version_tuple < next_preview[0]):
                next_preview = (version_tuple, post)
        next_version = None
        if next_preview:
            next_version_tuple, preview_meta = next_preview
            next_version = ".".join(map(str, next_version_tuple))
            preview_post = self._post(str(preview_meta["post_id"]))
            preview_text = _strip_html(preview_post.get("content", ""))
            pm = PREVIEW_RE.search(preview_text)
            preview_scheduled_at = None
            if pm:
                preview_local = dt.datetime.strptime(" ".join(pm.groups()), "%m/%d/%Y %I:%M %p").replace(tzinfo=dt.timezone(dt.timedelta(hours=-4)))
                preview_scheduled_at = preview_local.astimezone(UTC8).isoformat(timespec="seconds")
            preview_state = {
                "announced": True,
                "published": False,
                "title": preview_meta.get("subject"),
                "post_id": str(preview_meta.get("post_id")),
                "url": f"https://www.hoyolab.com/article/{preview_meta.get('post_id')}",
                "announcement_at": dt.datetime.fromtimestamp(preview_meta["created_at"], dt.timezone.utc).isoformat(timespec="seconds"),
                "scheduled_at": preview_scheduled_at,
                "raw_excerpt": preview_text[:500],
            }
        else:
            preview_state = {"announced": False, "published": False}
        expected_next = current_start + dt.timedelta(days=42)
        return {
            "game": self.slug,
            "name": self.name,
            "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "source": {"name": "HoYoLAB official community API", "api": API},
            "current": {
                "version": current_version,
                "maintenance_start": _iso(maintenance_start),
                "start_at": _iso(current_start),
                "start_at_note": f"官方公告维护预计 {estimated_hours} 小时；start_at 为维护开始时间加预计时长",
                "source_post_id": str(maintenance_meta["post_id"]),
                "source_title": maintenance_meta.get("subject"),
                "confidence": "official_estimate"
            },
            "next": {
                "version": next_version,
                "expected_start_at": _iso(expected_next),
                "confirmed": False,
                "confidence": "inferred_42d"
            },
            "preview": preview_state
        }


