from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from games.genshin import GenshinAdapter
from games.starrail import StarRailAdapter
from games.zzz import ZZZAdapter
from games.wuwa import WuwaAdapter
from games.endfield import EndfieldAdapter
from games.yh import YHAdapter

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
    "next_version",
    "next_content",
    "preview_status",
    "days_to_next_version",
)


def normalize(adapter, raw: dict) -> dict:
    fallback = CONTENT_FALLBACKS.get(adapter.slug, {})
    current = raw.get("current") or {}
    nxt = raw.get("next") or {}
    preview = raw.get("preview") or {}

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

    result = {
        "game_name": raw.get("name") or adapter.name,
        "current_version": current.get("version"),
        "current_content": current.get("content", fallback.get("current", [])),
        "next_version": nxt.get("version") or "暂未公布",
        "next_content": nxt.get("content", fallback.get("next", [])),
        "preview_status": preview_status,
        "days_to_next_version": days_remaining,
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
    adapters = (GenshinAdapter(), StarRailAdapter(), ZZZAdapter(), WuwaAdapter(), EndfieldAdapter(), YHAdapter())
    for adapter in adapters:
        raw = adapter.collect()
        data = normalize(adapter, raw)
        out = root / "data" / f"{adapter.slug}.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(data, ensure_ascii=False, indent=2))
        print(f"\nwritten: {out}")

if __name__ == "__main__":
    main()
