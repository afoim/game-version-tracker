from __future__ import annotations

import datetime as dt
import json
import os
import sys
import tempfile
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

VERIFIED_AT = "2026-09-17T15:05:51+08:00"
SOURCE_TYPES = {"official_api", "official", "official_community", "secondary"}

SOURCE_FALLBACKS = {
    "genshin": [
        {
            "title": "HoYoLAB official community API",
            "url": "https://bbs-api-os.hoyolab.com/community/post/wapi",
            "type": "official_api",
            "claims": ["current_version", "current_version_start", "preview_status"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "《原神》7.1版本「往冥府的安魂歌」前瞻特别节目",
            "url": "https://www.bilibili.com/video/BV1znY96NEvn/",
            "type": "official_community",
            "claims": ["next_version", "preview_status"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "原神 7.0 版本第二期活动祈愿",
            "url": "https://www.sina.cn/news/detail/5338307702558236.html",
            "type": "official_community",
            "claims": ["banner"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "starrail": [
        {
            "title": "HoYoLAB official community API",
            "url": "https://bbs-api-os.hoyolab.com/community/post/wapi",
            "type": "official_api",
            "claims": ["current_version", "current_version_start"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "4.5版本活动跃迁（其二）",
            "url": "https://www.taptap.cn/moment/846770765180174809",
            "type": "official_community",
            "claims": ["banner"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "4.6版本「月升之前，与兽共舞」前瞻特别节目预告",
            "url": "https://www.taptap.cn/moment/848576715130145834",
            "type": "official_community",
            "claims": ["next_version", "preview_status"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "Version 4.5 update details mirror (source: HoYoverse)",
            "url": "https://honkai.gg/version-4-5-to-roll-the-stars-in-astropolis-update-details/",
            "type": "secondary",
            "claims": ["next_version"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "honkai3": [
        {
            "title": "《崩坏3》官方网站",
            "url": "https://bh3.mihoyo.com/",
            "type": "official",
            "claims": ["current_version", "current_version_start", "current_content"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "《崩坏3》9.1版本「时序之律者」官方预告",
            "url": "https://www.sina.cn/news/detail/5338268690548185.html",
            "type": "official_community",
            "claims": ["next_version", "preview_status"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "zzz": [
        {
            "title": "HoYoLAB official community API",
            "url": "https://bbs-api-os.hoyolab.com/community/post/wapi",
            "type": "official_api",
            "claims": ["current_version", "current_version_start", "preview_status"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "Zenless Zone Zero Version 3.2 Phase I Signal Search",
            "url": "https://zenless.hoyoverse.com/m/fr-fr/news/165979",
            "type": "official",
            "claims": ["banner"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "wuwa": [
        {
            "title": "《鸣潮》TapTap 官方论坛",
            "url": "https://www.taptap.cn/app/234280/topic?type=official",
            "type": "official_community",
            "claims": ["current_version", "next_version", "preview_status", "banner"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "《鸣潮》3.6版本官方动态（景燃）",
            "url": "https://www.bilibili.com/opus/1246274109191487496",
            "type": "official_community",
            "claims": ["current_version", "current_content", "banner"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "《鸣潮》3.6版本官方动态（绯雪）",
            "url": "https://www.bilibili.com/opus/1246645589513338950",
            "type": "official_community",
            "claims": ["current_version", "banner"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "endfield": [
        {
            "title": "「雪凇幽梦」版本更新说明",
            "url": "https://endfield.hypergryph.com/news/2653",
            "type": "official",
            "claims": ["current_version", "current_version_start", "current_content", "banner"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "yh": [
        {
            "title": "《异环》官方网站综合新闻",
            "url": "https://yh.wanmei.com/m/news/index.html",
            "type": "official",
            "claims": ["current_version", "current_version_start", "next_version", "preview_status"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "「全频带漫游中！」限定棋盘",
            "url": "https://www.taptap.cn/moment/843817957036392944",
            "type": "official_community",
            "claims": ["banner"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "限定S级角色「浔」返场",
            "url": "https://www.taptap.cn/moment/843878663509246370",
            "type": "official_community",
            "claims": ["banner"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "bluearchive_jp": [
        {
            "title": "ブルーアーカイブ公式ニュース API",
            "url": "https://api-web.bluearchive.jp/api/news",
            "type": "official_api",
            "claims": ["current_version", "current_version_start", "current_content"],
            "checked_at": VERIFIED_AT,
        },
    ],
    "stellasora_cn": [
        {
            "title": "《星塔旅人》TapTap 官方页",
            "url": "https://www.taptap.cn/app/733498",
            "type": "official_community",
            "claims": ["current_version", "current_content", "banner"],
            "checked_at": VERIFIED_AT,
        },
        {
            "title": "《星塔旅人》TapTap 官方论坛",
            "url": "https://www.taptap.cn/app/733498/topic",
            "type": "official_community",
            "claims": ["current_content", "banner"],
            "checked_at": VERIFIED_AT,
        },
    ],
}

BANNER_FALLBACKS = {
    "genshin": {
        "characters": ["菲林斯", "伊涅芙"],
        "start_at": "2026-09-01T18:00:00+08:00",
        "end_at": "2026-09-22T14:59:00+08:00",
    },
    "starrail": {
        "characters": ["砂金·戏浪", "不死途"],
        "start_at": "2026-09-12T12:00:00+08:00",
        "end_at": "2026-09-28T03:59:00+08:00",
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
    "sources",
)


def normalize_sources(adapter, raw: dict) -> list[dict]:
    merged = list(raw.get("sources") or []) + list(SOURCE_FALLBACKS.get(adapter.slug, []))
    result = []
    seen_urls = set()
    for item in merged:
        if not isinstance(item, dict):
            raise RuntimeError(f"{adapter.slug}: source entry must be an object")
        title = item.get("title")
        url = item.get("url")
        source_type = item.get("type")
        claims = item.get("claims")
        checked_at = item.get("checked_at") or raw.get("collected_at") or VERIFIED_AT
        if not title or not url:
            raise RuntimeError(f"{adapter.slug}: source title/url must not be empty")
        if source_type not in SOURCE_TYPES:
            raise RuntimeError(f"{adapter.slug}: invalid source type {source_type!r}")
        if not isinstance(claims, list) or not claims or not all(isinstance(v, str) and v for v in claims):
            raise RuntimeError(f"{adapter.slug}: source claims must be a non-empty string list")
        try:
            dt.datetime.fromisoformat(checked_at)
        except (TypeError, ValueError) as error:
            raise RuntimeError(f"{adapter.slug}: source checked_at must be ISO 8601") from error
        if url in seen_urls:
            continue
        seen_urls.add(url)
        result.append({
            "title": title,
            "url": url,
            "type": source_type,
            "claims": claims,
            "checked_at": checked_at,
        })
    if not result:
        raise RuntimeError(f"{adapter.slug}: at least one source is required")
    return result


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
        if banner_end <= banner_now:
            banner_characters = []
            banner_start_at = None
            banner_end_at = None
        else:
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
        "sources": normalize_sources(adapter, raw),
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


def collect_all(adapters):
    games, errors = [], []
    for adapter in adapters:
        try:
            games.append(normalize(adapter, adapter.collect()))
            print(f"OK: {adapter.slug}", flush=True)
        except Exception as error:
            errors.append(f"{adapter.slug}: {type(error).__name__}: {error}")
            print(f"FAILED: {errors[-1]}", file=sys.stderr, flush=True)
    if errors:
        raise RuntimeError("Collection incomplete; existing data preserved. " + "; ".join(errors))
    return games


def write_payload(out: Path, payload: dict) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=out.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        os.replace(temporary, out)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    adapters = (GenshinAdapter(), StarRailAdapter(), Honkai3Adapter(), ZZZAdapter(), WuwaAdapter(), EndfieldAdapter(), YHAdapter(), BlueArchiveJPAdapter(), StellaSoraCNAdapter())
    games = collect_all(adapters)

    payload = {"games": games}
    out = root / "data" / "games.json"
    write_payload(out, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"\nwritten: {out}")


if __name__ == "__main__":
    main()
