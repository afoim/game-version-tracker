from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from games.genshin import GenshinAdapter
from games.starrail import StarRailAdapter
from games.honkai3 import Honkai3Adapter
from games.zzz import ZZZAdapter
from games.wuwa import WuwaAdapter
from games.endfield import EndfieldAdapter
from games.yh import YHAdapter
from games.bluearchive_jp import BlueArchiveJPAdapter
from games.stellasora_cn import StellaSoraCNAdapter

BANNER_FALLBACKS = {
    "genshin": {
        "characters": ["菲林斯", "伊涅芙"],
        "start_at": "2026-09-01T18:00:00+08:00",
        "end_at": "2026-09-22T14:59:00+08:00",
    },
    "starrail": {
        "characters": ["知更鸟·夏日", "遐蝶"],
        "start_at": "2026-08-26T11:00:00+08:00",
        "end_at": "2026-09-12T11:59:00+08:00",
    },
    "zzz": {
        "characters": ["克拉蕾", "南宫羽"],
        "start_at": "2026-09-09T11:00:00+08:00",
        "end_at": "2026-09-30T11:59:00+08:00",
    },
    "wuwa": {
        "characters": ["景燃", "绯雪", "莫宁"],
        "start_at": "2026-09-10T10:00:00+08:00",
        "end_at": "2026-09-29T11:59:00+08:00",
    },
    "endfield": {
        "characters": ["提弗洛斯"],
        "start_at": "2026-09-02T12:00:00+08:00",
        "end_at": "2026-09-30T11:59:00+08:00",
    },
    "yh": {
        "characters": ["灵可", "浔"],
        "start_at": "2026-09-03T11:00:00+08:00",
        "end_at": "2026-09-24T05:59:00+08:00",
    },
    "stellasora_cn": {
        "characters": ["埃莉诺"],
        "start_at": "2026-09-08T17:00:00+08:00",
        "end_at": "2026-09-29T10:59:00+08:00",
    },
    "bluearchive_jp": {
        "characters": ["霞（水着）", "圣娅（水着）", "莲见（水着）", "萌绘（水着）", "吹雪（水着）"],
        "start_at": "2026-09-09T17:00:00+09:00",
        "end_at": "2026-09-23T10:59:00+09:00",
    },
}

CONTENT_FALLBACKS = {
    "genshin": {
        "current": ["奥黛塔、阿罗夏", "至冬新区域", "第三人称射击玩法"],
        "next": ["薇斯纳、沃雅妮莎"]
    },
    "starrail": {
        "current": ["夏日知更鸟、夏日砂金", "千星城新区域", "赛车等新活动"],
        "next": []
    },
    "zzz": {
        "current": ["克拉蕾、洛克茜", "新剧情", "新活动玩法"],
        "next": []
    },
    "wuwa": {
        "current": ["清宵、景燃", "玄元境", "新剧情与联机玩法"],
        "next": []
    }
}

REQUIRED_TOP_LEVEL = (
    "game_name",
    "current_version",
    "current_content",
    "current_version_days",
    "next_version",
    "next_content",
    "preview_status",
    "days_to_next_version",
    "current_up_characters",
    "current_up_start_at",
    "current_up_end_at",
    "current_up_days_remaining",
)


def normalize(adapter, raw: dict) -> dict:
    fallback = CONTENT_FALLBACKS.get(adapter.slug, {})
    current = raw.get("current") or {}
    nxt = raw.get("next") or {}
    preview = raw.get("preview") or {}
    banner = raw.get("banner") or BANNER_FALLBACKS.get(adapter.slug, {})

    if preview.get("published"):
        preview_status = "已发布"
    elif preview.get("announced"):
        preview_status = "已官宣待发布"
    else:
        preview_status = "未官宣"

    days_remaining = nxt.get("days_remaining")
    if days_remaining is None and nxt.get("expected_start_at"):
        expected = dt.datetime.fromisoformat(nxt["expected_start_at"])
        now = dt.datetime.now(expected.tzinfo or dt.timezone.utc)
        days_remaining = max(0, (expected.date() - now.date()).days)

    current_start = current.get("start_at")
    if not current_start:
        raise RuntimeError(f"{adapter.slug}: current.start_at must not be null")
    started = dt.datetime.fromisoformat(current_start)
    started_now = dt.datetime.now(started.tzinfo or dt.timezone.utc)
    current_version_days = max(0, (started_now.date() - started.date()).days)

    banner_characters = banner.get("characters", [])
    banner_start_at = banner.get("start_at")
    banner_end_at = banner.get("end_at")
    banner_days_remaining = None
    if banner_end_at:
        banner_end = dt.datetime.fromisoformat(banner_end_at)
        banner_now = dt.datetime.now(banner_end.tzinfo or dt.timezone.utc)
        banner_days_remaining = max(0, (banner_end.date() - banner_now.date()).days)

    result = {
        "game_name": raw.get("name") or adapter.name,
        "current_version": current.get("version"),
        "current_content": current.get("content", fallback.get("current", [])),
        "current_version_days": current_version_days,
        "next_version": nxt.get("version") or "暂未公布",
        "next_content": nxt.get("content", fallback.get("next", [])),
        "preview_status": preview_status,
        "days_to_next_version": days_remaining,
        "current_up_characters": banner_characters,
        "current_up_start_at": banner_start_at,
        "current_up_end_at": banner_end_at,
        "current_up_days_remaining": banner_days_remaining,
    }

    missing = [key for key in REQUIRED_TOP_LEVEL if key not in result]
    if missing:
        raise RuntimeError(f"{adapter.slug}: missing required fields: {', '.join(missing)}")
    if not result["game_name"] or not result["current_version"]:
        raise RuntimeError(f"{adapter.slug}: game_name/current_version must not be empty")
    if not isinstance(result["current_content"], list) or not isinstance(result["next_content"], list):
        raise RuntimeError(f"{adapter.slug}: content fields must be lists")
    if result["days_to_next_version"] is None:
        raise RuntimeError(f"{adapter.slug}: days_to_next_version must not be null")
    return result


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    adapters = (GenshinAdapter(), StarRailAdapter(), Honkai3Adapter(), ZZZAdapter(), WuwaAdapter(), EndfieldAdapter(), YHAdapter(), BlueArchiveJPAdapter(), StellaSoraCNAdapter())
    games = []
    for adapter in adapters:
        raw = adapter.collect()
        games.append(normalize(adapter, raw))

    payload = {"games": games}
    out = root / "data" / "games.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"\nwritten: {out}")

    for old in (root / "data").glob("*.json"):
        if old.name != "games.json":
            old.unlink()

if __name__ == "__main__":
    main()
