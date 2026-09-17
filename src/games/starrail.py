from __future__ import annotations
import datetime as dt, html, json, re, urllib.parse, urllib.request

API = "https://bbs-api-os.hoyolab.com/community/post/wapi"
GAME_ID = 6
UTC8 = dt.timezone(dt.timedelta(hours=8))
VERSION_RE = re.compile(r"(?:Version|V)\s*(\d+\.\d+)", re.I)
MAINT_RE = re.compile(
    r"(?:maintenance (?:on|begins)|update maintenance will begin on)\s*"
    r"(\d{4}/\d{2}/\d{2})\s+(\d{2}:\d{2})\s*\(UTC\+8\)",
    re.I,
)
DURATION_RE = re.compile(r"estimated to take\s*(\d+)\s*hours", re.I)

# Official Version 4.5 notes define the shortened version end at 2026-09-28 06:00 UTC+8.
# Until 4.6 maintenance details are published, the estimated playable start keeps the usual 5h maintenance.
VERIFIED_VERSION_ENDS = {
    "4.5": dt.datetime(2026, 9, 28, 6, 0, tzinfo=UTC8),
}

def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 game-version-tracker/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def _text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", s, flags=re.I)))


class StarRailAdapter:
    slug = "starrail"
    name = "崩坏：星穹铁道"

    def _news(self, t):
        q = urllib.parse.urlencode({"gids": GAME_ID, "type": t, "page_size": 50})
        payload = _get(f"{API}/getNewsList?{q}")
        if payload.get("retcode") != 0:
            raise RuntimeError(payload)
        return payload["data"]["list"]

    def _post(self, pid):
        payload = _get(f"{API}/getPostFull?post_id={pid}")
        if payload.get("retcode") != 0:
            raise RuntimeError(payload)
        return payload["data"]["post"]["post"]

    def collect(self):
        candidates = []
        for item in self._news(1):
            p = item.get("post", {})
            title = p.get("subject", "")
            m = VERSION_RE.search(title)
            if m and "Update" in title and ("Maintenance" in title or "Update Details" in title):
                candidates.append((tuple(map(int, m.group(1).split("."))), p))
        if not candidates:
            raise RuntimeError("No Star Rail update announcement found")

        vt, meta = max(candidates, key=lambda x: x[0])
        version = ".".join(map(str, vt))
        same = [p for v, p in candidates if v == vt]
        meta = next((p for p in same if "Maintenance" in p.get("subject", "")), meta)
        text = _text(self._post(str(meta["post_id"])).get("content", ""))
        mm = MAINT_RE.search(text)
        if not mm:
            raise RuntimeError("Could not parse Star Rail maintenance start")
        maintenance = dt.datetime.strptime(" ".join(mm.groups()), "%Y/%m/%d %H:%M").replace(tzinfo=UTC8)
        dm = DURATION_RE.search(text)
        hours = int(dm.group(1)) if dm else 5
        start = maintenance + dt.timedelta(hours=hours)

        nt = (vt[0], vt[1] + 1)
        nv = ".".join(map(str, nt))
        preview = None
        for typ in (3, 1):
            for item in self._news(typ):
                p = item.get("post", {})
                title = p.get("subject", "")
                m = VERSION_RE.search(title)
                if m and tuple(map(int, m.group(1).split("."))) == nt and "Special Program" in title:
                    preview = p
                    break
            if preview:
                break

        version_end = VERIFIED_VERSION_ENDS.get(version)
        expected = version_end + dt.timedelta(hours=5) if version_end else start + dt.timedelta(days=42)
        now = dt.datetime.now(UTC8)
        return {
            "game": self.slug,
            "name": self.name,
            "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "current": {
                "version": version,
                "maintenance_start": maintenance.isoformat(),
                "start_at": start.isoformat(),
            },
            "next": {
                "version": nv,
                "expected_start_at": expected.isoformat(),
                "confirmed": False,
                "confidence": "official_version_end_plus_estimated_maintenance" if version_end else "inferred_42d",
                "days_remaining": max(0, (expected.date() - now.date()).days),
            },
            "preview": {
                "announced": bool(preview),
                "published": False,
                "title": preview.get("subject") if preview else None,
                "post_id": str(preview.get("post_id")) if preview else None,
            },
        }
